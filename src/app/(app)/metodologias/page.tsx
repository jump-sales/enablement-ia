import { Badge, Card, PageHeader } from "@/components/ui";
import { can } from "@/server/authz";
import { pageContext } from "@/server/page-context";
import { listRubrics, listTemplates } from "@/server/services/methodologies";
import { UseTemplateButton } from "./use-template";

export const metadata = { title: "Metodologias" };

const APPLIES: Record<string, string> = { sdr: "SDR", closer: "Closer", any: "SDR e Closer" };

export default async function MethodologiesPage() {
  const ctx = await pageContext("methodology.view");
  const [rubrics, templates] = [await listRubrics(ctx), listTemplates()];
  const manage = can(ctx.role, "methodology.manage");
  const used = new Set(rubrics.map((r) => r.template));

  return (
    <>
      <PageHeader
        title="Metodologias"
        description="Critérios usados para avaliar as conversas. Cada versão publicada é imutável: avaliações antigas continuam ligadas à versão com que foram feitas."
      />
      {rubrics.length === 0 && (
        <Card className="mb-6">
          <p className="text-sm text-muted">
            Nenhuma metodologia configurada. {manage ? "Escolha um modelo abaixo para começar; depois ele poderá ser ajustado à realidade da empresa." : "Peça ao administrador para configurar."}
          </p>
        </Card>
      )}
      <div className="flex flex-col gap-6">
        {rubrics.map((r) => (
          <Card
            key={r.id}
            title={r.name}
            description={`Aplica-se a ${APPLIES[r.appliesTo]} · versão ${r.version?.version ?? "—"} · escala ${r.version?.scaleMin ?? 0}–${r.version?.scaleMax ?? 10}`}
            actions={<Badge tone="success">Publicada</Badge>}
          >
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-5 py-2 font-medium">Critério</th>
                    <th className="px-5 py-2 font-medium">Peso</th>
                    <th className="px-5 py-2 font-medium">Âncoras (0 · 5 · 10)</th>
                  </tr>
                </thead>
                <tbody>
                  {r.criteria.map((c) => (
                    <tr key={c.id} className="border-b border-line align-top last:border-0">
                      <td className="px-5 py-3">
                        <div className="font-medium text-navy">
                          {c.name} {c.mandatory && <Badge tone="brand">Obrigatório</Badge>}
                        </div>
                        <div className="mt-0.5 text-xs text-muted">{c.competency} · {c.description}</div>
                        {c.applicability && <div className="mt-1 text-xs text-muted"><em>{c.applicability}</em></div>}
                      </td>
                      <td className="px-5 py-3 tabular-nums">{Number(c.weight)}</td>
                      <td className="px-5 py-3 text-xs text-muted">
                        <ul className="flex flex-col gap-1">
                          {Object.entries(c.behavioralAnchors).map(([lvl, d]) => (
                            <li key={lvl}><strong className="text-navy">{lvl}:</strong> {d}</li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted">A edição dos critérios e a calibração com avaliações do gestor chegam na próxima etapa.</p>
          </Card>
        ))}

        {manage && (
          <Card title="Modelos disponíveis" description="Pontos de partida editáveis — não são regras universais.">
            <div className="grid gap-4 md:grid-cols-2">
              {templates.map((t) => (
                <div key={t.key} className="flex flex-col gap-2 rounded-md border border-line p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-navy">{t.name}</div>
                      <div className="text-xs text-muted">Para {APPLIES[t.appliesTo]}</div>
                    </div>
                    {used.has(t.key) && <Badge tone="success">Em uso</Badge>}
                  </div>
                  <p className="text-sm text-muted">{t.description}</p>
                  <p className="text-xs text-muted">{t.criteria.map((c) => c.name).join(" · ")}</p>
                  <div className="mt-auto pt-2">
                    <UseTemplateButton template={t.key} disabled={used.has(t.key)} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
