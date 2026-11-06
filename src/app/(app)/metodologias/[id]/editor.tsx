"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";

type Crit = {
  key: string;
  competency: string;
  name: string;
  description: string;
  anchors: Record<string, string>;
  weight: number;
  mandatory: boolean;
  applicability: string | null;
  guidance: string | null;
};
type VersionData = {
  id: string;
  version: number;
  scaleMin: number;
  scaleMax: number;
  thresholds: { label: string; minScore: number }[];
  minCoverage: string;
  evaluatorGuidance: string | null;
  criteria: { key: string; competency: string; name: string; description: string; behavioralAnchors: Record<string, string>; weight: string; mandatory: boolean; applicability: string | null; guidance: string | null }[];
};
type Data = { current: VersionData | null; draft: VersionData | null };

const toCrit = (v: VersionData): Crit[] =>
  v.criteria.map((c) => ({ key: c.key, competency: c.competency, name: c.name, description: c.description, anchors: c.behavioralAnchors, weight: Number(c.weight), mandatory: c.mandatory, applicability: c.applicability, guidance: c.guidance }));

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

export function RubricEditor({ rubricId, data, manage }: { rubricId: string; data: Data; manage: boolean }) {
  const router = useRouter();
  const v = data.draft ?? data.current!;
  const editable = manage && Boolean(data.draft);
  const [criteria, setCriteria] = useState<Crit[]>(toCrit(v));
  const [scaleMax, setScaleMax] = useState(v.scaleMax);
  const [thresholds, setThresholds] = useState(v.thresholds);
  const [minCoverage, setMinCoverage] = useState(Number(v.minCoverage));
  const [guidance, setGuidance] = useState(v.evaluatorGuidance ?? "");
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ tone: "success", text: ok });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Erro." });
    } finally {
      setBusy(false);
    }
  }
  const payload = () => ({ scaleMin: 0, scaleMax, thresholds, minCoverage, evaluatorGuidance: guidance || null, criteria });
  const update = (i: number, patch: Partial<Crit>) => setCriteria((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const anchorLevels = [0, Math.round(scaleMax / 2), scaleMax].map(String);
  const totalWeight = criteria.reduce((s, c) => s + (Number(c.weight) || 0), 0);

  return (
    <div className="flex flex-col gap-6">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {manage && !data.draft && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">Você está vendo a versão vigente (somente leitura). Para alterar, crie um rascunho.</p>
            <Button disabled={busy} onClick={() => run(() => api(`/methodologies/${rubricId}/draft`, { method: "POST" }))}>Criar rascunho</Button>
          </div>
        </Card>
      )}

      <Card title="Parâmetros gerais">
        <fieldset disabled={!editable || busy} className="grid gap-4 md:grid-cols-3">
          <Field id="scaleMax" label="Escala de notas">
            <Select id="scaleMax" value={scaleMax} onChange={(e) => setScaleMax(Number(e.target.value))}>
              <option value={5}>0 a 5</option>
              <option value={10}>0 a 10</option>
              <option value={100}>0 a 100</option>
            </Select>
          </Field>
          <Field id="minCoverage" label="Cobertura mínima (%)" hint="Abaixo disso, o resultado é “Inconclusivo”.">
            <Input id="minCoverage" type="number" min={0} max={100} value={Math.round(minCoverage * 100)} onChange={(e) => setMinCoverage(Number(e.target.value) / 100)} />
          </Field>
          <div className="md:col-span-3">
            <Field id="guidance" label="Orientações ao avaliador de IA" hint="Contexto da empresa: produto, ticket médio, o que é um bom resultado aqui.">
              <textarea id="guidance" className="w-full rounded-md border border-line px-3 py-2 text-sm" rows={3} value={guidance} onChange={(e) => setGuidance(e.target.value)} />
            </Field>
          </div>
          <div className="md:col-span-3">
            <div className="mb-1.5 text-sm font-medium text-navy">Classificação por nota mínima</div>
            <div className="flex flex-col gap-2">
              {thresholds.map((t, i) => (
                <div key={i} className="flex gap-2">
                  <Input aria-label="Nome da faixa" value={t.label} onChange={(e) => setThresholds((ts) => ts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                  <Input aria-label="Nota mínima" className="max-w-28" type="number" step="0.1" value={t.minScore} onChange={(e) => setThresholds((ts) => ts.map((x, j) => (j === i ? { ...x, minScore: Number(e.target.value) } : x)))} />
                  {editable && thresholds.length > 1 && (
                    <Button type="button" variant="ghost" onClick={() => setThresholds((ts) => ts.filter((_, j) => j !== i))} aria-label={`Remover faixa ${t.label}`}>Remover</Button>
                  )}
                </div>
              ))}
              {editable && (
                <div><Button type="button" variant="secondary" onClick={() => setThresholds((ts) => [...ts, { label: "Nova faixa", minScore: 0 }])}>Adicionar faixa</Button></div>
              )}
            </div>
          </div>
        </fieldset>
      </Card>

      {criteria.map((c, i) => (
        <Card
          key={i}
          title={c.name || "Novo critério"}
          description={`Peso ${c.weight} (${totalWeight ? Math.round((c.weight / totalWeight) * 100) : 0}% do total)${c.mandatory ? " · obrigatório" : ""}`}
          actions={
            editable ? (
              <div className="flex gap-1">
                <Button variant="ghost" disabled={i === 0} onClick={() => setCriteria((cs) => { const n = [...cs]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })} aria-label="Mover para cima">↑</Button>
                <Button variant="ghost" disabled={i === criteria.length - 1} onClick={() => setCriteria((cs) => { const n = [...cs]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })} aria-label="Mover para baixo">↓</Button>
                <Button variant="danger" onClick={() => setCriteria((cs) => cs.filter((_, j) => j !== i))}>Remover</Button>
              </div>
            ) : undefined
          }
        >
          <fieldset disabled={!editable || busy} className="grid gap-4 md:grid-cols-3">
            <Field id={`name-${i}`} label="Nome">
              <Input id={`name-${i}`} value={c.name} onChange={(e) => update(i, { name: e.target.value, ...(c.key.startsWith("novo_") ? { key: slug(e.target.value) || c.key } : {}) })} />
            </Field>
            <Field id={`comp-${i}`} label="Competência">
              <Input id={`comp-${i}`} value={c.competency} onChange={(e) => update(i, { competency: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id={`w-${i}`} label="Peso">
                <Input id={`w-${i}`} type="number" min={0.1} step="0.5" value={c.weight} onChange={(e) => update(i, { weight: Number(e.target.value) })} />
              </Field>
              <label className="mt-7 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={c.mandatory} onChange={(e) => update(i, { mandatory: e.target.checked })} /> Obrigatório
              </label>
            </div>
            <div className="md:col-span-3">
              <Field id={`desc-${i}`} label="O que avaliar">
                <textarea id={`desc-${i}`} className="w-full rounded-md border border-line px-3 py-2 text-sm" rows={2} value={c.description} onChange={(e) => update(i, { description: e.target.value })} />
              </Field>
            </div>
            {anchorLevels.map((lvl) => (
              <Field key={lvl} id={`a-${i}-${lvl}`} label={`Âncora — nota ${lvl}`} hint={lvl === "0" ? "Como é um desempenho ruim na sua empresa" : lvl === String(scaleMax) ? "Como é o desempenho ideal" : undefined}>
                <textarea id={`a-${i}-${lvl}`} className="w-full rounded-md border border-line px-3 py-2 text-sm" rows={2} value={c.anchors[lvl] ?? ""} onChange={(e) => update(i, { anchors: { ...c.anchors, [lvl]: e.target.value } })} />
              </Field>
            ))}
            <div className="md:col-span-3">
              <Field id={`app-${i}`} label="Aplicabilidade (opcional)" hint="Ex.: “Só se o cliente levantar objeção de preço”.">
                <Input id={`app-${i}`} value={c.applicability ?? ""} onChange={(e) => update(i, { applicability: e.target.value || null })} />
              </Field>
            </div>
          </fieldset>
        </Card>
      ))}

      {editable && (
        <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <Button
            variant="secondary"
            onClick={() =>
              setCriteria((cs) => [
                ...cs,
                { key: `novo_${cs.length + 1}`, competency: "", name: "", description: "", anchors: {}, weight: 1, mandatory: false, applicability: null, guidance: null },
              ])
            }
          >
            Adicionar critério
          </Button>
          <div className="flex-1" />
          <Button variant="danger" disabled={busy} onClick={() => confirm("Descartar o rascunho?") && run(() => api(`/rubric-versions/${data.draft!.id}`, { method: "DELETE" }))}>
            Descartar rascunho
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => run(() => api(`/rubric-versions/${data.draft!.id}`, { method: "PUT", body: payload() }), "Rascunho salvo.")}>
            Salvar rascunho
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              confirm("Publicar esta versão? Ela passa a valer para as próximas avaliações e não poderá mais ser alterada.") &&
              run(async () => {
                await api(`/rubric-versions/${data.draft!.id}`, { method: "PUT", body: payload() });
                await api(`/rubric-versions/${data.draft!.id}/publish`, { method: "POST" });
              }, "Nova versão publicada.")
            }
          >
            Publicar versão {data.draft!.version}
          </Button>
        </div>
      )}
    </div>
  );
}
