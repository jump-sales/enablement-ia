import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/db/client";
import { auditLogs, conversations, invitations, organizations, subscriptionPlans, teams, transcripts } from "@/db/schema";
import { withTenant } from "@/server/tenancy";
import { createTeam } from "@/server/services/members";
import { createInvitation } from "@/server/services/invitations";
import { addMember, makeOrg, ownerQuery, pgErrorOf } from "./helpers";

let A: Awaited<ReturnType<typeof makeOrg>>;
let B: Awaited<ReturnType<typeof makeOrg>>;
let convB: string;

beforeAll(async () => {
  A = await makeOrg("alfa");
  B = await makeOrg("beta");
  await createTeam(A.adminCtx, { name: "Time Alfa" });
  await createTeam(B.adminCtx, { name: "Time Beta" });
  await createInvitation(B.adminCtx, { email: "convidado@exemplo.test", role: "rep" });
  convB = await withTenant(B.adminCtx, async (tx) => {
    const [c] = await tx
      .insert(conversations)
      .values({ organizationId: B.org.id, ownerUserId: B.admin.id, uploadedBy: B.admin.id, title: "Ligação B", legalBasis: "consent" })
      .returning();
    await tx.insert(transcripts).values({ organizationId: B.org.id, conversationId: c.id, provider: "mock" });
    return c.id;
  });
});
afterAll(closeDb);

describe("isolamento multi-tenant (RLS)", () => {
  it("toda tabela com organization_id tem RLS habilitado", async () => {
    const rows = await ownerQuery<{ table_name: string; rls: boolean }>(`
      select c.table_name, cl.relrowsecurity as rls
      from information_schema.columns c
      join pg_class cl on cl.relname = c.table_name and cl.relnamespace = 'public'::regnamespace
      where c.table_schema = 'public' and c.column_name = 'organization_id'`);
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.filter((r) => !r.rls).map((r) => r.table_name)).toEqual([]);
    const [org] = await ownerQuery<{ rls: boolean }>(`select relrowsecurity as rls from pg_class where relname='organizations'`);
    expect(org.rls).toBe(true);
  });

  it("o papel da aplicação não tem BYPASSRLS nem é dono das tabelas", async () => {
    const [r] = await ownerQuery<{ rolbypassrls: boolean; rolsuper: boolean }>(
      `select rolbypassrls, rolsuper from pg_roles where rolname = 'jump_app'`,
    );
    expect(r).toEqual({ rolbypassrls: false, rolsuper: false });
    const owned = await ownerQuery(`select tablename from pg_tables where schemaname='public' and tableowner='jump_app'`);
    expect(owned).toEqual([]);
  });

  it("sem contexto de tenant, nenhuma linha é visível", async () => {
    const db = getDb();
    expect(await db.select().from(teams)).toHaveLength(0);
    expect(await db.select().from(conversations)).toHaveLength(0);
    expect(await db.select().from(organizations)).toHaveLength(0);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("organização A não enxerga dados da organização B", async () => {
    await withTenant(A.adminCtx, async (tx) => {
      const ts = await tx.select().from(teams);
      expect(ts.map((t) => t.name)).toEqual(["Time Alfa"]);
      expect(await tx.select().from(invitations)).toHaveLength(0);
      expect(await tx.select().from(conversations).where(eq(conversations.id, convB))).toHaveLength(0);
      expect(await tx.select().from(transcripts)).toHaveLength(0);
      const orgs = await tx.select().from(organizations);
      expect(orgs.map((o) => o.id)).toEqual([A.org.id]);
      const logs = await tx.select().from(auditLogs);
      expect(logs.every((l) => l.organizationId === A.org.id)).toBe(true);
    });
  });

  it("não é possível gravar dados no tenant de outra organização", async () => {
    expect(
      await pgErrorOf(() => withTenant(A.adminCtx, (tx) => tx.insert(teams).values({ organizationId: B.org.id, name: "Intruso" }))),
    ).toMatch(/row-level security/);
  });

  it("não é possível alterar nem apagar dados de outra organização", async () => {
    await withTenant(A.adminCtx, async (tx) => {
      const upd = await tx.update(conversations).set({ title: "hack" }).where(eq(conversations.id, convB)).returning();
      expect(upd).toHaveLength(0);
      const del = await tx.delete(conversations).where(eq(conversations.id, convB)).returning();
      expect(del).toHaveLength(0);
    });
    const [c] = await ownerQuery<{ title: string }>(`select title from conversations where id = $1`, [convB]);
    expect(c.title).toBe("Ligação B");
  });

  it("variáveis de tenant não vazam entre transações do pool", async () => {
    await withTenant(A.adminCtx, async (tx) => {
      await tx.select().from(teams);
    });
    const r = await getDb().execute(sql`select current_setting('app.org_id', true) as v`);
    expect([null, ""]).toContain((r.rows[0] as { v: string | null }).v);
  });

  it("auditoria é append-only para a aplicação", async () => {
    expect(await pgErrorOf(() => withTenant(A.adminCtx, (tx) => tx.update(auditLogs).set({ action: "x" })))).toMatch(/permission denied/);
    expect(await pgErrorOf(() => withTenant(A.adminCtx, (tx) => tx.delete(auditLogs)))).toMatch(/permission denied/);
  });

  it("catálogo de planos é somente leitura para a aplicação", async () => {
    const plans = await getDb().select().from(subscriptionPlans);
    expect(plans.map((p) => p.code).sort()).toEqual(["avaliador", "treinamento"]);
    expect(await pgErrorOf(() => getDb().update(subscriptionPlans).set({ priceCents: 0 }))).toMatch(/permission denied/);
  });
});

describe("visibilidade individual (SDR/Closer veem só o próprio)", () => {
  it("vendedor vê apenas as próprias conversas; gestor vê todas", async () => {
    const sdr = await addMember(A.adminCtx, "rep", "sdr");
    const closer = await addMember(A.adminCtx, "rep", "closer");
    const manager = await addMember(A.adminCtx, "manager", "manager");
    await withTenant(A.adminCtx, async (tx) => {
      for (const owner of [sdr.user.id, closer.user.id]) {
        const [c] = await tx
          .insert(conversations)
          .values({ organizationId: A.org.id, ownerUserId: owner, uploadedBy: A.admin.id, title: `Ligação ${owner}`, legalBasis: "consent" })
          .returning();
        await tx.insert(transcripts).values({ organizationId: A.org.id, conversationId: c.id, provider: "mock" });
      }
    });

    const seen = async (ctx: typeof sdr.ctx) =>
      withTenant(ctx, async (tx) => ({
        convs: (await tx.select().from(conversations)).map((c) => c.ownerUserId),
        transcripts: (await tx.select().from(transcripts)).length,
      }));

    expect(await seen(sdr.ctx)).toEqual({ convs: [sdr.user.id], transcripts: 1 });
    expect(await seen(closer.ctx)).toEqual({ convs: [closer.user.id], transcripts: 1 });
    const m = await seen(manager.ctx);
    expect(m.convs.sort()).toEqual([sdr.user.id, closer.user.id].sort());
    expect(m.transcripts).toBe(2);
  });

  it("vendedor não consegue registrar conversa em nome de outro", async () => {
    const sdr = await addMember(A.adminCtx, "rep", "sdr");
    expect(
      await pgErrorOf(() =>
        withTenant(sdr.ctx, (tx) =>
          tx.insert(conversations).values({ organizationId: A.org.id, ownerUserId: A.admin.id, uploadedBy: sdr.user.id, title: "x", legalBasis: "consent" }),
        ),
      ),
    ).toMatch(/row-level security/);
  });
});
