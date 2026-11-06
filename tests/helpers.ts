import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { getDb } from "@/db/client";
import { user } from "@/db/schema";
import { createOrganization } from "@/server/services/organizations";
import { createInvitation, acceptInvitation } from "@/server/services/invitations";
import type { ServiceCtx } from "@/server/services/types";
import type { MemberRole } from "@/server/tenancy";
import { TEST_OWNER_URL } from "./env";

/** Usuários sintéticos — nenhum dado real. */
export async function makeUser(label = "pessoa") {
  const id = randomUUID();
  const email = `${label}-${id.slice(0, 8)}@exemplo.test`;
  await getDb().insert(user).values({ id, name: `Usuário ${label}`, email });
  return { id, email };
}

export async function makeOrg(label = "empresa") {
  const admin = await makeUser(`${label}-admin`);
  const org = await createOrganization(admin.id, { name: `Empresa ${label}`, slug: `${label}-${randomUUID().slice(0, 8)}` });
  const adminCtx: ServiceCtx = { orgId: org.id, userId: admin.id, role: "org_admin" };
  return { org, admin, adminCtx };
}

export async function addMember(adminCtx: ServiceCtx, role: MemberRole, jobTitle: "sdr" | "closer" | "manager" | null = null) {
  const u = await makeUser(role);
  const { token } = await createInvitation(adminCtx, { email: u.email, role, jobTitle });
  await acceptInvitation(token, u);
  const ctx: ServiceCtx = { orgId: adminCtx.orgId, userId: u.id, role };
  return { user: u, ctx };
}

/** Acesso de superusuário do schema — só para preparar cenários e inspecionar. */
export async function ownerQuery<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
  const c = new Client({ connectionString: TEST_OWNER_URL });
  await c.connect();
  try {
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.end();
  }
}

/** Executa e devolve a mensagem do erro do Postgres (o Drizzle embrulha em `cause`). */
export async function pgErrorOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    const err = e as { message?: string; cause?: { message?: string } };
    return err.cause?.message ?? err.message ?? String(e);
  }
  throw new Error("esperava erro do banco, mas a operação foi aceita");
}
