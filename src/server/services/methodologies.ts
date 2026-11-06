import { createHash } from "node:crypto";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { criteria, methodologies, rubricVersions, rubrics } from "@/db/schema";
import { audit } from "../audit";
import { assertCan, badRequest, conflict } from "../authz";
import { DEFAULT_THRESHOLDS, METHODOLOGY_TEMPLATES } from "../methodology/templates";
import { withTenant } from "../tenancy";
import type { ServiceCtx } from "./types";

export function listTemplates() {
  return METHODOLOGY_TEMPLATES.map((t) => ({
    key: t.key,
    name: t.name,
    appliesTo: t.appliesTo,
    description: t.description,
    criteria: t.criteria.map((c) => ({ name: c.name, weight: c.weight, mandatory: Boolean(c.mandatory) })),
  }));
}

/** Cria metodologia + rubrica + versão 1 publicada a partir de um template. */
export async function createFromTemplate(ctx: ServiceCtx, templateKey: string) {
  assertCan(ctx.role, "methodology.manage");
  const t = METHODOLOGY_TEMPLATES.find((x) => x.key === templateKey);
  if (!t) throw badRequest("Modelo de metodologia desconhecido.");
  return withTenant(ctx, async (tx) => {
    const [m] = await tx
      .insert(methodologies)
      .values({ organizationId: ctx.orgId, name: t.name, template: t.key, description: t.description })
      .returning();
    const [r] = await tx
      .insert(rubrics)
      .values({ organizationId: ctx.orgId, methodologyId: m.id, name: t.name, appliesTo: t.appliesTo })
      .returning();
    const content = { thresholds: DEFAULT_THRESHOLDS, guidance: t.guidance, criteria: t.criteria };
    const [v] = await tx
      .insert(rubricVersions)
      .values({
        organizationId: ctx.orgId,
        rubricId: r.id,
        version: 1,
        status: "draft",
        scaleMin: 0,
        scaleMax: 10,
        thresholds: DEFAULT_THRESHOLDS,
        minCoverage: "0.5",
        evaluatorGuidance: t.guidance,
        contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
      })
      .returning();
    await tx.insert(criteria).values(
      t.criteria.map((c, i) => ({
        organizationId: ctx.orgId,
        rubricVersionId: v.id,
        key: c.key,
        competency: c.competency,
        name: c.name,
        description: c.description,
        behavioralAnchors: c.anchors,
        weight: String(c.weight),
        mandatory: Boolean(c.mandatory),
        applicability: c.applicability ?? null,
        position: i,
      })),
    );
    // Publica depois de inserir os critérios (versão publicada não aceita alterações).
    await tx.update(rubricVersions).set({ status: "published", publishedAt: new Date(), publishedBy: ctx.userId }).where(eq(rubricVersions.id, v.id));
    await tx.update(rubrics).set({ currentVersionId: v.id }).where(eq(rubrics.id, r.id));
    await audit(tx, {
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "methodology.created_from_template",
      targetType: "rubric",
      targetId: r.id,
      metadata: { template: t.key },
    });
    return { methodologyId: m.id, rubricId: r.id, rubricVersionId: v.id };
  });
}

/** Rubricas da empresa com a versão vigente e seus critérios. */
export async function listRubrics(ctx: ServiceCtx) {
  assertCan(ctx.role, "methodology.view");
  return withTenant(ctx, async (tx) => {
    const rs = await tx
      .select({ id: rubrics.id, name: rubrics.name, appliesTo: rubrics.appliesTo, currentVersionId: rubrics.currentVersionId, template: methodologies.template })
      .from(rubrics)
      .innerJoin(methodologies, eq(methodologies.id, rubrics.methodologyId))
      .orderBy(desc(rubrics.createdAt));
    const versionIds = rs.map((r) => r.currentVersionId).filter((x): x is string => Boolean(x));
    const versions = versionIds.length ? await tx.select().from(rubricVersions).where(inArray(rubricVersions.id, versionIds)) : [];
    const crit = versionIds.length
      ? await tx.select().from(criteria).where(inArray(criteria.rubricVersionId, versionIds)).orderBy(asc(criteria.position))
      : [];
    return rs.map((r) => ({
      ...r,
      version: versions.find((v) => v.id === r.currentVersionId) ?? null,
      criteria: crit.filter((c) => c.rubricVersionId === r.currentVersionId),
    }));
  });
}

