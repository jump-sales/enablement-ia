import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { creditLedger, orgEntitlements, subscriptionPlans } from "@/db/schema";
import { eq } from "drizzle-orm";
import { MockLlm, setLlmForTesting } from "@/server/ai/llm";
import { runEvaluation } from "@/server/jobs/evaluate";
import { setQueueForTesting, type EvaluateJob } from "@/server/jobs/queue";
import { calibrationAgreement, getCalibrationForm, submitCalibration } from "@/server/services/calibration";
import { createCoachingAction, listCoachingActions, updateCoachingStatus } from "@/server/services/coaching";
import { createConversationFromTranscript, getConversationDetail, listConversations } from "@/server/services/conversations";
import { getDashboard } from "@/server/services/dashboard";
import { createDraft, createFromTemplate, getRubricForEdit, publishDraft, saveDraft } from "@/server/services/methodologies";
import { updateOrganizationSettings } from "@/server/services/organizations";
import { addComment, approveEvaluation, flagEvidence, overrideCriterion } from "@/server/services/reviews";
import { withTenant } from "@/server/tenancy";
import { addMember, makeOrg, ownerQuery, pgErrorOf } from "./helpers";

const jobs: EvaluateJob[] = [];
setQueueForTesting({ enqueueEvaluation: async (j) => void jobs.push(j) });
setLlmForTesting(new MockLlm());

let org: Awaited<ReturnType<typeof makeOrg>>;
let sdr: Awaited<ReturnType<typeof addMember>>;
let manager: Awaited<ReturnType<typeof addMember>>;
let rubricId: string;
let convId: string;
let evalId: string;

const vtt = (n: number) =>
  Buffer.from(
    `WEBVTT\n\n00:00:00.000 --> 00:01:00.000\nBruno Lima: Bom dia! Qual o maior problema no controle das entregas hoje, conversa ${n}?\n\n00:01:00.000 --> 00:02:00.000\nCarla Souza: Atrasos frequentes e planilhas.\n\n00:02:00.000 --> 00:02:30.000\nBruno Lima: Podemos agendar o próximo passo na quinta às 10h com o decisor?\n`,
  );

async function newEvaluatedConversation(n: number) {
  const r = await createConversationFromTranscript(
    org.adminCtx,
    { title: `Conversa ${n}`, type: "sdr_call", ownerUserId: sdr.user.id, rubricId, legalBasis: "consent", participantsNotified: true },
    { name: `c${n}.vtt`, data: vtt(n) },
  );
  await runEvaluation(jobs[jobs.length - 1]);
  return r;
}

beforeAll(async () => {
  org = await makeOrg("gestao");
  sdr = await addMember(org.adminCtx, "rep", "sdr");
  manager = await addMember(org.adminCtx, "manager", "manager");
  await ownerQuery(`update "user" set name = 'Bruno Lima' where id = $1`, [sdr.user.id]);
  rubricId = (await createFromTemplate(org.adminCtx, "sdr_qualification")).rubricId;
  await withTenant({ orgId: org.org.id, userId: null, role: "system" }, async (tx) => {
    await tx.insert(creditLedger).values({ organizationId: org.org.id, delta: 20, reason: "grant" });
  });
  const r = await newEvaluatedConversation(1);
  convId = r.id;
  evalId = r.evaluationId!;
});
afterAll(async () => {
  setLlmForTesting(null);
  await closeDb();
});

