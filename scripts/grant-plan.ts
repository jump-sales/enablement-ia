/**
 * Operação da plataforma (Jump Sales): libera plano e créditos para uma empresa.
 * MVP sem gateway de pagamento — executado manualmente pela equipe Jump após a venda.
 *
 *   npm run plan:grant -- --org <slug> --plan avaliador
 *   npm run plan:grant -- --org <slug> --plan treinamento --months 1
 *   npm run plan:grant -- --org <slug> --credits 20 --note "pacote adicional"
 *
 * Usa o papel dono (acesso administrativo) e registra tudo em audit_logs.
 */
import { parseArgs } from "node:util";
import { Client } from "pg";

const { values } = parseArgs({
  options: {
    org: { type: "string" },
    plan: { type: "string" },
    months: { type: "string", default: "1" },
    credits: { type: "string" },
    note: { type: "string" },
    operator: { type: "string", default: process.env.USER ?? "operador" },
  },
});

async function main() {
  if (!values.org || (!values.plan && !values.credits)) throw new Error("Informe --org e --plan e/ou --credits");
  const c = new Client({ connectionString: process.env.DATABASE_OWNER_URL });
  await c.connect();
  try {
    await c.query("begin");
    const org = (await c.query(`select id, name from organizations where slug = $1`, [values.org])).rows[0];
    if (!org) throw new Error(`Empresa '${values.org}' não encontrada`);
    let credits = values.credits ? Number(values.credits) : 0;
    let entitlementId: string | null = null;
    if (values.plan) {
      const plan = (await c.query(`select * from subscription_plans where code = $1 and active`, [values.plan])).rows[0];
      if (!plan) throw new Error(`Plano '${values.plan}' não encontrado`);
      const endsAt = plan.kind === "training_recurring" ? `now() + interval '${Number(values.months)} month'` : "null";
      entitlementId = (
        await c.query(
          `insert into org_entitlements (organization_id, plan_id, kind, ends_at, notes) values ($1,$2,$3,${endsAt},$4) returning id`,
          [org.id, plan.id, plan.kind, values.note ?? null],
        )
      ).rows[0].id;
      if (!values.credits) credits = plan.evaluation_credits * (plan.kind === "training_recurring" ? Number(values.months) : 1);
    }
    if (credits > 0) {
      await c.query(
        `insert into credit_ledger (organization_id, delta, reason, entitlement_id, note, created_by) values ($1,$2,'grant',$3,$4,$5)`,
        [org.id, credits, entitlementId, values.note ?? null, `platform:${values.operator}`],
      );
    }
    await c.query(
      `insert into audit_logs (organization_id, actor_type, action, target_type, target_id, metadata)
       values ($1, 'platform_admin', 'plan.granted', 'organization', $2, $3)`,
      [org.id, String(org.id), JSON.stringify({ plan: values.plan ?? null, credits, operator: values.operator, note: values.note ?? null })],
    );
    await c.query("commit");
    console.log(`OK: ${org.name} — plano=${values.plan ?? "-"} créditos=+${credits}`);
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    await c.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