/* ------------------------------------------------------------------ */
/* Editor: rascunho → publicação de nova versão                        */
/* ------------------------------------------------------------------ */
const criterionInput = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{2,40}$/, "Chave do critério: use letras minúsculas, números e _ (2–40)."),
  competency: z.string().trim().min(2).max(60),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(5).max(600),
  anchors: z.record(z.string().regex(/^\d+(\.\d+)?$/), z.string().trim().max(400)).default({}),
  weight: z.number().gt(0, "Peso deve ser maior que zero.").max(100),
  mandatory: z.boolean().default(false),
  applicability: z.string().trim().max(400).nullable().optional(),
  guidance: z.string().trim().max(600).nullable().optional(),
});

export const draftInput = z
  .object({
    scaleMin: z.number().int().min(0).max(1),
    scaleMax: z.number().int().refine((v) => [5, 10, 100].includes(v), "Escala máxima: 5, 10 ou 100."),
    thresholds: z.array(z.object({ label: z.string().trim().min(1).max(40), minScore: z.number() })).min(1).max(8),
    minCoverage: z.number().min(0).max(1),
    evaluatorGuidance: z.string().trim().max(2000).nullable().optional(),
    criteria: z.array(criterionInput).min(1, "Inclua pelo menos um critério.").max(25),
  })
  .superRefine((d, ctx) => {
    const keys = d.criteria.map((c) => c.key);
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dup) ctx.addIssue({ code: "custom", message: `Chave de critério repetida: ${dup}.` });
    for (const c of d.criteria) {
      for (const lvl of Object.keys(c.anchors)) {
        const v = Number(lvl);
        if (v < d.scaleMin || v > d.scaleMax) ctx.addIssue({ code: "custom", message: `Âncora ${lvl} fora da escala em “${c.name}”.` });
      }
    }
    for (const t of d.thresholds) {
      if (t.minScore < d.scaleMin || t.minScore > d.scaleMax) ctx.addIssue({ code: "custom", message: `Limiar “${t.label}” fora da escala.` });
    }
  });

/** Rubrica com a versão vigente e o rascunho (se houver), para o editor. */
export async function getRubricForEdit(ctx: ServiceCtx, rubricId: string) {
  assertCan(ctx.role, "methodology.view");
  return withTenant(ctx, async (tx) => {
    const [r] = await tx.select().from(rubrics).where(eq(rubrics.id, rubricId));
    if (!r) throw badRequest("Metodologia não encontrada.");
    const versions = await tx.select().from(rubricVersions).where(eq(rubricVersions.rubricId, rubricId)).orderBy(desc(rubricVersions.version));
    const draft = versions.find((v) => v.status === "draft") ?? null;
    const current = versions.find((v) => v.id === r.currentVersionId) ?? null;
    const ids = [draft?.id, current?.id].filter((x): x is string => Boolean(x));
    const crit = ids.length ? await tx.select().from(criteria).where(inArray(criteria.rubricVersionId, ids)).orderBy(asc(criteria.position)) : [];
    const pick = (v: typeof current) =>
      v ? { ...v, criteria: crit.filter((c) => c.rubricVersionId === v.id) } : null;
    return {
      rubric: r,
      current: pick(current),
      draft: pick(draft),
      versions: versions.map((v) => ({ id: v.id, version: v.version, status: v.status, publishedAt: v.publishedAt })),
    };
  });
}

/** Cria (ou reaproveita) um rascunho copiando a versão vigente. */
export async function createDraft(ctx: ServiceCtx, rubricId: string) {
  assertCan(ctx.role, "methodology.manage");
  return withTenant(ctx, async (tx) => {
    const [r] = await tx.select().from(rubrics).where(eq(rubrics.id, rubricId));
    if (!r?.currentVersionId) throw badRequest("Metodologia sem versão vigente.");
    const versions = await tx.select().from(rubricVersions).where(eq(rubricVersions.rubricId, rubricId));
    const existing = versions.find((v) => v.status === "draft");
    if (existing) return { versionId: existing.id };
    const cur = versions.find((v) => v.id === r.currentVersionId)!;
    const nextVersion = Math.max(...versions.map((v) => v.version)) + 1;
    const [d] = await tx
      .insert(rubricVersions)
      .values({
        organizationId: ctx.orgId,
        rubricId,
        version: nextVersion,
        status: "draft",
        scaleMin: cur.scaleMin,
        scaleMax: cur.scaleMax,
        thresholds: cur.thresholds,
        minCoverage: cur.minCoverage,
        evaluatorGuidance: cur.evaluatorGuidance,
      })
      .returning();
    const crit = await tx.select().from(criteria).where(eq(criteria.rubricVersionId, cur.id)).orderBy(asc(criteria.position));
    if (crit.length) {
      await tx.insert(criteria).values(
        crit.map((c) => ({
          organizationId: ctx.orgId,
          rubricVersionId: d.id,
          key: c.key,
          competency: c.competency,
          name: c.name,
          description: c.description,
          behavioralAnchors: c.behavioralAnchors,
          weight: c.weight,
          mandatory: c.mandatory,
          applicability: c.applicability,
          guidance: c.guidance,
          position: c.position,
        })),
      );
    }
    await audit(tx, { orgId: ctx.orgId, actorUserId: ctx.userId, action: "methodology.draft_created", targetType: "rubric_version", targetId: d.id, metadata: { version: nextVersion } });
    return { versionId: d.id };
  });
}