describe("revisão humana", () => {
  it("vendedor não revisa", async () => {
    const d = await getConversationDetail(org.adminCtx, convId);
    await expect(overrideCriterion(sdr.ctx, evalId, d.scorecard!.scores[0].s.id, { status: "scored", score: 9, reason: "teste de permissão" })).rejects.toMatchObject({ status: 403 });
  });

  it("ajuste exige motivo, preserva a nota da IA, recalcula a nota geral e fica no histórico", async () => {
    const d = await getConversationDetail(manager.ctx, convId);
    const row = d.scorecard!.scores.find((s) => s.s.status === "scored")!;
    await expect(overrideCriterion(manager.ctx, evalId, row.s.id, { status: "scored", score: 9, reason: "" })).rejects.toThrow();
    await expect(overrideCriterion(manager.ctx, evalId, row.s.id, { status: "scored", score: 11, reason: "nota fora da escala" })).rejects.toMatchObject({ status: 400 });
    const before = Number(d.evaluation!.overallScore);
    const s = await overrideCriterion(manager.ctx, evalId, row.s.id, { status: "scored", score: 10, reason: "O vendedor conduziu muito bem esse ponto." });
    const after = await getConversationDetail(manager.ctx, convId);
    const changed = after.scorecard!.scores.find((x) => x.s.id === row.s.id)!;
    expect(changed.s).toMatchObject({ score: "10.000", overridden: true, aiScore: row.s.aiScore });
    expect(Number(after.evaluation!.overallScore)).toBe(s.overall);
    expect(Number(after.evaluation!.overallScore)).toBeGreaterThanOrEqual(before);
    expect(after.evaluation!.reviewStatus).toBe("in_review");
    expect(after.scorecard!.review.overrides[0]).toMatchObject({ action: "score_change", reason: "O vendedor conduziu muito bem esse ponto." });
  });

  it("marcar 'não aplicável' tira o critério do cálculo (não vira zero)", async () => {
    const d = await getConversationDetail(manager.ctx, convId);
    const row = d.scorecard!.scores.find((s) => s.s.status === "scored")!;
    await overrideCriterion(manager.ctx, evalId, row.s.id, { status: "not_applicable", reason: "Não houve objeção nesta conversa." });
    const after = await getConversationDetail(manager.ctx, convId);
    expect(after.scorecard!.scores.find((x) => x.s.id === row.s.id)!.s.score).toBeNull();
  });

  it("falso positivo, comentário e aprovação", async () => {
    const d = await getConversationDetail(manager.ctx, convId);
    const ev = d.scorecard!.evidence[0];
    await flagEvidence(manager.ctx, evalId, ev.id, { falsePositive: true, reason: "Trecho não sustenta o critério." });
    await addComment(manager.ctx, evalId, { body: "Bom trabalho na abertura." });
    await approveEvaluation(manager.ctx, evalId);
    const after = await getConversationDetail(manager.ctx, convId);
    expect(after.scorecard!.evidence.find((e) => e.id === ev.id)!.flaggedFalsePositive).toBe(true);
    expect(after.scorecard!.review.comments[0].body).toBe("Bom trabalho na abertura.");
    expect(after.evaluation!.reviewStatus).toBe("approved");
    expect(after.scorecard!.review.overrides.map((o) => o.action)).toEqual(expect.arrayContaining(["approve", "false_positive", "score_change", "status_change"]));
  });

  it("com aprovação obrigatória, o vendedor só vê a nota depois de aprovada", async () => {
    await updateOrganizationSettings(org.adminCtx, { requireApprovalBeforeRepVisibility: true });
    const r = await newEvaluatedConversation(2);
    const hidden = await getConversationDetail(sdr.ctx, r.id);
    expect(hidden.pendingApproval).toBe(true);
    expect(hidden.scorecard).toBeNull();
    expect(hidden.evaluation!.overallScore).toBeNull();
    const list = await listConversations(sdr.ctx);
    expect(list.find((c) => c.id === r.id)!.evaluation!.overallScore).toBeNull();
    expect((await getConversationDetail(manager.ctx, r.id)).scorecard).not.toBeNull();
    await approveEvaluation(manager.ctx, r.evaluationId!);
    const visible = await getConversationDetail(sdr.ctx, r.id);
    expect(visible.pendingApproval).toBe(false);
    expect(visible.scorecard).not.toBeNull();
    await updateOrganizationSettings(org.adminCtx, { requireApprovalBeforeRepVisibility: false });
  });
});

