import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { DEFAULT_ORG_SETTINGS, memberships, orgLimits, organizations, type OrgSettings } from "@/db/schema";
import { audit } from "../audit";
import { assertCan, badRequest } from "../authz";
import { withTenant } from "../tenancy";
import type { ServiceCtx } from "./types";

export const createOrgInput = z.object({
  name: z.string().trim().min(2, "Informe o nome da empresa.").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/, "Use 3–48 letras minúsculas, números ou hífens."),
});

export function slugify(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function slugTaken(slug: string) {
  const r = await getDb().execute<{ taken: boolean }>(sql`select app_slug_taken(${slug}) as taken`);
  return Boolean(r.rows[0]?.taken);
}

/** Cria a empresa e torna o usuário seu administrador. */
export async function createOrganization(userId: string, input: z.input<typeof createOrgInput>) {
  const data = createOrgInput.parse(input);
  if (await slugTaken(data.slug)) throw badRequest("Este identificador já está em uso.", "slug_taken");
  const orgId = crypto.randomUUID();
  await withTenant({ orgId, userId, role: "org_admin" }, async (tx) => {
    await tx.insert(organizations).values({ id: orgId, name: data.name, slug: data.slug });
    await tx.insert(memberships).values({ organizationId: orgId, userId, role: "org_admin", jobTitle: "manager" });
    await tx.insert(orgLimits).values({ organizationId: orgId });
    await audit(tx, { orgId, actorUserId: userId, action: "organization.created", targetType: "organization", targetId: orgId });
  });
  return { id: orgId, ...data };
}

export const updateSettingsInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    mediaRetentionDays: z.number().int().min(0).max(3650),
    dataRetentionDays: z.number().int().min(30).max(3650),
    minDurationForEvaluationSec: z.number().int().min(10).max(600),
    redactPii: z.boolean(),
    requireApprovalBeforeRepVisibility: z.boolean(),
  })
  .partial();

export async function getOrganization(ctx: ServiceCtx) {
  return withTenant(ctx, async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, ctx.orgId));
    const [limits] = await tx.select().from(orgLimits).where(eq(orgLimits.organizationId, ctx.orgId));
    return { ...org, limits };
  });
}

export async function updateOrganizationSettings(ctx: ServiceCtx, input: z.input<typeof updateSettingsInput>) {
  assertCan(ctx.role, "org.settings.manage");
  const { name, ...settings } = updateSettingsInput.parse(input);
  return withTenant(ctx, async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, ctx.orgId));
    const next: OrgSettings = { ...DEFAULT_ORG_SETTINGS, ...org.settings, ...settings, allowProviderTraining: false };
    await tx
      .update(organizations)
      .set({ name: name ?? org.name, settings: next, updatedAt: new Date() })
      .where(eq(organizations.id, ctx.orgId));
    await audit(tx, {
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "organization.settings_updated",
      targetType: "organization",
      targetId: ctx.orgId,
      metadata: { before: org.settings, after: next, nameChanged: name !== undefined && name !== org.name },
    });
    return next;
  });
}
