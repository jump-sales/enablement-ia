import Link from "next/link";
import { CompetencyBars, TrendChart } from "@/components/charts";
import { monthLabel } from "@/lib/format";
import { Badge, Card, JOB_LABEL, PageHeader } from "@/components/ui";
import { can } from "@/server/authz";
import { pageContext } from "@/server/page-context";
import { listCoachingActions } from "@/server/services/coaching";
import { getDashboard } from "@/server/services/dashboard";
import { getOverview } from "@/server/services/overview";
import { CoachingList } from "./coaching-list";

export const metadata = { title: "Painel" };

const fmt = (v: number | null) => (v === null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 1 }));
const usd = (micros: number | null) => (micros === null ? "—" : (micros / 1_000_000).toLocaleString("pt-BR", { style: "currency", currency: "USD" }));

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-navy">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

function Trend({ cur, prev }: { cur: number | null; prev: number | null }) {
  if (cur === null || prev === null) return <span className="text-muted">—</span>;
  const d = cur - prev;
  if (Math.abs(d) < 0.05) return <span className="text-muted">estável</span>;
  return <span className={d > 0 ? "text-green-800" : "text-ink"}>{d > 0 ? "▲" : "▼"} {fmt(Math.abs(d))}</span>;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ pessoa?: string }> }) {
  const ctx = await pageContext();
  const { pessoa } = await searchParams;
  const teamView = can(ctx.role, "dashboard.team");
  const personId = teamView ? pessoa : undefined;
  const [d, o, coaching] = await Promise.all([getDashboard(ctx, { userId: personId }), getOverview(ctx), listCoachingActions(ctx)]);
  const person = personId ? d.people.find((p) => p.userId === personId) : null;
  const current = d.trend[d.trend.length - 1];
  const previous = d.trend[d.trend.length - 2];
  const firstName = ctx.user.name.split(" ")[0];
  const myActions = coaching.filter((a) => (personId ? a.userId === personId : !teamView || a.userId === ctx.userId));

  return (
    <>
      <PageHeader
        title={personId ? "Desempenho individual" : `Olá, ${firstName}`}
        description={
          personId
            ? "Evolução da pessoa comparada com ela mesma nos meses anteriores."
            : teamView
              ? "Visão geral da equipe comercial."
              : "Seu desempenho e sua evolução mês a mês."
        }
        actions={personId ? <Link href="/painel" className="text-sm text-navy underline">← Visão da equipe</Link> : undefined}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`Nota média em ${monthLabel(d.currentMonth)}`} value={fmt(current.avg)} hint={`${current.count} ${current.count === 1 ? "conversa avaliada" : "conversas avaliadas"}`} />
        <Stat label="Mês anterior" value={fmt(previous.avg)} hint={previous.count ? `${previous.count} conversas` : "sem avaliações"} />
        {teamView && !personId ? (
          <>
            <Stat label="Revisões pendentes" value={d.pendingReviews} hint="Avaliações aguardando aprovação do gestor" />
            <Stat label="Custo de IA por análise" value={usd(d.cost.perEvaluationUsdMicros)} hint={`${usd(d.cost.monthUsdMicros)} no mês · ${o.credits} créditos disponíveis`} />
          </>
        ) : (
          <>
            <Stat label="Ações de desenvolvimento abertas" value={myActions.filter((a) => a.status === "open" || a.status === "in_progress").length} />
            <Stat label="Conversas" value={o.conversations} />
          </>
        )}
      </div>

      {!d.evolutionEnabled && (
        <div className="mt-6">
          <Card title="Evolução mês a mês" description="Disponível no plano Treinamento.">
            <p className="text-sm text-muted">
              O plano Treinamento libera a evolução por competência, a comparação com meses anteriores, os planos de coaching e a calibração com
              as avaliações do gestor. Fale com a Jump Sales para ativar.
            </p>
          </Card>
        </div>
      )}

      {d.evolutionEnabled && (
        <div className="mt-6 grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <Card title="Nota média por mês" description="Escala 0–10. Meses sem conversas avaliadas aparecem vazios, não como zero.">
              {d.trend.some((t) => t.count > 0) ? (
                <TrendChart points={d.trend} label={`Nota média por mês${person ? ` de ${person.name}` : ""}`} />
              ) : (
                <p className="text-sm text-muted">Ainda não há conversas avaliadas no período.</p>
              )}
            </Card>
          </div>
          <div className="lg:col-span-2">
            <Card title="Competências" description="Mês atual comparado ao anterior.">
              {d.byCompetency.length ? <CompetencyBars rows={d.byCompetency} /> : <p className="text-sm text-muted">Sem dados ainda.</p>}
            </Card>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {teamView && !personId && d.evolutionEnabled && (
          <Card title="Equipe" description="Cada pessoa comparada com ela mesma. Clique para ver o detalhe.">
            {d.people.length === 0 ? (
              <p className="text-sm text-muted">Nenhum SDR ou Closer cadastrado ainda.</p>
            ) : (
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-sm">
                  <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-5 py-2 font-medium">Pessoa</th>
                      <th className="px-5 py-2 text-right font-medium">Conversas no mês</th>
                      <th className="px-5 py-2 text-right font-medium">Nota no mês</th>
                      <th className="px-5 py-2 text-right font-medium">vs. mês anterior</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.people.map((p) => (
                      <tr key={p.userId} className="border-b border-line last:border-0 hover:bg-surface">
                        <td className="px-5 py-2.5">
                          <Link href={`/painel?pessoa=${p.userId}`} className="font-medium text-navy underline-offset-2 hover:underline">{p.name}</Link>
                          {p.jobTitle && <span className="ml-1 text-xs text-muted">{JOB_LABEL[p.jobTitle]}</span>}
                        </td>
                        <td className="px-5 py-2.5 text-right tabular-nums">{p.count}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums">{fmt(p.current)}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums"><Trend cur={p.current} prev={p.previous} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
        <Card title="Pontos de melhoria recorrentes" description="Critérios que mais aparecem abaixo da metade da escala nos últimos meses.">
          {d.recurring.length === 0 ? (
            <p className="text-sm text-muted">Nenhum ponto recorrente identificado.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {d.recurring.map((r) => (
                <li key={r.name} className="flex items-center justify-between gap-2">
                  <span>{r.name}</span>
                  <span className="text-xs text-muted tabular-nums">{r.low} de {r.total} conversas · média {fmt(r.avg)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {d.evolutionEnabled && (
          <Card
            title={personId ? "Plano de desenvolvimento" : teamView ? "Ações de coaching da equipe" : "Seu plano de desenvolvimento"}
            actions={
              teamView ? (() => {
                const open = coaching.filter((a) => a.status !== "done" && a.status !== "dismissed").length;
                return <Badge>{open} {open === 1 ? "aberta" : "abertas"}</Badge>;
              })() : undefined
            }
          >
            <CoachingList
              actions={JSON.parse(JSON.stringify(teamView && !personId ? coaching : myActions))}
              showPerson={teamView && !personId}
              canDismiss={can(ctx.role, "coaching.assign")}
            />
          </Card>
        )}
      </div>

      {ctx.role === "org_admin" && o.conversations === 0 && (
        <div className="mt-6">
          <Card title="Primeiros passos">
            <ol className="flex flex-col gap-2 text-sm">
              <li><Link href="/equipe" className="text-navy underline">1. Convidar gestores, SDRs e Closers</Link></li>
              <li><Link href="/metodologias" className="text-navy underline">2. Escolher e ajustar a metodologia</Link></li>
              <li><Link href="/conversas/nova" className="text-navy underline">3. Enviar a primeira transcrição</Link></li>
              <li><Link href="/calibracao" className="text-navy underline">4. Calibrar a IA com as avaliações do gestor</Link></li>
            </ol>
          </Card>
        </div>
      )}
    </>
  );
}