describe("editor de metodologia e versões", () => {
  it("rascunho → edição → publicação; avaliações antigas continuam na versão anterior", async () => {
    const before = await getRubricForEdit(org.adminCtx, rubricId);
    const oldVersionId = before.current!.id;
    await expect(createDraft(manager.ctx, rubricId)).rejects.toMatchObject({ status: 403 });
    const { versionId } = await createDraft(org.adminCtx, rubricId);
    expect((await createDraft(org.adminCtx, rubricId)).versionId).toBe(versionId); // idempotente
    const ed = await getRubricForEdit(org.adminCtx, rubricId);
    const crit = ed.draft!.criteria.map((c) => ({
      key: c.key, competency: c.competency, name: c.name, description: c.description, anchors: c.behavioralAnchors,
      weight: Number(c.weight), mandatory: c.mandatory, applicability: c.applicability, guidance: c.guidance,
    }));
    crit[0].weight = 3;
    crit.push({ key: "tom_de_voz", competency: "Comunicação", name: "Tom de voz", description: "Fala com clareza e cordialidade.", anchors: { "0": "Ríspido", "10": "Cordial e claro" }, weight: 1, mandatory: false, applicability: null, guidance: null });
    const payload = { scaleMin: 0, scaleMax: 10, thresholds: [{ label: "Bom", minScore: 7 }, { label: "Baixo", minScore: 0 }], minCoverage: 0.5, evaluatorGuidance: "Empresa valoriza agendamento.", criteria: crit };
    await expect(saveDraft(org.adminCtx, versionId, { ...payload, criteria: [...crit, crit[0]] })).rejects.toThrow(/repetida/);
    await expect(saveDraft(org.adminCtx, versionId, { ...payload, thresholds: [{ label: "X", minScore: 50 }] })).rejects.toThrow(/fora da escala/);
    await saveDraft(org.adminCtx, versionId, payload);
    const pub = await publishDraft(org.adminCtx, versionId);
    expect(pub.version).toBe(2);
    const after = await getRubricForEdit(org.adminCtx, rubricId);
    expect(after.current!.id).toBe(versionId);
    expect(after.current!.criteria).toHaveLength(crit.length);
    expect(after.versions.find((v) => v.id === oldVersionId)!.status).toBe("archived");
    await expect(saveDraft(org.adminCtx, versionId, payload)).rejects.toMatchObject({ code: "version_published" });
    const [old] = await ownerQuery<{ rubric_version_id: string }>(`select rubric_version_id from evaluations where id = $1`, [evalId]);
    expect(old.rubric_version_id).toBe(oldVersionId);
  });

  it("o banco recusa alterar versão publicada mesmo sem passar pelo serviço", async () => {
    const ed = await getRubricForEdit(org.adminCtx, rubricId);
    const msg = await pgErrorOf(() =>
      withTenant(org.adminCtx, (tx) => tx.execute(`update criteria set weight = 99 where rubric_version_id = '${ed.current!.id}'` as never)),
    );
    expect(msg).toMatch(/imutáve/);
    const msg2 = await pgErrorOf(() =>
      withTenant(org.adminCtx, (tx) => tx.execute(`update rubric_versions set min_coverage = 0 where id = '${ed.current!.id}'` as never)),
    );
    expect(msg2).toMatch(/imutável/);
  });
});

