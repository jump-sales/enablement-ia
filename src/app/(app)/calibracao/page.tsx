import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/server/page-context";
import { calibrationAgreement } from "@/server/services/calibration";
import { listConversations } from "@/server/services/conversations";

export const metadata = { title: "Calibração" };

export default async function CalibrationPage() {
  const ctx = await pageContext("calibration.manage");
  const [ag, convs] = await Promise.all([calibrationAgreement(ctx), listConversations(ctx)]);
  const done = new Set(ag.conversations.map((c) => c.conversationId));
  const candidates = convs.filter((c) => c.status === "evaluated" && !done.has(c.id)).slice(0, 15);

  return (
    <>
      <PageHeader
        title="Calibração"
        description="O gestor avalia algumas conversas sem ver a nota da IA. Comparando as duas, sabemos se a IA está avaliando como a sua empresa avalia — e onde ajustar as âncoras da metodologia."
      />
      {!ag.enabled ? (
        <Card title="Disponível no plano Treinamento">
          <p className="text-sm text-muted">Fale com a Jump Sales para ativar a calibração.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-line bg-white p-4">
              <div className="text-sm text-muted">Concordância geral</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-navy">{ag.overall.agreedPct === null ? "—" : `${ag.overall.agreedPct}%`}</div>
              <div className="mt-1 text-xs text-muted">diferença de até 10% da escala</div>
            </div>
            <div className="rounded-lg border border-line bg-white p-4">
              <div className="text-sm text-muted">Conversas calibradas</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-navy">{ag.conversations.length}</div>
              <div className="mt-1 text-xs text-muted">recomendado: pelo menos 10</div>
            </div>
            <div className="rounded-lg border border-line bg-white p-4">
              <div className="text-sm text-muted">Comparações de critérios</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-navy">{ag.overall.pairs}</div>
            </div>
          </div>

          {ag.criteria.length > 0 && (
            <Card title="Concordância por critério" description="Critérios com concordância baixa indicam âncoras que precisam ficar mais claras.">
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-5 py-2 font-medium">Critério</th>
                      <th className="px-5 py-2 text-right font-medium">Concordância</th>
                      <th className="px-5 py-2 text-right font-medium">Diferença média</th>
                      <th className="px-5 py-2 text-right font-medium">Mesma situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ag.criteria.map((c) => {
                      const pct = c.pairs ? Math.round((c.agreed / c.pairs) * 100) : null;
                      return (
                        <tr key={c.key} className="border-b border-line last:border-0">
                          <td className="px-5 py-2.5">{c.name}</td>
                          <td className="px-5 py-2.5 text-right tabular-nums">
                            {pct === null ? "—" : `${pct}%`} {pct !== null && pct < 70 && <Badge tone="warning">revisar âncoras</Badge>}
                          </td>
                          <td className="px-5 py-2.5 text-right tabular-nums">{c.meanAbsDiff === null ? "—" : c.meanAbsDiff.toLocaleString("pt-BR")}</td>
                          <td className="px-5 py-2.5 text-right tabular-nums">{c.statusMatches}/{c.statusTotal}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card title="Conversas para calibrar">
            {candidates.length === 0 ? (
              <p className="text-sm text-muted">Nenhuma conversa avaliada pendente de calibração.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {candidates.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                    <span>{c.title} <span className="text-xs text-muted">· {c.ownerName}</span></span>
                    <Link href={`/calibracao/${c.id}`} className="font-medium text-navy underline">Avaliar</Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {ag.conversations.length > 0 && (
            <Card title="Já calibradas">
              <ul className="divide-y divide-line text-sm">
                {ag.conversations.map((c) => (
                  <li key={c.conversationId} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/conversas/${c.conversationId}`} className="text-navy underline">{c.title}</Link>
                    <span className="text-xs text-muted tabular-nums">{c.reviewer} · {c.agreedPct === null ? "—" : `${c.agreedPct}% de concordância`}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
