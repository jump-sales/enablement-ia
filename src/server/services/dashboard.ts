/**
 * Indicadores de desempenho. O RLS já restringe o vendedor às próprias conversas,
 * então as mesmas consultas servem para a visão individual e a da equipe.
 *
 * Notas por critério são normalizadas para 0–10 (rubricas podem ter escalas diferentes).
 * Sem ranking: a comparação entre pessoas mostra evolução de cada um contra si mesmo.
 */
import { sql } from "drizzle-orm";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { can } from "../authz";
import { withTenant } from "../tenancy";
import { activeFeatures } from "./billing";
import type { ServiceCtx } from "./types";

export type MonthPoint = { month: string; avg: number | null; count: number };
export type CompetencyRow = { competency: string; current: number | null; previous: number | null; count: number };

const n = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);

export async function getDashboard(ctx: ServiceCtx, opts: { userId?: string; months?: number; now?: Date } = {}) {
  const months = opts.months ?? 6;
  const now = opts.now ?? new Date();
  const teamView = can(ctx.role, "dashboard.team");
  const ownerFilter = opts.userId && teamView ? opts.userId : teamView ? null : ctx.userId;

  return withTenant(ctx, async (tx) => {
    const [org] = await tx.select({ settings: organizations.settings, timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, ctx.orgId));
    const features = await activeFeatures(tx, ctx.orgId, now);
    const tz = org.timezone;
    // Para o vendedor, respeita a política de aprovação antes da visibilidade.
    const approvedOnly = !teamView && org.settings.requireApprovalBeforeRepVisibility;
    const owner = ownerFilter ? sql`and c.owner_user_id = ${ownerFilter}` : sql``;
    const approved = approvedOnly ? sql`and e.review_status = 'approved'` : sql``;
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));

    // Avaliações vigentes concluídas no período, com o mês local da conversa.
    const base = sql`
      from evaluations e
      join conversations c on c.id = e.conversation_id and c.deleted_at is null
      join rubric_versions rv on rv.id = e.rubric_version_id
      where e.is_current and e.status = 'completed'
        and coalesce(c.occurred_at, c.created_at) >= ${start.toISOString()}
        ${owner} ${approved}`;
    const month = sql`to_char(coalesce(c.occurred_at, c.created_at) at time zone ${tz}, 'YYYY-MM')`;
    const norm = sql`((e.overall_score - rv.scale_min) * 10.0 / nullif(rv.scale_max - rv.scale_min, 0))`;

    const monthly = (await tx.execute(sql`select ${month} as month, avg(${norm}) as avg, count(*)::int as count ${base} group by 1 order by 1`))
      .rows as { month: string; avg: string | null; count: number }[];

    const monthKeys: string[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      monthKeys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
    }
    const trend: MonthPoint[] = monthKeys.map((m) => {
      const r = monthly.find((x) => x.month === m);
      return { month: m, avg: r ? n(r.avg) : null, count: r?.count ?? 0 };
    });
    const cur = monthKeys[monthKeys.length - 1];
    const prev = monthKeys[monthKeys.length - 2];

    const critNorm = sql`((cs.score - rv.scale_min) * 10.0 / nullif(rv.scale_max - rv.scale_min, 0))`;
    const comp = (await tx.execute(sql`
      select cr.competency, ${month} as month, avg(${critNorm}) as avg, count(*)::int as count
      ${sql`from evaluations e
        join conversations c on c.id = e.conversation_id and c.deleted_at is null
        join rubric_versions rv on rv.id = e.rubric_version_id
        join criterion_scores cs on cs.evaluation_id = e.id and cs.status = 'scored'
        join criteria cr on cr.id = cs.criterion_id
        where e.is_current and e.status = 'completed'
          and coalesce(c.occurred_at, c.created_at) >= ${start.toISOString()}
          ${owner} ${approved}`}
      group by 1, 2`)).rows as { competency: string; month: string; avg: string; count: number }[];
    const competencies = [...new Set(comp.map((r) => r.competency))].sort();
    const byCompetency: CompetencyRow[] = competencies.map((c) => {
      const a = comp.find((r) => r.competency === c && r.month === cur);
      const b = comp.find((r) => r.competency === c && r.month === prev);
      return { competency: c, current: a ? n(a.avg) : null, previous: b ? n(b.avg) : null, count: comp.filter((r) => r.competency === c).reduce((s, r) => s + r.count, 0) };
    });

    // Critérios que mais aparecem abaixo da metade da escala (pontos recorrentes de melhoria).
    const recurring = ((await tx.execute(sql`
      select cr.name, count(*) filter (where ${critNorm} < 5)::int as low, count(*)::int as total, avg(${critNorm}) as avg
      from evaluations e
      join conversations c on c.id = e.conversation_id and c.deleted_at is null
      join rubric_versions rv on rv.id = e.rubric_version_id
      join criterion_scores cs on cs.evaluation_id = e.id and cs.status = 'scored'
      join criteria cr on cr.id = cs.criterion_id
      where e.is_current and e.status = 'completed'
        and coalesce(c.occurred_at, c.created_at) >= ${start.toISOString()}
        ${owner} ${approved}
      group by cr.name having count(*) filter (where ${critNorm} < 5) > 0
      order by 2 desc, 4 asc limit 5`)).rows as { name: string; low: number; total: number; avg: string }[]).map((r) => ({ name: r.name, low: r.low, total: r.total, avg: n(r.avg) }));

    let people: { userId: string; name: string; jobTitle: string | null; current: number | null; previous: number | null; count: number }[] = [];
    let pendingReviews = 0;
    let cost = { monthUsdMicros: 0, evaluationsThisMonth: 0, perEvaluationUsdMicros: null as number | null };
    if (teamView && !opts.userId) {
      people = ((await tx.execute(sql`
        select m.user_id, u.name, m.job_title,
          avg(${norm}) filter (where ${month} = ${cur}) as current,
          avg(${norm}) filter (where ${month} = ${prev}) as previous,
          count(e.id) filter (where ${month} = ${cur})::int as count
        from memberships m
        join "user" u on u.id = m.user_id
        left join conversations c on c.owner_user_id = m.user_id and c.organization_id = m.organization_id and c.deleted_at is null
          and coalesce(c.occurred_at, c.created_at) >= ${start.toISOString()}
        left join evaluations e on e.conversation_id = c.id and e.is_current and e.status = 'completed'
        left join rubric_versions rv on rv.id = e.rubric_version_id
        where m.organization_id = ${ctx.orgId} and m.status = 'active' and m.role = 'rep'
        group by 1, 2, 3 order by u.name`)).rows as { user_id: string; name: string; job_title: string | null; current: string | null; previous: string | null; count: number }[]).map((r) => ({
        userId: r.user_id,
        name: r.name,
        jobTitle: r.job_title,
        current: n(r.current),
        previous: n(r.previous),
        count: r.count,
      }));
      const [p] = (await tx.execute(sql`select count(*)::int as n from evaluations where is_current and status = 'completed' and review_status <> 'approved'`)).rows as { n: number }[];
      pendingReviews = p.n;
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      const [c] = (await tx.execute(sql`
        select coalesce(sum(cost_usd_micros), 0)::bigint as cost,
          (select count(*)::int from evaluations where status in ('completed','superseded') and completed_at >= ${monthStart}) as evals
        from usage_events where created_at >= ${monthStart}`)).rows as { cost: string; evals: number }[];
      cost = { monthUsdMicros: Number(c.cost), evaluationsThisMonth: c.evals, perEvaluationUsdMicros: c.evals ? Math.round(Number(c.cost) / c.evals) : null };
    }

    return {
      scope: ownerFilter ? ("individual" as const) : ("team" as const),
      evolutionEnabled: features.has("evolution_dashboard"),
      months: monthKeys,
      currentMonth: cur,
      trend,
      byCompetency,
      recurring,
      people,
      pendingReviews,
      cost,
    };
  });
}
