import { createHash } from "node:crypto";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { criteria, methodologies, rubricVersions, rubrics } from "@/db/schema";
import { audit } from "../audit";
import { assertCan, badRequest } from "../authz";
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
        status: "published",
        scaleMin: 0,
        scaleMax: 10,
        thresholds: DEFAULT_THRESHOLDS,
        minCoverage: "0.5",
        evaluatorGuidance: t.guidance,
        contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
        publishedAt: new Date(),
        publishedBy: ctx.userId,
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
