/**
 * Revisão humana das avaliações. Regras:
 *  - Só gestor/admin revisa (permissão evaluation.review).
 *  - A nota original da IA nunca é apagada (ai_score/ai_status); o ajuste fica em score/status.
 *  - Todo ajuste exige motivo e gera um registro imutável em review_overrides.
 *  - A nota geral é recalculada em código após cada ajuste.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import {
  criteria,
  criterionScores,
  evaluations,
  evidenceReferences,
  reviewComments,
  reviewOverrides,
  rubricVersions,
  user,
} from "@/db/schema";
import { computeScore } from "../ai/scoring";
import { audit } from "../audit";
import { assertCan, badRequest, notFound } from "../authz";
import { withTenant } from "../tenancy";
import type { ServiceCtx } from "./types";

async function loadEvaluation(tx: Tx, evaluationId: string) {
  const [ev] = await tx.select().from(evaluations).where(eq(evaluations.id, evaluationId));
  if (!ev) throw notFound("Avaliação não encontrada.");
  if (ev.status !== "completed") throw badRequest("Só é possível revisar avaliações concluídas e vigentes.");
  return ev;
}

/** Recalcula nota geral, classificação e cobertura a partir das notas atuais. */
export async function recomputeEvaluation(tx: Tx, evaluationId: string) {
  const [ev] = await tx.select().from(evaluations).where(eq(evaluations.id, evaluationId));
  const [rv] = await tx.select().from(rubricVersions).where(eq(rubricVersions.id, ev.rubricVersionId));
  const rows = await tx
    .select({ key: criteria.key, weight: criteria.weight, mandatory: criteria.mandatory, status: criterionScores.status, score: criterionScores.score })
    .from(criterionScores)
    .innerJoin(criteria, eq(criteria.id, criterionScores.criterionId))
    .where(eq(criterionScores.evaluationId, evaluationId));
  const s = computeScore(
    rows.map((r) => ({ key: r.key, weight: Number(r.weight), mandatory: r.mandatory })),
    rows.map((r) => ({ key: r.key, status: r.status, score: r.score === null ? null : Number(r.score) })),
    { scaleMin: rv.scaleMin, scaleMax: rv.scaleMax, thresholds: rv.thresholds, minCoverage: Number(rv.minCoverage) },
  );
  await tx
    .update(evaluations)
    .set({ overallScore: s.overall === null ? null : String(s.overall), classification: s.classification, coverage: String(s.coverage) })
    .where(eq(evaluations.id, evaluationId));
  return s;
}

export const overrideInput = z.object({
  status: z.enum(["scored", "not_applicable", "not_evaluable"]),
  score: z.number().nullable().optional(),
  reason: z.string().trim().min(5, "Explique o motivo do ajuste (mínimo 5 caracteres).").max(1000),
  contest: z.boolean().optional(),
});

/** Ajuste (ou contestação) da nota de um critério. */
export async function overrideCriterion(ctx: ServiceCtx, evaluationId: string, criterionScoreId: string, raw: unknown) {
  assertCan(ctx.role, "evaluation.review");
  const input = overrideInput.parse(raw);
  return withTenant(ctx, async (tx) => {
    await loadEvaluation(tx, evaluationId);
    const [cs] = await tx
      .select()
      .from(criterionScores)
      .where(and(eq(criterionScores.id, criterionScoreId), eq(criterionScores.evaluationId, evaluationId)));
    if (!cs) throw notFound("Critério não encontrado nesta avaliação.");
    const [rv] = await tx
      .select({ scaleMin: rubricVersions.scaleMin, scaleMax: rubricVersions.scaleMax })
      .from(rubricVersions)
      .innerJoin(evaluations, eq(evaluations.rubricVersionId, rubricVersions.id))
      .where(eq(evaluations.id, evaluationId));
    let score: number | null = null;
    if (input.status === "scored") {
      if (input.score === null || input.score === undefined || input.score < rv.scaleMin || input.score > rv.scaleMax) {
        throw badRequest(`Informe uma nota entre ${rv.scaleMin} e ${rv.scaleMax}.`);
      }
      score = Math.round(input.score * 10) / 10;
    }
    const before = { status: cs.status, score: cs.score === null ? null : Number(cs.score) };
    await tx
      .update(criterionScores)
      .set({ status: input.status, score: score === null ? null : String(score), overridden: true })
      .where(eq(criterionScores.id, cs.id));
    await tx.insert(reviewOverrides).values({
      organizationId: ctx.orgId,
      evaluationId,
      criterionScoreId: cs.id,
      action: input.contest ? "contest" : input.status !== cs.status ? "status_change" : "score_change",
      before,
      after: { status: input.status, score },
      reason: input.reason,
      actorUserId: ctx.userId,
    });
    // Ajuste reabre a revisão: precisa de nova aprovação.
    await tx.update(evaluations).set({ reviewStatus: input.contest ? "contested" : "in_review", approvedAt: null, approvedBy: null }).where(eq(evaluations.id, evaluationId));
    const summary = await recomputeEvaluation(tx, evaluationId);
    await audit(tx, { orgId: ctx.orgId, actorUserId: ctx.userId, action: "evaluation.criterion_overridden", targetType: "evaluation", targetId: evaluationId, metadata: { criterionScoreId: cs.id, before, after: { status: input.status, score } } });
    return summary;
  });
}

