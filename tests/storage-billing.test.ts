import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { creditLedger, orgEntitlements, orgLimits, subscriptionPlans, usageEvents } from "@/db/schema";
import { assertKeyInTenant, LocalStorage, mediaKey, tenantStorage } from "@/server/storage";
import { activeFeatures, assertWithinLimits, consumeEvaluationCredit, creditBalance } from "@/server/services/billing";
import { withTenant } from "@/server/tenancy";
import { eq } from "drizzle-orm";
import { makeOrg } from "./helpers";

afterAll(closeDb);

describe("storage isolado por tenant", () => {
  const orgA = "11111111-1111-1111-1111-111111111111";
  const orgB = "22222222-2222-2222-2222-222222222222";

  it("gera chaves sempre prefixadas pela organização e rejeita segmentos perigosos", () => {
    expect(mediaKey(orgA, "conv1", "original.mp4")).toBe(`org/${orgA}/conversations/conv1/original.mp4`);
    expect(() => mediaKey(orgA, "..", "x")).toThrow();
    expect(() => mediaKey(orgA, "c", "../../etc/passwd")).toThrow();
  });

  it("bloqueia acesso a chave de outra organização ou com path traversal", () => {
    expect(() => assertKeyInTenant(orgA, `org/${orgB}/conversations/c/a.mp3`)).toThrow();
    expect(() => assertKeyInTenant(orgA, `org/${orgA}/../${orgB}/a.mp3`)).toThrow();
    expect(() => assertKeyInTenant(orgA, `org/${orgA}/conversations/c/a.mp3`)).not.toThrow();
  });

  it("grava, lê e apaga pela fachada de tenant", async () => {
    const st = tenantStorage(orgA);
    const key = mediaKey(orgA, "conv-teste", "audio.txt");
    await st.put(key, Readable.from(["conteúdo sintético"]), "text/plain");
    expect(await st.size(key)).toBeGreaterThan(0);
    await st.delete(key);
    expect(await st.size(key)).toBeNull();
    await expect(Promise.resolve().then(() => tenantStorage(orgB).get(key))).rejects.toMatchObject({ status: 403 });
  });

  it("URL temporária expira e não aceita assinatura adulterada", async () => {
    const s = new LocalStorage("./var/test-storage", "segredo", "http://x");
    const url = new URL(await s.signedGetUrl(`org/${orgA}/a`, 60));
    const key = url.searchParams.get("key")!;
    const exp = Number(url.searchParams.get("exp"));
    const sig = url.searchParams.get("sig")!;
    expect(s.verify(key, exp, sig)).toBe(true);
    expect(s.verify(key, exp, sig, (exp + 1) * 1000)).toBe(false);
    expect(s.verify(`org/${orgB}/a`, exp, sig)).toBe(false);
    expect(s.verify(key, exp, sig.slice(0, -2) + "xx")).toBe(false);
  });
});

describe("créditos, planos e limites", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  beforeAll(async () => {
    org = await makeOrg("cobranca");
  });
  const sys = () => ({ orgId: org.org.id, userId: null, role: "system" as const });

  it("sem créditos, a avaliação é bloqueada", async () => {
    await expect(
      withTenant(sys(), (tx) => consumeEvaluationCredit(tx, org.org.id, crypto.randomUUID())),
    ).rejects.toMatchObject({ code: "no_credits" });
  });

  it("débito é idempotente por avaliação", async () => {
    const evalId = crypto.randomUUID();
    await withTenant(sys(), async (tx) => {
      await tx.insert(creditLedger).values({ organizationId: org.org.id, delta: 2, reason: "grant" });
      expect((await consumeEvaluationCredit(tx, org.org.id, evalId)).alreadyCharged).toBe(false);
      expect((await consumeEvaluationCredit(tx, org.org.id, evalId)).alreadyCharged).toBe(true);
      expect(await creditBalance(tx, org.org.id)).toBe(1);
    });
  });

  it("recursos do plano de treinamento só valem enquanto a assinatura está vigente", async () => {
    await withTenant(sys(), async (tx) => {
      const [plan] = await tx.select().from(subscriptionPlans).where(eq(subscriptionPlans.code, "treinamento"));
      await tx.insert(orgEntitlements).values({
        organizationId: org.org.id,
        planId: plan.id,
        kind: plan.kind,
        endsAt: new Date("2026-12-01T00:00:00Z"),
      });
      expect((await activeFeatures(tx, org.org.id, new Date("2026-11-15T00:00:00Z"))).has("evolution_dashboard")).toBe(true);
      expect((await activeFeatures(tx, org.org.id, new Date("2026-12-02T00:00:00Z"))).has("evolution_dashboard")).toBe(false);
    });
  });

  it("bloqueia novos processamentos ao atingir o teto mensal de custo", async () => {
    await withTenant(sys(), async (tx) => {
      await tx.update(orgLimits).set({ monthlyCostCapUsdMicros: 1_000_000 }).where(eq(orgLimits.organizationId, org.org.id));
      await assertWithinLimits(tx, org.org.id);
      await tx.insert(usageEvents).values({
        organizationId: org.org.id,
        stage: "evaluation",
        provider: "mock",
        costUsdMicros: 1_200_000,
        success: true,
      });
      await expect(assertWithinLimits(tx, org.org.id)).rejects.toMatchObject({ code: "cost_cap_reached" });
    });
  });
});
