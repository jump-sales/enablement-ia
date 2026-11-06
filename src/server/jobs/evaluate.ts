import { and, asc, eq, ne } from "drizzle-orm";
import { ZodError } from "zod";
import {
  conversations,
  creditLedger,
  criteria,
  criterionScores,
  evaluations,
  evidenceReferences,
  feedbackReports,
  organizations,
  participants,
  rubricVersions,
  rubrics,
  transcriptSegments,
  transcripts,
  usageEvents,
} from "@/db/schema";
import { logger } from "@/lib/logger";
import { validateOutput, type EvalInput } from "../ai/evaluation";
import { estimateCostMicros, getEvaluationLlm, LlmError, type LlmResult } from "../ai/llm";
import { computeScore } from "../ai/scoring";
import { audit } from "../audit";
import { AppError } from "../authz";
import { consumeEvaluationCredit } from "../services/billing";
import { withTenant } from "../tenancy";
import type { EvaluateJob } from "./queue";

export const MAX_ATTEMPTS = 4;

/** Erro que a fila deve retentar (com backoff). */
export class RetryableJobError extends Error {}

type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;

async function load(job: EvaluateJob) {
  const sys = { orgId: job.orgId, userId: null, role: "system" as const };
  return withTenant(sys, async (tx) => {
    const [ev] = await tx.select().from(evaluations).where(eq(evaluations.id, job.evaluationId));
    if (!ev || ev.conversationId !== job.conversationId) return null;
    if (ev.status === "completed" || ev.status === "superseded" || ev.status === "failed") return { done: true as const, ev };
    const [conv] = await tx.select().from(conversations).where(eq(conversations.id, ev.conversationId));
    const [org] = await tx.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, job.orgId));
    const [tr] = await tx.select().from(transcripts).where(eq(transcripts.id, ev.transcriptId));
    const segs = await tx.select().from(transcriptSegments).where(eq(transcriptSegments.transcriptId, ev.transcriptId)).orderBy(asc(transcriptSegments.idx));
    const parts = await tx.select().from(participants).where(eq(participants.conversationId, ev.conversationId));
    const [rv] = await tx
      .select({ v: rubricVersions, rubricName: rubrics.name })
      .from(rubricVersions)
      .innerJoin(rubrics, eq(rubrics.id, rubricVersions.rubricId))
      .where(eq(rubricVersions.id, ev.rubricVersionId));
    const crit = await tx.select().from(criteria).where(eq(criteria.rubricVersionId, ev.rubricVersionId)).orderBy(asc(criteria.position));

    // Marca execução e cobra o crédito (idempotente por avaliação).
    await consumeEvaluationCredit(tx, job.orgId, ev.id);
    const [running] = await tx
      .update(evaluations)
      .set({ status: "running", attempts: ev.attempts + 1, error: null })
      .where(eq(evaluations.id, ev.id))
      .returning();
    return { done: false as const, ev: running, conv, org, tr, segs, parts, rv, crit };
  });
}

function buildInput(d: Exclude<Loaded, { done: true }>): EvalInput {
  const roleBy = new Map(d.parts.map((p) => [p.speakerLabel, p.role]));
  const useRedacted = d.org.settings.redactPii;
  return {
    conversationType: d.conv.type,
    rubricName: d.rv.rubricName,
    scaleMin: d.rv.v.scaleMin,
    scaleMax: d.rv.v.scaleMax,
    guidance: d.rv.v.evaluatorGuidance,
    timestampsApproximate: d.tr.timestampPrecision !== "exact",
    criteria: d.crit.map((c) => ({
      key: c.key,
      name: c.name,
      competency: c.competency,
      description: c.description,
      anchors: c.behavioralAnchors,
      weight: Number(c.weight),
      mandatory: c.mandatory,
      applicability: c.applicability,
      guidance: c.guidance,
    })),
    segments: d.segs.map((s) => ({
      idx: s.idx,
      startMs: s.startMs,
      speakerLabel: s.speakerLabel,
      role: (s.speakerLabel && roleBy.get(s.speakerLabel)) || "unknown",
      text: useRedacted && s.textRedacted ? s.textRedacted : s.text,
    })),
  };
}

