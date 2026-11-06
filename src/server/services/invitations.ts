import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { invitations, memberships, user } from "@/db/schema";
import { audit } from "../audit";
import { AppError, assertCan, badRequest, conflict, notFound } from "../authz";
import { withTenant, type MemberRole } from "../tenancy";
import { jobTitleSchema, roleSchema } from "./members";
import type { ServiceCtx } from "./types";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const createInvitationInput = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido."),
  role: roleSchema,
  jobTitle: jobTitleSchema.nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
});

/**
 * Cria um convite. Retorna o token em claro UMA única vez (para o link);
 * no banco fica só o hash.
 */
export async function createInvitation(ctx: ServiceCtx, input: z.input<typeof createInvitationInput>, now = new Date()) {
  assertCan(ctx.role, "members.manage");
  const data = createInvitationInput.parse(input);
  const token = randomBytes(32).toString("base64url");
  return withTenant(ctx, async (tx) => {
    const already = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(sql`lower(${user.email}) = ${data.email}`);
    if (already.length) throw conflict("Esta pessoa já faz parte da empresa.", "already_member");

    // Revoga convites pendentes anteriores para o mesmo e-mail.
    await tx
      .update(invitations)
      .set({ revokedAt: now })
      .where(and(eq(invitations.email, data.email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));

    const [inv] = await tx
      .insert(invitations)
      .values({
        organizationId: ctx.orgId,
        email: data.email,
        role: data.role,
        jobTitle: data.jobTitle ?? null,
        teamId: data.teamId ?? null,
        tokenHash: hashToken(token),
        invitedBy: ctx.userId,
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
      })
      .returning();
    await audit(tx, {
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "invitation.created",
      targetType: "invitation",
      targetId: inv.id,
      metadata: { role: data.role },
    });
    return { invitation: { ...inv, tokenHash: undefined }, token };
  });
}

export async function listInvitations(ctx: ServiceCtx) {
  assertCan(ctx.role, "members.view");
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        jobTitle: invitations.jobTitle,
        expiresAt: invitations.expiresAt,
        acceptedAt: invitations.acceptedAt,
        revokedAt: invitations.revokedAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .orderBy(desc(invitations.createdAt)),
  );
}

export async function revokeInvitation(ctx: ServiceCtx, id: string) {
  assertCan(ctx.role, "members.manage");
  return withTenant(ctx, async (tx) => {
    const [inv] = await tx
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(and(eq(invitations.id, id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
      .returning({ id: invitations.id });
    if (!inv) throw notFound("Convite não encontrado ou já utilizado.");
    await audit(tx, { orgId: ctx.orgId, actorUserId: ctx.userId, action: "invitation.revoked", targetType: "invitation", targetId: id });
  });
}

type FoundInvitation = {
  id: string;
  organization_id: string;
  email: string;
  role: MemberRole;
  job_title: string | null;
  team_id: string | null;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  organization_name: string;
};

/** Consulta pública (por token) — usada na tela de aceite. Não expõe dados além do necessário. */
export async function lookupInvitation(token: string, now = new Date()) {
  const r = await getDb().execute(sql`select * from app_find_invitation(${hashToken(token)})`);
  const inv = r.rows[0] as FoundInvitation | undefined;
  if (!inv) throw notFound("Convite inválido.");
  if (inv.revoked_at) throw new AppError(410, "invitation_revoked", "Este convite foi cancelado.");
  if (inv.accepted_at) throw new AppError(410, "invitation_used", "Este convite já foi utilizado.");
  if (new Date(inv.expires_at) < now) throw new AppError(410, "invitation_expired", "Este convite expirou. Peça um novo ao administrador.");
  return inv;
}

/** Aceite: o usuário autenticado precisa ter o mesmo e-mail do convite. */
export async function acceptInvitation(token: string, acceptingUser: { id: string; email: string }, now = new Date()) {
  const inv = await lookupInvitation(token, now);
  if (inv.email.toLowerCase() !== acceptingUser.email.toLowerCase()) {
    throw badRequest("Este convite foi enviado para outro e-mail.", "email_mismatch");
  }
  return withTenant({ orgId: inv.organization_id, userId: acceptingUser.id, role: inv.role }, async (tx) => {
    // Marca como usado de forma atômica (evita aceite duplo concorrente).
    const used = await tx
      .update(invitations)
      .set({ acceptedAt: now, acceptedBy: acceptingUser.id })
      .where(and(eq(invitations.id, inv.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
      .returning({ id: invitations.id });
    if (!used.length) throw new AppError(410, "invitation_used", "Este convite já foi utilizado.");
    const existing = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, acceptingUser.id), eq(memberships.organizationId, inv.organization_id)));
    if (existing.length) throw conflict("Você já faz parte desta empresa.", "already_member");
    await tx.insert(memberships).values({
      organizationId: inv.organization_id,
      userId: acceptingUser.id,
      role: inv.role,
      jobTitle: (inv.job_title as "sdr" | "closer" | "manager" | "other" | null) ?? null,
      teamId: inv.team_id,
    });
    await audit(tx, {
      orgId: inv.organization_id,
      actorUserId: acceptingUser.id,
      action: "invitation.accepted",
      targetType: "invitation",
      targetId: inv.id,
    });
    return { organizationId: inv.organization_id, organizationName: inv.organization_name };
  });
}