describe("calibração", () => {
  it("exige o plano Treinamento", async () => {
    await expect(submitCalibration(manager.ctx, convId, { scores: {} })).rejects.toMatchObject({ code: "feature_not_in_plan" });
  });

  it("mede concordância contra a nota ORIGINAL da IA", async () => {
    await withTenant({ orgId: org.org.id, userId: null, role: "system" }, async (tx) => {
      const [plan] = await tx.select().from(subscriptionPlans).where(eq(subscriptionPlans.code, "treinamento"));
      await tx.insert(orgEntitlements).values({ organizationId: org.org.id, planId: plan.id, kind: plan.kind, endsAt: new Date(Date.now() + 30 * 86400000) });
    });
    const r = await newEvaluatedConversation(3);
    const form = await getCalibrationForm(manager.ctx, r.id);
    const d = await getConversationDetail(manager.ctx, r.id);
    const ai = new Map(d.scorecard!.scores.map((s) => [s.name, s.s]));
    // Gestor concorda em tudo, exceto em 1 critério pontuado (diferença de 4 pontos).
    let diverged = false;
    const scores = Object.fromEntries(
      form.criteria.map((c) => {
        const s = ai.get(c.name)!;
        if (s.aiStatus !== "scored") return [c.key, { status: s.aiStatus }];
        const v = Number(s.aiScore);
        if (!diverged) {
          diverged = true;
          return [c.key, { status: "scored", score: v >= 5 ? v - 4 : v + 4 }];
        }
        return [c.key, { status: "scored", score: v }];
      }),
    );
    await expect(submitCalibration(manager.ctx, r.id, { scores: {} })).rejects.toMatchObject({ status: 400 });
    await expect(submitCalibration(sdr.ctx, r.id, { scores })).rejects.toMatchObject({ status: 403 });
    await submitCalibration(manager.ctx, r.id, { scores, notes: "Referência do gestor" });
    const ag = await calibrationAgreement(manager.ctx);
    expect(ag.enabled).toBe(true);
    const conv = ag.conversations.find((c) => c.conversationId === r.id)!;
    const scoredPairs = ag.criteria.reduce((s, c) => s + c.pairs, 0);
    expect(scoredPairs).toBeGreaterThan(0);
    expect(conv.agreedPct).toBe(Math.round(((scoredPairs - 1) / scoredPairs) * 100));
    expect(ag.criteria.find((c) => c.agreed < c.pairs)!.meanAbsDiff).toBe(4);
  });
});

describe("painéis", () => {
  it("vendedor vê só os próprios dados; gestor vê a equipe, pendências e custo", async () => {
    const mine = await getDashboard(sdr.ctx);
    expect(mine.scope).toBe("individual");
    expect(mine.people).toEqual([]);
    expect(mine.trend[mine.trend.length - 1].count).toBeGreaterThan(0);
    expect(mine.byCompetency.length).toBeGreaterThan(0);
    const team = await getDashboard(manager.ctx);
    expect(team.scope).toBe("team");
    expect(team.people.find((p) => p.userId === sdr.user.id)!.count).toBeGreaterThan(0);
    expect(team.cost.evaluationsThisMonth).toBeGreaterThan(0);
    expect(team.evolutionEnabled).toBe(true);
    expect(team.trend).toHaveLength(6);
    // Mês sem conversas aparece vazio, não como zero.
    expect(team.trend[0]).toMatchObject({ avg: null, count: 0 });
  });

  it("isolamento: outra empresa não enxerga nada", async () => {
    const other = await makeOrg("outra-dash");
    const d = await getDashboard(other.adminCtx);
    expect(d.trend.every((t) => t.count === 0)).toBe(true);
    expect(d.people).toEqual([]);
  });
});

describe("coaching", () => {
  it("gestor atribui; vendedor vê só as próprias e atualiza o andamento, mas não descarta", async () => {
    await expect(createCoachingAction(sdr.ctx, { userId: sdr.user.id, title: "Auto-atribuição" })).rejects.toMatchObject({ status: 403 });
    const a = await createCoachingAction(manager.ctx, { userId: sdr.user.id, title: "Praticar perguntas de implicação", evaluationId: evalId, criterionKey: "qualificacao_dor" });
    await createCoachingAction(manager.ctx, { userId: manager.user.id, title: "Ação de outra pessoa" });
    const mine = await listCoachingActions(sdr.ctx);
    expect(mine.map((x) => x.title)).toEqual(["Praticar perguntas de implicação"]);
    expect((await updateCoachingStatus(sdr.ctx, a.id, { status: "done" })).status).toBe("done");
    await expect(updateCoachingStatus(sdr.ctx, a.id, { status: "dismissed" })).rejects.toMatchObject({ status: 403 });
    expect((await listCoachingActions(manager.ctx)).length).toBe(2);
  });
});
