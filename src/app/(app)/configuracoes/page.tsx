import { Badge, Card, PageHeader } from "@/components/ui";
import { can } from "@/server/authz";
import { pageContext } from "@/server/page-context";
import { getOrganization } from "@/server/services/organizations";
import { getOverview } from "@/server/services/overview";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Empresa e consumo" };

const usd = (micros: number) => (micros / 1_000_000).toLocaleString("pt-BR", { style: "currency", currency: "USD" });

export default async function SettingsPage() {
  const ctx = await pageContext("usage.view");
  const [org, o] = await Promise.all([getOrganization(ctx), getOverview(ctx)]);
  const capPct = o.limits ? Math.min(100, Math.round((o.usage.costUsdMicros / o.limits.monthlyCostCapUsdMicros) * 100)) : 0;

  return (
    <>
      <PageHeader title="Empresa e consumo" description={org.name} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <SettingsForm editable={can(ctx.role, "org.settings.manage")} name={org.name} settings={org.settings} />
        </div>
        <div className="flex flex-col gap-6">
          <Card title="Plano">
            {o.plans.length === 0 ? (
              <p className="text-sm text-muted">Nenhum plano ativo. Fale com a Jump Sales para liberar o Avaliador ou o Treinamento.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {o.plans.map((p, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span>{p.name}</span>
                    <Badge tone={p.status === "active" ? "success" : "neutral"}>{p.kind === "training_recurring" ? "Recorrente" : "Venda única"}</Badge>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 border-t border-line pt-3 text-sm">
              <div className="flex justify-between"><span className="text-muted">Créditos disponíveis</span><strong className="tabular-nums">{o.credits}</strong></div>
            </div>
          </Card>
          <Card title="Consumo do mês" description="Custo estimado de IA (transcrição + avaliação).">
            <div className="text-2xl font-semibold tabular-nums">{usd(o.usage.costUsdMicros)}</div>
            {o.limits && (
              <>
                <div className="mt-3 h-2 overflow-hidden rounded bg-surface" role="progressbar" aria-valuenow={capPct} aria-valuemin={0} aria-valuemax={100} aria-label="Uso do teto mensal">
                  <div className={`h-full ${capPct >= 90 ? "bg-red-600" : "bg-orange"}`} style={{ width: `${capPct}%` }} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                  <dt className="text-muted">Teto mensal</dt><dd className="text-right tabular-nums">{usd(o.limits.monthlyCostCapUsdMicros)}</dd>
                  <dt className="text-muted">Áudio no mês</dt><dd className="text-right tabular-nums">{Math.round(o.usage.audioSeconds / 60)} / {o.limits.monthlyAudioMinutesCap} min</dd>
                  <dt className="text-muted">Arquivo máximo</dt><dd className="text-right tabular-nums">{o.limits.maxFileMb} MB</dd>
                  <dt className="text-muted">Duração máxima</dt><dd className="text-right tabular-nums">{Math.round(o.limits.maxDurationSec / 60)} min</dd>
                </dl>
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
