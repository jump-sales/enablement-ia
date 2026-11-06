import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { coachingActions, memberships, user } from "@/db/schema";
import { audit } from "../audit";
import { assertCan, badRequest, can, notFound } from "../authz";
import { withTenant } from "../tenancy";
import type { ServiceCtx } from "./types";

export const coachingInput = z.object({
  userId: z.string().min(1),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).optional(),
  evaluationId: z.string().uuid().nullable().optional(),
  criterionKey: z.string().max(60).nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
});

export async function createCoachingAction(ctx: ServiceCtx, raw: unknown) {
  assertCan(ctx.role, "coaching.assign");
  const input = coachingInput.parse(raw);
  return withTenant(ctx, async (tx) => {
    const [m] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, input.userId), eq(memberships.organizationId, ctx.orgId)));
    if (!m) throw badRequest("Pessoa não encontrada na empresa.");
    const [a] = await tx
      .insert(coachingActions)
      .values({
        organizationId: ctx.orgId,
        userId: input.userId,
        evaluationId: input.evaluationId ?? null,
        criterionKey: input.criterionKey ?? null,
        title: input.title,
        description: input.description ?? null,
        dueDate: input.dueDate ?? null,
        createdBy: ctx.userId,
      })
      .returning();
    await audit(tx, { orgId: ctx.orgId, actorUserId: ctx.userId, action: "coaching.created", targetType: "coaching_action", targetId: a.id });
    return a;
  });
}

/** Vendedor vê só as próprias (RLS); gestor vê todas. */
export async function listCoachingActions(ctx: ServiceCtx) {
  return withTenant(ctx, async (tx) =>
    tx
      .select({ a: coachingActions, personName: user.name })
      .from(coachingActions)
      .innerJoin(user, eq(user.id, coachingActions.userId))
      .orderBy(desc(coachingActions.createdAt))
      .then((rows) => rows.map((r) => ({ ...r.a, personName: r.personName }))),
  );
}

export async function updateCoachingStatus(ctx: ServiceCtx, id: string, raw: unknown) {
  const { status } = z.object({ status: z.enum(["open", "in_progress", "done", "dismissed"]) }).parse(raw);
  // Vendedor atualiza o andamento; só o gestor pode descartar.
  if (status === "dismissed" && !can(ctx.role, "coaching.assign")) assertCan(ctx.role, "coaching.assign");
  return withTenant(ctx, async (tx) => {
    const [a] = await tx.update(coachingActions).set({ status }).where(eq(coachingActions.id, id)).returning();
    if (!a) throw notFound("Ação não encontrada.");
    await audit(tx, { orgId: ctx.orgId, actorUserId: ctx.userId, action: "coaching.status_changed", targetType: "coaching_action", targetId: id, metadata: { status } });
    return a;
  });
}
