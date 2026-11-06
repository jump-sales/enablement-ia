/**
 * Calibração por empresa: o gestor avalia conversas de referência com a mesma rubrica;
 * o sistema compara com a nota ORIGINAL da IA (antes de ajustes) para medir concordância.
 * É assim que cada cliente define, na prática, o que é "bom" e "abaixo do esperado".
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { calibrationReferences, conversations, criteria, criterionScores, evaluations, rubricVersions, user } from "@/db/schema";
import { audit } from "../audit";
import { AppError, assertCan, badRequest, notFound } from "../authz";
import { withTenant } from "../tenancy";
import { activeFeatures } from "./billing";
import type { ServiceCtx } from "./types";

const scoreEntry = z.object({ status: z.enum(["scored", "not_applicable", "not_evaluable"]), score: z.number().nullable().optional() });
export const calibrationInput = z.object({ scores: z.record(z.string(), scoreEntry), notes: z.string().trim().max(2000).optional() });

async function assertFeature(tx: Parameters<Parameters<typeof withTenant>[1]>[0], orgId: string) {
  if (!(await activeFeatures(tx, orgId)).has("calibration")) {
    throw new AppError(402, "feature_not_in_plan", "A calibração faz parte do plano Treinamento.");
  }
}

export async function submitCalibration(ctx: ServiceCtx, conversationId: string, raw: unknown) {
  assertCan(ctx.role, "calibration.manage");
  const input = calibrationInput.parse(raw);
  return withTenant(ctx, async (tx) => {
    await assertFeature(tx, ctx.orgId);
    const [ev] = await tx
      .select()
      .from(evaluations)
      .where(and(eq(evaluations.conversationId, conversationId), eq(evaluations.isCurrent, true), eq(evaluations.status, "completed")));
    if (!ev) throw badRequest("A conversa precisa ter uma avaliação concluída para ser usada na calibração.");
    const [rv] = await tx.select().from(rubricVersions).where(eq(rubricVersions.id, ev.rubricVersionId));
    const crit = await tx.select().from(criteria).where(eq(criteria.rubricVersionId, ev.rubricVersionId));
    for (const c of crit) {
      const s = input.scores[c.key];
      if (!s) throw badRequest(`Avalie o critério “${c.name}”.`);
      if (s.status === "scored" && (s.score === null || s.score === undefined || s.score < rv.scaleMin || s.score > rv.scaleMax)) {
        throw badRequest(`Nota de “${c.name}” deve estar entre ${rv.scaleMin} e ${rv.scaleMax}.`);
      }
    }
    const clean = Object.fromEntries(
      crit.map((c) => {
        const s = input.scores[c.key];
        return [c.key, s.status === "scored" ? { status: s.status, score: s.score as number } : { status: s.status }];
      }),
    );
    const [ref] = await tx
      .insert(calibrationReferences)
      .values({ organizationId: ctx.orgId, conversationId, rubricVersionId: ev.rubricVersionId, reviewerUserId: ctx.userId, scores: clean, notes: input.notes ?? null })
      .returning({ id: calibrationReferences.id });
    await audit(tx, { orgId: ctx.orgId, actorUserId: ctx.userId, action: "calibration.submitted", targetType: "conversation", targetId: conversationId });
    return ref;
  });
}

export type AgreementRow = { key: string; name: string; pairs: number; agreed: number; meanAbsDiff: number | null; statusMatches: number; statusTotal: number };

/**
 * Concordância IA × gestor, por critério. Considera "concorda" quando a diferença
 * é de até 10% da escala (1 ponto em 0–10). Usa a referência mais recente por conversa.
 */