async function recordUsage(job: EvaluateJob, attempt: number, provider: string, model: string, r: LlmResult | null, error: string | null, latencyMs: number) {
  const sys = { orgId: job.orgId, userId: null, role: "system" as const };
  await withTenant(sys, (tx) =>
    tx
      .insert(usageEvents)
      .values({
        organizationId: job.orgId,
        conversationId: job.conversationId,
        evaluationId: job.evaluationId,
        stage: "evaluation",
        provider,
        model: r?.model ?? model,
        inputTokens: r?.usage.inputTokens ?? 0,
        outputTokens: r?.usage.outputTokens ?? 0,
        cacheReadTokens: r?.usage.cacheReadTokens ?? 0,
        costUsdMicros: r ? estimateCostMicros(r.model, r.usage) : 0,
        latencyMs,
        success: !error,
        errorCode: error,
        idempotencyKey: `eval:${job.evaluationId}:attempt:${attempt}`,
      })
      .onConflictDoNothing(),
  );
}

async function fail(job: EvaluateJob, message: string, code: string) {
  const sys = { orgId: job.orgId, userId: null, role: "system" as const };
  await withTenant(sys, async (tx) => {
    await tx.update(evaluations).set({ status: "failed", error: message, completedAt: new Date() }).where(eq(evaluations.id, job.evaluationId));
    await tx
      .update(conversations)
      .set({ status: "failed", statusDetail: `Avaliação não concluída: ${message}`, updatedAt: new Date() })
      .where(eq(conversations.id, job.conversationId));
    // Estorno do crédito: a empresa não paga por avaliação que não entregamos.
    const charged = await tx.select({ id: creditLedger.id }).from(creditLedger).where(eq(creditLedger.idempotencyKey, `eval:${job.evaluationId}`));
    if (charged.length) {
      await tx
        .insert(creditLedger)
        .values({ organizationId: job.orgId, delta: 1, reason: "refund", evaluationId: job.evaluationId, idempotencyKey: `refund:${job.evaluationId}` })
        .onConflictDoNothing();
    }
    await audit(tx, { orgId: job.orgId, actorUserId: null, action: "evaluation.failed", targetType: "evaluation", targetId: job.evaluationId, metadata: { code } });
  });
}

/**
 * Executa uma avaliação. Idempotente: pode ser chamado de novo pela fila sem
 * duplicar cobrança, linhas ou custo.
 * Lança RetryableJobError para falhas transitórias (a fila retenta com backoff).
 */
