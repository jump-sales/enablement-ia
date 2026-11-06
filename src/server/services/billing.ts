import { and, desc, eq, gte, sql } from "drizzle-orm";
import { creditLedger, orgEntitlements, orgLimits, subscriptionPlans, usageEvents } from "@/db/schema";
import { conflict } from "../authz";
import type { Tx } from "@/db/client";

/**
 * Modelo comercial (MVP, sem gateway de pagamento):
 * - "Avaliador" (venda única): libera o motor de avaliação + pacote de créditos.
 * - "Treinamento" (recorrente): créditos mensais + evolução, coaching e calibração.
 * Créditos são um razão (ledger) — saldo = soma dos lançamentos.
 */
export async function creditBalance(tx: Tx, orgId: string) {
  const [r] = await tx
    .select({ balance: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int` })
    .from(creditLedger)
    .where(eq(creditLedger.organizationId, orgId));
  return r.balance;
}

export async function activeFeatures(tx: Tx, orgId: string, now = new Date()) {
  const rows = await tx
    .select({ features: subscriptionPlans.features, endsAt: orgEntitlements.endsAt })
    .from(orgEntitlements)
    .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, orgEntitlements.planId))
    .where(and(eq(orgEntitlements.organizationId, orgId), eq(orgEntitlements.status, "active")));
  const set = new Set<string>();
  for (const r of rows) if (!r.endsAt || r.endsAt > now) r.features.forEach((f) => set.add(f));
  return set;
}

/** Débito idempotente de 1 crédito por avaliação. Falha se não houver saldo. */
export async function consumeEvaluationCredit(tx: Tx, orgId: string, evaluationId: string) {
  const key = `eval:${evaluationId}`;
  const existing = await tx.select({ id: creditLedger.id }).from(creditLedger).where(eq(creditLedger.idempotencyKey, key));
  if (existing.length) return { alreadyCharged: true };
  // Serializa débitos concorrentes da mesma organização.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}))`);
  const balance = await creditBalance(tx, orgId);
  if (balance <= 0) throw conflict("Sem créditos de avaliação disponíveis.", "no_credits");
  await tx.insert(creditLedger).values({ organizationId: orgId, delta: -1, reason: "consume", evaluationId, idempotencyKey: key });
  return { alreadyCharged: false };
}

export async function monthlyUsage(tx: Tx, orgId: string, now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [r] = await tx
    .select({
      costUsdMicros: sql<number>`coalesce(sum(${usageEvents.costUsdMicros}), 0)::bigint`,
      audioSeconds: sql<number>`coalesce(sum(${usageEvents.audioSeconds}), 0)::int`,
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.organizationId, orgId), gte(usageEvents.createdAt, start)));
  return { costUsdMicros: Number(r.costUsdMicros), audioSeconds: r.audioSeconds };
}

/** Verifica limites de consumo ANTES de enfileirar trabalho pago. */
export async function assertWithinLimits(tx: Tx, orgId: string, extraAudioSeconds = 0, now = new Date()) {
  const [limits] = await tx.select().from(orgLimits).where(eq(orgLimits.organizationId, orgId));
  if (!limits) return;
  const usage = await monthlyUsage(tx, orgId, now);
  if (usage.costUsdMicros >= limits.monthlyCostCapUsdMicros) {
    throw conflict("Limite mensal de custo atingido. Fale com o administrador.", "cost_cap_reached");
  }
  if (usage.audioSeconds + extraAudioSeconds > limits.monthlyAudioMinutesCap * 60) {
    throw conflict("Limite mensal de minutos de áudio atingido.", "audio_cap_reached");
  }
}

export async function recentLedger(tx: Tx, orgId: string, limit = 20) {
  return tx.select().from(creditLedger).where(eq(creditLedger.organizationId, orgId)).orderBy(desc(creditLedger.createdAt)).limit(limit);
}