export async function calibrationAgreement(ctx: ServiceCtx) {
  assertCan(ctx.role, "calibration.manage");
  return withTenant(ctx, async (tx) => {
    const enabled = (await activeFeatures(tx, ctx.orgId)).has("calibration");
    const refs = await tx
      .select({ r: calibrationReferences, title: conversations.title, reviewer: user.name })
      .from(calibrationReferences)
      .innerJoin(conversations, eq(conversations.id, calibrationReferences.conversationId))
      .innerJoin(user, eq(user.id, calibrationReferences.reviewerUserId))
      .orderBy(desc(calibrationReferences.createdAt));
    const latest = new Map<string, (typeof refs)[number]>();
    for (const x of refs) if (!latest.has(x.r.conversationId)) latest.set(x.r.conversationId, x);

    const rows = new Map<string, AgreementRow & { diffSum: number }>();
    const conversationsOut: { conversationId: string; title: string; reviewer: string; agreedPct: number | null }[] = [];
    for (const { r, title, reviewer } of latest.values()) {
      const [rv] = await tx.select().from(rubricVersions).where(eq(rubricVersions.id, r.rubricVersionId));
      const tol = (rv.scaleMax - rv.scaleMin) * 0.1;
      // Avaliação da IA com a MESMA versão de rubrica (vigente ou do histórico).
      const [aiEval] = await tx
        .select()
        .from(evaluations)
        .where(
          and(
            eq(evaluations.conversationId, r.conversationId),
            eq(evaluations.rubricVersionId, r.rubricVersionId),
            inArray(evaluations.status, ["completed", "superseded"]),
          ),
        )
        .orderBy(desc(evaluations.createdAt));
      if (!aiEval) continue;
      const ai = await tx
        .select({ key: criteria.key, name: criteria.name, aiStatus: criterionScores.aiStatus, aiScore: criterionScores.aiScore })
        .from(criterionScores)
        .innerJoin(criteria, eq(criteria.id, criterionScores.criterionId))
        .where(eq(criterionScores.evaluationId, aiEval.id));
      let convPairs = 0;
      let convAgreed = 0;
      for (const a of ai) {
        const h = r.scores[a.key];
        if (!h) continue;
        const row = rows.get(a.key) ?? { key: a.key, name: a.name, pairs: 0, agreed: 0, meanAbsDiff: null, statusMatches: 0, statusTotal: 0, diffSum: 0 };
        row.statusTotal++;
        if (h.status === a.aiStatus) row.statusMatches++;
        if (h.status === "scored" && a.aiStatus === "scored" && a.aiScore !== null && h.score !== undefined) {
          const diff = Math.abs(Number(a.aiScore) - h.score);
          row.pairs++;
          row.diffSum += diff;
          convPairs++;
          if (diff <= tol + 1e-9) {
            row.agreed++;
            convAgreed++;
          }
        }
        rows.set(a.key, row);
      }
      conversationsOut.push({ conversationId: r.conversationId, title, reviewer, agreedPct: convPairs ? Math.round((convAgreed / convPairs) * 100) : null });
    }
    const criteriaOut = [...rows.values()].map(({ diffSum, ...r }) => ({ ...r, meanAbsDiff: r.pairs ? Math.round((diffSum / r.pairs) * 100) / 100 : null }));
    const pairs = criteriaOut.reduce((s, r) => s + r.pairs, 0);
    const agreed = criteriaOut.reduce((s, r) => s + r.agreed, 0);
    return {
      enabled,
      conversations: conversationsOut,
      criteria: criteriaOut,
      overall: { pairs, agreedPct: pairs ? Math.round((agreed / pairs) * 100) : null },
    };
  });
}

export async function getCalibrationForm(ctx: ServiceCtx, conversationId: string) {
  assertCan(ctx.role, "calibration.manage");
  return withTenant(ctx, async (tx) => {
    const [ev] = await tx
      .select()
      .from(evaluations)
      .where(and(eq(evaluations.conversationId, conversationId), eq(evaluations.isCurrent, true), eq(evaluations.status, "completed")));
    if (!ev) throw notFound("Avaliação concluída não encontrada.");
    const [rv] = await tx.select().from(rubricVersions).where(eq(rubricVersions.id, ev.rubricVersionId));
    const crit = await tx.select().from(criteria).where(eq(criteria.rubricVersionId, ev.rubricVersionId));
    return { scaleMin: rv.scaleMin, scaleMax: rv.scaleMax, criteria: crit.sort((a, b) => a.position - b.position).map((c) => ({ key: c.key, name: c.name, anchors: c.behavioralAnchors, applicability: c.applicability })) };
  });
}