/** Marca (ou desmarca) uma evidência como falso positivo. */
export async function flagEvidence(ctx: ServiceCtx, evaluationId: string, evidenceId: string, raw: unknown) {
  assertCan(ctx.role, "evaluation.review");
  const input = z.object({ falsePositive: z.boolean(), reason: z.string().trim().min(5, "Explique o motivo.").max(1000) }).parse(raw);
  return withTenant(ctx, async (tx) => {
    await loadEvaluation(tx, evaluationId);
    const [e] = await tx
      .update(evidenceReferences)
      .set({ flaggedFalsePositive: input.falsePositive })
      .where(and(eq(evidenceReferences.id, evidenceId), eq(evidenceReferences.evaluationId, evaluationId)))
      .returning();
    if (!e) throw notFound("Evidência não encontrada.");
    await tx.insert(reviewOverrides).values({
      organizationId: ctx.orgId,
      evaluationId,
      criterionScoreId: e.criterionScoreId,
      evidenceId: e.id,
      action: "false_positive",
      before: { flaggedFalsePositive: !input.falsePositive },
      after: { flaggedFalsePositive: input.falsePositive },
      reason: input.reason,
      actorUserId: ctx.userId,
    });
    await audit(tx, { orgId: ctx.orgId, actorUserId: ctx.userId, action: "evaluation.evidence_flagged", targetType: "evaluation", targetId: evaluationId, metadata: { evidenceId, falsePositive: input.falsePositive } });
    return { ok: true };
  });
}

export async function addComment(ctx: ServiceCtx, evaluationId: string, raw: unknown) {
  assertCan(ctx.role, "evaluation.review");
  const input = z.object({ body: z.string().trim().min(1).max(4000), criterionScoreId: z.string().uuid().nullable().optional() }).parse(raw);
  return withTenant(ctx, async (tx) => {
    await loadEvaluation(tx, evaluationId);
    const [c] = await tx
      .insert(reviewComments)
      .values({ organizationId: ctx.orgId, evaluationId, criterionScoreId: input.criterionScoreId ?? null, authorUserId: ctx.userId, body: input.body })
      .returning();
    return c;
  });
}

export async function approveEvaluation(ctx: ServiceCtx, evaluationId: string) {
  assertCan(ctx.role, "evaluation.review");
  return withTenant(ctx, async (tx) => {
    const ev = await loadEvaluation(tx, evaluationId);
    if (!ev.isCurrent) throw badRequest("Só a avaliação vigente pode ser aprovada.");
    await tx.update(evaluations).set({ reviewStatus: "approved", approvedBy: ctx.userId, approvedAt: new Date() }).where(eq(evaluations.id, evaluationId));
    await tx.insert(reviewOverrides).values({ organizationId: ctx.orgId, evaluationId, action: "approve", before: { reviewStatus: ev.reviewStatus }, after: { reviewStatus: "approved" }, actorUserId: ctx.userId });
    await audit(tx, { orgId: ctx.orgId, actorUserId: ctx.userId, action: "evaluation.approved", targetType: "evaluation", targetId: evaluationId });
    return { ok: true };
  });
}

/** Histórico de revisão (ajustes + comentários) para exibir junto ao scorecard. */
export async function reviewHistory(tx: Tx, evaluationId: string) {
  const overrides = await tx
    .select({ o: reviewOverrides, actorName: user.name })
    .from(reviewOverrides)
    .innerJoin(user, eq(user.id, reviewOverrides.actorUserId))
    .where(eq(reviewOverrides.evaluationId, evaluationId))
    .orderBy(desc(reviewOverrides.createdAt));
  const comments = await tx
    .select({ c: reviewComments, authorName: user.name })
    .from(reviewComments)
    .innerJoin(user, eq(user.id, reviewComments.authorUserId))
    .where(eq(reviewComments.evaluationId, evaluationId))
    .orderBy(asc(reviewComments.createdAt));
  return {
    overrides: overrides.map((r) => ({ ...r.o, actorName: r.actorName })),
    comments: comments.map((r) => ({ ...r.c, authorName: r.authorName })),
  };
}
