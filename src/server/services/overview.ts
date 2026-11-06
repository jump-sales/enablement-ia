import { and, eq, sql } from "drizzle-orm";
import { conversations, memberships, orgEntitlements, orgLimits, subscriptionPlans } from "@/db/schema";
import { activeFeatures, creditBalance, monthlyUsage, recentLedger } from "./billing";
import { withTenant } from "../tenancy";
import type { ServiceCtx } from "./types";

/** Resumo para o painel e para a tela de empresa/consumo. */
export async function getOverview(ctx: ServiceCtx) {
  return withTenant(ctx, async (tx) => {
    const [members] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(eq(memberships.organizationId, ctx.orgId), eq(memberships.status, "active")));
    // RLS limita automaticamente às conversas que o usuário pode ver.
    const [convs] = await tx.select({ n: sql<number>`count(*)::int` }).from(conversations);
    const plans = await tx
      .select({ name: subscriptionPlans.name, kind: orgEntitlements.kind, status: orgEntitlements.status, endsAt: orgEntitlements.endsAt })
      .from(orgEntitlements)
      .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, orgEntitlements.planId));
    const [limits] = await tx.select().from(orgLimits);
    return {
      members: members.n,
      conversations: convs.n,
      credits: await creditBalance(tx, ctx.orgId),
      features: [...(await activeFeatures(tx, ctx.orgId))],
      plans,
      limits,
      usage: await monthlyUsage(tx, ctx.orgId),
      ledger: ctx.role === "rep" ? [] : await recentLedger(tx, ctx.orgId, 10),
    };
  });
}
