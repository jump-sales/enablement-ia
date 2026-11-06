import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/ui";
import { can } from "@/server/authz";
import { pageContext } from "@/server/page-context";
import { getOverview } from "@/server/services/overview";

export const metadata = { title: "Painel" };

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-navy tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export default async function DashboardPage() {
  const ctx = await pageContext();
  const o = await getOverview(ctx);
  const isTeamView = can(ctx.role, "dashboard.team");
  const firstName = ctx.user.name.split(" ")[0];

  return (
    <>
      <PageHeader
        title={`Olá, ${firstName}`}
        description={isTeamView ? "Visão geral da equipe comercial." : "Acompanhe seu desempenho e sua evolução mês a mês."}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={isTeamView ? "Conversas enviadas" : "Suas conversas"} value={o.conversations} />
        {isTeamView && <Stat label="Pessoas ativas" value={o.members} />}
        {isTeamView && <Stat label="Créditos de avaliação" value={o.credits} hint="1 crédito = 1 conversa avaliada" />}
        {isTeamView && (
          <Stat
            label="Custo de IA no mês"
            value={(o.usage.costUsdMicros / 1_000_000).toLocaleString("pt-BR", { style: "currency", currency: "USD" })}
            hint={`${Math.round(o.usage.audioSeconds / 60)} min de áudio processados`}
          />
        )}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {ctx.role === "org_admin" && (
          <Card title="Primeiros passos" description="Configuração inicial da empresa.">
            <ol className="flex flex-col gap-3 text-sm">
              <li className="flex items-center justify-between gap-3">
                <Link href="/equipe" className="font-medium text-navy underline">1. Convidar gestores, SDRs e Closers</Link>
                {o.members > 1 ? <Badge tone="success">Feito</Badge> : <Badge>Pendente</Badge>}
              </li>
              <li className="flex items-center justify-between gap-3">
                <span>2. Configurar metodologia e critérios de avaliação</span>
                <Badge tone="brand">Próxima etapa</Badge>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span>3. Avaliar conversas de referência (calibração)</span>
                <Badge tone="brand">Próxima etapa</Badge>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span>4. Enviar a primeira gravação</span>
                <Badge tone="brand">Próxima etapa</Badge>
              </li>
            </ol>
          </Card>
        )}
        <Card title={isTeamView ? "Evolução da equipe" : "Sua evolução"} description="Comparação com os meses anteriores, por competência.">
          <p className="text-sm text-muted">
            Ainda não há conversas avaliadas. Os gráficos de evolução aparecem assim que as primeiras avaliações forem concluídas.
          </p>
        </Card>
      </div>
    </>
  );
}