async function loadDraft(tx: Tx, versionId: string) {
  const [v] = await tx.select().from(rubricVersions).where(eq(rubricVersions.id, versionId));
  if (!v) throw badRequest("Versão não encontrada.");
  if (v.status !== "draft") throw conflict("Esta versão já foi publicada e não pode ser alterada. Crie um novo rascunho.", "version_published");
  return v;
}

/** Substitui o conteúdo do rascunho (critérios, escala, limiares, orientações). */
export async function saveDraft(ctx: ServiceCtx, versionId: string, raw: unknown) {
  assertCan(ctx.role, "methodology.manage");
  const input = draftInput.parse(raw);
  return withTenant(ctx, async (tx) => {
    await loadDraft(tx, versionId);
    await tx
      .update(rubricVersions)
      .set({
        scaleMin: input.scaleMin,
        scaleMax: input.scaleMax,
        thresholds: [...input.thresholds].sort((a, b) => b.minScore - a.minScore),
        minCoverage: String(input.minCoverage),
        evaluatorGuidance: input.evaluatorGuidance ?? null,
      })
      .where(eq(rubricVersions.id, versionId));
    await tx.delete(criteria).where(eq(criteria.rubricVersionId, versionId));
    await tx.insert(criteria).values(
      input.criteria.map((c, i) => ({
        organizationId: ctx.orgId,
        rubricVersionId: versionId,
        key: c.key,
        competency: c.competency,
        name: c.name,
        description: c.description,
        behavioralAnchors: c.anchors,
        weight: String(c.weight),
        mandatory: c.mandatory,
        applicability: c.applicability || null,
        guidance: c.guidance || null,
        position: i,
      })),
    );
    return { ok: true };
  });
}

/** Publica o rascunho: vira a versão vigente; a anterior fica arquivada (e intacta). */
export async function publishDraft(ctx: ServiceCtx, versionId: string) {
  assertCan(ctx.role, "methodology.manage");
  return withTenant(ctx, async (tx) => {
    const v = await loadDraft(tx, versionId);
    const crit = await tx.select().from(criteria).where(eq(criteria.rubricVersionId, versionId)).orderBy(asc(criteria.position));
    if (!crit.length) throw badRequest("Inclua pelo menos um critério antes de publicar.");
    const content = {
      scale: [v.scaleMin, v.scaleMax],
      thresholds: v.thresholds,
      minCoverage: v.minCoverage,
      guidance: v.evaluatorGuidance,
      criteria: crit.map((c) => ({ key: c.key, competency: c.competency, name: c.name, description: c.description, anchors: c.behavioralAnchors, weight: c.weight, mandatory: c.mandatory, applicability: c.applicability, guidance: c.guidance })),
    };
    const [r] = await tx.select().from(rubrics).where(eq(rubrics.id, v.rubricId));
    await tx
      .update(rubricVersions)
      .set({ status: "published", publishedAt: new Date(), publishedBy: ctx.userId, contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex") })
      .where(eq(rubricVersions.id, versionId));
    if (r.currentVersionId) await tx.update(rubricVersions).set({ status: "archived" }).where(eq(rubricVersions.id, r.currentVersionId));
    await tx.update(rubrics).set({ currentVersionId: versionId }).where(eq(rubrics.id, v.rubricId));
    await audit(tx, { orgId: ctx.orgId, actorUserId: ctx.userId, action: "methodology.version_published", targetType: "rubric_version", targetId: versionId, metadata: { version: v.version } });
    return { ok: true, version: v.version };
  });
}

export async function discardDraft(ctx: ServiceCtx, versionId: string) {
  assertCan(ctx.role, "methodology.manage");
  return withTenant(ctx, async (tx) => {
    await loadDraft(tx, versionId);
    await tx.delete(criteria).where(eq(criteria.rubricVersionId, versionId));
    await tx.delete(rubricVersions).where(eq(rubricVersions.id, versionId));
    return { ok: true };
  });
}