export async function runEvaluation(job: EvaluateJob): Promise<"completed" | "skipped" | "failed"> {
  let data: Loaded | null;
  try {
    data = await load(job);
  } catch (e) {
    if (e instanceof AppError && e.code === "no_credits") {
      await fail(job, "sem créditos de avaliação", "no_credits");
      return "failed";
    }
    throw e;
  }
  if (!data) return "skipped";
  if (data.done) return "skipped";
  const d = data;
  const attempt = d.ev.attempts;
  const input = buildInput(d);
  const llm = getEvaluationLlm();
  const started = Date.now();

  let result: LlmResult;
  let validated: ReturnType<typeof validateOutput>;
  try {
    result = await llm.evaluate(input);
    validated = validateOutput(result.output, {
      criteria: input.criteria,
      segments: d.segs.map((s, i) => ({ idx: s.idx, startMs: s.startMs, endMs: s.endMs, text: input.segments[i].text })),
      scaleMin: input.scaleMin,
      scaleMax: input.scaleMax,
    });
    await recordUsage(job, attempt, llm.provider, llm.model, result, null, Date.now() - started);
  } catch (e) {
    const isLlm = e instanceof LlmError;
    const code = isLlm ? e.code : e instanceof ZodError ? "invalid_output" : "unexpected";
    const retryable = isLlm ? e.retryable : e instanceof ZodError;
    await recordUsage(job, attempt, llm.provider, llm.model, null, code, Date.now() - started);
    logger.warn({ evaluationId: job.evaluationId, code, attempt }, "falha na avaliação");
    if (retryable && attempt < MAX_ATTEMPTS) {
      const sys = { orgId: job.orgId, userId: null, role: "system" as const };
      await withTenant(sys, (tx) => tx.update(evaluations).set({ status: "queued", error: code }).where(eq(evaluations.id, job.evaluationId)));
      throw new RetryableJobError(code);
    }
    await fail(job, isLlm ? e.message : "resposta inválida do modelo de IA", code);
    return "failed";
  }

  const summary = computeScore(
    d.crit.map((c) => ({ key: c.key, weight: Number(c.weight), mandatory: c.mandatory })),
    validated.criteria,
    { scaleMin: d.rv.v.scaleMin, scaleMax: d.rv.v.scaleMax, thresholds: d.rv.v.thresholds, minCoverage: Number(d.rv.v.minCoverage) },
  );

  const sys = { orgId: job.orgId, userId: null, role: "system" as const };
  await withTenant(sys, async (tx) => {
    // Proteção contra execução concorrente: só grava quem ainda está "running".
    const [lock] = await tx
      .update(evaluations)
      .set({ status: "completed" })
      .where(and(eq(evaluations.id, job.evaluationId), eq(evaluations.status, "running")))
      .returning({ id: evaluations.id });
    if (!lock) return;
    const segIdBy = new Map(d.segs.map((s) => [s.idx, s.id]));
    const critBy = new Map(d.crit.map((c) => [c.key, c]));
    for (const c of validated.criteria) {
      const [cs] = await tx
        .insert(criterionScores)
        .values({
          organizationId: job.orgId,
          evaluationId: job.evaluationId,
          criterionId: critBy.get(c.key)!.id,
          status: c.status,
          score: c.score === null ? null : String(c.score),
          aiStatus: c.status,
          aiScore: c.score === null ? null : String(c.score),
          justification: [c.justification, ...c.notes].filter(Boolean).join("\n"),
          confidence: String(c.confidence),
        })
        .returning({ id: criterionScores.id });
      if (c.evidence.length) {
        await tx.insert(evidenceReferences).values(
          c.evidence.map((e) => ({
            organizationId: job.orgId,
            evaluationId: job.evaluationId,
            criterionScoreId: cs.id,
            segmentId: segIdBy.get(e.segmentIdx) ?? null,
            kind: "criterion" as const,
            quote: e.quote,
            startMs: e.startMs,
            endMs: e.endMs,
            validated: true,
          })),
        );
      }
    }
    const fb = validated.feedback;
    const toItems = (xs: { text: string; segments: number[] }[]) =>
      xs.map((x) => ({ text: x.text, evidenceIds: x.segments.map((i) => segIdBy.get(i)).filter((v): v is string => Boolean(v)) }));
    await tx.insert(feedbackReports).values({
      organizationId: job.orgId,
      evaluationId: job.evaluationId,
      summary: fb.summary,
      objective: fb.objective,
      strengths: toItems(fb.strengths),
      improvements: toItems(fb.improvements),
      objections: fb.objections.map((o) => ({
        objection: o.objection,
        handling: o.handling,
        evidenceIds: o.segments.map((i) => segIdBy.get(i)).filter((v): v is string => Boolean(v)),
      })),
      investigationQuality: fb.investigation_quality,
      nextSteps: toItems(fb.next_steps),
      suggestedQuestions: fb.suggested_questions,
      coachingRecommendations: fb.coaching_recommendations,
    });
    // A nova avaliação passa a ser a vigente; as anteriores ficam no histórico.
    await tx
      .update(evaluations)
      .set({ isCurrent: false, status: "superseded" })
      .where(and(eq(evaluations.conversationId, job.conversationId), ne(evaluations.id, job.evaluationId), eq(evaluations.status, "completed")));
    await tx
      .update(evaluations)
      .set({
        overallScore: summary.overall === null ? null : String(summary.overall),
        classification: summary.classification,
        coverage: String(summary.coverage),
        isCurrent: true,
        completedAt: new Date(),
        model: result.model,
      })
      .where(eq(evaluations.id, job.evaluationId));
    await tx
      .update(conversations)
      .set({ status: "evaluated", statusDetail: null, updatedAt: new Date() })
      .where(eq(conversations.id, job.conversationId));
    await audit(tx, {
      orgId: job.orgId,
      actorUserId: null,
      action: "evaluation.completed",
      targetType: "evaluation",
      targetId: job.evaluationId,
      metadata: { ...validated.stats, overall: summary.overall, coverage: summary.coverage },
    });
  });
  return "completed";
}
