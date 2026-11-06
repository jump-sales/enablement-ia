import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { memberships, teams, user } from "@/db/schema";
import { audit } from "../audit";
import { assertCan, badRequest, conflict, notFound } from "../authz";
import { withTenant } from "../tenancy";
import type { ServiceCtx } from "./types";

export const roleSchema = z.enum(["org_admin", "manager", "rep"]);
export const jobTitleSchema = z.enum(["sdr", "closer", "manager", "other"]);

export async function listMembers(ctx: ServiceCtx) {
  assertCan(ctx.role, "members.view");
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: memberships.id,
        userId: memberships.userId,
        name: user.name,
        email: user.email,
        role: memberships.role,
        jobTitle: memberships.jobTitle,
        teamId: memberships.teamId,
        teamName: teams.name,
        status: memberships.status,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .leftJoin(teams, eq(teams.id, memberships.teamId))
      .where(eq(memberships.organizationId, ctx.orgId))
      .orderBy(user.name),
  );
}

export const updateMemberInput = z
  .object({
    role: roleSchema,
    jobTitle: jobTitleSchema.nullable(),
    teamId: z.string().uuid().nullable(),
    status: z.enum(["active", "disabled"]),
  })
  .partial();

export async function updateMember(ctx: ServiceCtx, membershipId: string, input: z.input<typeof updateMemberInput>) {
  assertCan(ctx.role, "members.manage");
  const data = updateMemberInput.parse(input);
  return withTenant(ctx, async (tx) => {
    const [m] = await tx.select().from(memberships).where(eq(memberships.id, membershipId));
    if (!m) throw notFound("Membro não encontrado.");
    const demotingAdmin = m.role === "org_admin" && ((data.role && data.role !== "org_admin") || data.status === "disabled");
    if (demotingAdmin) {
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(memberships)
        .where(and(eq(memberships.role, "org_admin"), eq(memberships.status, "active"), ne(memberships.id, m.id)));
      if (n === 0) throw conflict("A empresa precisa de pelo menos um administrador ativo.", "last_admin");
    }
    if (data.teamId) {
      const [t] = await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, data.teamId));
      if (!t) throw badRequest("Time inválido.");
    }
    const [updated] = await tx
      .update(memberships)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(memberships.id, membershipId))
      .returning();
    await audit(tx, {
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "member.updated",
      targetType: "membership",
      targetId: membershipId,
      metadata: { before: { role: m.role, jobTitle: m.jobTitle, teamId: m.teamId, status: m.status }, after: data },
    });
    return updated;
  });
}

export const teamInput = z.object({ name: z.string().trim().min(2).max(80) });

export async function listTeams(ctx: ServiceCtx) {
  return withTenant(ctx, (tx) => tx.select().from(teams).orderBy(teams.name));
}

export async function createTeam(ctx: ServiceCtx, input: z.input<typeof teamInput>) {
  assertCan(ctx.role, "teams.manage");
  const data = teamInput.parse(input);
  return withTenant(ctx, async (tx) => {
    const existing = await tx.select({ id: teams.id }).from(teams).where(eq(teams.name, data.name));
    if (existing.length) throw conflict("Já existe um time com esse nome.");
    const [t] = await tx.insert(teams).values({ organizationId: ctx.orgId, name: data.name }).returning();
    await audit(tx, { orgId: ctx.orgId, actorUserId: ctx.userId, action: "team.created", targetType: "team", targetId: t.id });
    return t;
  });
}
