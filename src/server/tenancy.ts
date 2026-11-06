import { sql } from "drizzle-orm";
import { getDb, type Tx } from "@/db/client";

export type MemberRole = "org_admin" | "manager" | "rep";

/** Contexto de execução de uma operação dentro de uma organização. */
export type TenantContext = {
  orgId: string;
  userId: string | null; // null = processo de sistema (worker)
  role: MemberRole | "system";
};

/**
 * Executa `fn` numa transação com as variáveis de RLS definidas.
 * TODA leitura/escrita de dados de tenant deve passar por aqui.
 * `set_config(..., true)` vale só para a transação — não vaza para outras
 * requisições que reutilizem a mesma conexão do pool.
 */
export async function withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!ctx.orgId) throw new Error("withTenant: orgId obrigatório");
  // O worker age como "org_admin" dentro do tenant do job, nunca fora dele.
  const role = ctx.role === "system" ? "org_admin" : ctx.role;
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.org_id', ${ctx.orgId}, true),
                 set_config('app.user_id', ${ctx.userId ?? ""}, true),
                 set_config('app.role', ${role}, true)`,
    );
    return fn(tx);
  });
}

/** Transação apenas com o usuário definido (lista as organizações dele). */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
