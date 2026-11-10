"use client";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, JOB_LABEL, Select } from "@/components/ui";

type Seller = { id: string; name: string; jobTitle: string | null };
type Rubric = { id: string; name: string; appliesTo: string };
type DriveConfig = { clientId: string; apiKey: string; appId: string };
type Row = { fileId: string; fileName: string; title: string; ownerUserId: string; type: string; rubricId: string; occurredAt: string };
type Result = { fileId: string; ok: boolean; conversationId?: string; needsReview?: boolean; message?: string };

/* Tipos mínimos das bibliotecas do Google carregadas no navegador. */
type PickerData = { action: string; docs?: { id: string; name: string; lastEditedUtc?: number }[] };
interface PickerBuilder {
  addView(v: unknown): PickerBuilder;
  enableFeature(f: unknown): PickerBuilder;
  setOAuthToken(t: string): PickerBuilder;
  setDeveloperKey(k: string): PickerBuilder;
  setAppId(a: string): PickerBuilder;
  setLocale(l: string): PickerBuilder;
  setTitle(t: string): PickerBuilder;
  setCallback(cb: (d: PickerData) => void): PickerBuilder;
  build(): { setVisible(v: boolean): void };
}
type GoogleNS = {
  accounts: { oauth2: { initTokenClient: (o: { client_id: string; scope: string; callback: (r: { access_token?: string; error?: string }) => void }) => { requestAccessToken: (o?: { prompt?: string }) => void } } };
  picker: {
    PickerBuilder: new () => PickerBuilder;
    DocsView: new (viewId?: unknown) => { setMimeTypes: (m: string) => unknown; setIncludeFolders: (b: boolean) => unknown };
    ViewId: { DOCS: unknown };
    Feature: { MULTISELECT_ENABLED: unknown };
    Action: { PICKED: string };
  };
};
type GapiNS = { load: (lib: string, cb: () => void) => void };
const w = () => window as unknown as { google?: GoogleNS; gapi?: GapiNS };

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const MIME = [
  "application/vnd.google-apps.document",
  "text/vtt",
  "text/plain",
  "application/x-subrip",
  "application/octet-stream",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
].join(",");

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Não foi possível carregar o Google. Verifique a conexão."));
    document.head.appendChild(s);
  });
}

export function DriveImport({ config, sellers, rubrics, defaultSeller }: { config: DriveConfig; sellers: Seller[]; rubrics: Rubric[]; defaultSeller?: string }) {
  const token = useRef<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [results, setResults] = useState<Result[] | null>(null);
  const [legalBasis, setLegalBasis] = useState("legitimate_interest");
  const [notified, setNotified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const suggestRubric = (type: string) =>
    (rubrics.find((r) => r.appliesTo === (type === "sdr_call" ? "sdr" : type === "closer_meeting" ? "closer" : "any")) ?? rubrics[0])?.id ?? "";

  const openPicker = useCallback(async () => {
    setError(null);
    setResults(null);
    try {
      await Promise.all([loadScript("https://accounts.google.com/gsi/client"), loadScript("https://apis.google.com/js/api.js")]);
      await new Promise<void>((r) => w().gapi!.load("picker", r));
      const g = w().google!;
      const accessToken = await new Promise<string>((resolve, reject) => {
        g.accounts.oauth2
          .initTokenClient({
            client_id: config.clientId,
            scope: SCOPE,
            callback: (r) => (r.access_token ? resolve(r.access_token) : reject(new Error("Autorização do Google cancelada."))),
          })
          .requestAccessToken({ prompt: token.current ? "" : "consent" });
      });
      token.current = accessToken;
      const view = new g.picker.DocsView(g.picker.ViewId.DOCS);
      view.setMimeTypes(MIME);
      view.setIncludeFolders(true);
      new g.picker.PickerBuilder()
        .addView(view)
        .enableFeature(g.picker.Feature.MULTISELECT_ENABLED)
        .setOAuthToken(accessToken)
        .setDeveloperKey(config.apiKey)
        .setAppId(config.appId)
        .setLocale("pt-BR")
        .setTitle("Escolha as transcrições")
        .setCallback((data) => {
          if (data.action !== g.picker.Action.PICKED || !data.docs) return;
          setRows((prev) => {
            const known = new Set(prev.map((p) => p.fileId));
            const added = data.docs!
              .filter((d) => !known.has(d.id))
              .map((d) => ({
                fileId: d.id,
                fileName: d.name,
                title: d.name.replace(/\.(vtt|srt|txt|docx)$/i, "").replace(/\s*-\s*Transcri[cç][aã]o$/i, "").slice(0, 160),
                ownerUserId: defaultSeller ?? "",
                type: "sdr_call",
                rubricId: suggestRubric("sdr_call"),
                occurredAt: d.lastEditedUtc ? new Date(d.lastEditedUtc).toISOString().slice(0, 10) : "",
              }));
            return [...prev, ...added].slice(0, 20);
          });
        })
        .build()
        .setVisible(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível abrir o Google Drive.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, defaultSeller]);

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function submit() {
    setError(null);
    if (!token.current) return setError("Autorize o Google Drive novamente.");
    if (rows.some((r) => !r.ownerUserId)) return setError("Selecione o vendedor de cada conversa.");
    if (!notified) return setError("Confirme que os participantes foram informados sobre a gravação e a análise.");
    setBusy(true);
    try {
      const r = await api<{ results: Result[] }>("/integrations/google-drive/import", {
        body: {
          accessToken: token.current,
          items: rows.map((row) => ({
            fileId: row.fileId,
            title: row.title,
            type: row.type,
            ownerUserId: row.ownerUserId,
            rubricId: row.rubricId,
            occurredAt: row.occurredAt || null,
            legalBasis,
            participantsNotified: notified,
          })),
        },
      });
      setResults(r.results);
      // Mantém na lista só o que falhou, para corrigir e tentar de novo.
      const failed = new Set(r.results.filter((x) => !x.ok).map((x) => x.fileId));
      setRows((rs) => rs.filter((row) => failed.has(row.fileId)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao importar.");
    } finally {
      setBusy(false);
    }
  }

  const nameOf = (fileId: string) => rows.find((r) => r.fileId === fileId)?.fileName;

  return (
    <Card title="Importar do Google Drive" description="Escolha as transcrições no seu Drive. O sistema só acessa os arquivos que você selecionar.">
      <div className="flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}
        {results && (
          <ul className="flex flex-col gap-1.5 text-sm" aria-live="polite">
            {results.map((r) => (
              <li key={r.fileId} className="flex flex-wrap items-center gap-2">
                {r.ok ? <Badge tone="success">Importada</Badge> : <Badge tone="danger">Não importada</Badge>}
                {r.ok ? (
                  <Link className="text-navy underline" href={`/conversas/${r.conversationId}`}>
                    Abrir conversa{r.needsReview ? " (confirmar vendedor)" : ""}
                  </Link>
                ) : (
                  <span>{nameOf(r.fileId) ?? "Arquivo"}: {r.message}</span>
                )}
              </li>
            ))}
          </ul>
        )}

        <div>
          <Button type="button" variant={rows.length ? "secondary" : "primary"} onClick={openPicker} disabled={busy}>
            {rows.length ? "Adicionar mais arquivos" : "Escolher no Google Drive"}
          </Button>
        </div>

        {rows.map((row, i) => (
          <fieldset key={row.fileId} className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-2" disabled={busy}>
            <legend className="px-1 text-xs text-muted">{row.fileName}</legend>
            <div className="sm:col-span-2">
              <Field id={`t-${i}`} label="Título">
                <Input id={`t-${i}`} value={row.title} onChange={(e) => update(i, { title: e.target.value })} required />
              </Field>
            </div>
            <Field id={`o-${i}`} label="Vendedor avaliado">
              <Select id={`o-${i}`} value={row.ownerUserId} onChange={(e) => update(i, { ownerUserId: e.target.value })}>
                <option value="" disabled>Selecione</option>
                {sellers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}{s.jobTitle ? ` (${JOB_LABEL[s.jobTitle]})` : ""}</option>
                ))}
              </Select>
            </Field>
            <Field id={`ty-${i}`} label="Tipo de conversa">
              <Select id={`ty-${i}`} value={row.type} onChange={(e) => update(i, { type: e.target.value, rubricId: suggestRubric(e.target.value) })}>
                <option value="sdr_call">Ligação de SDR</option>
                <option value="closer_meeting">Reunião de Closer</option>
                <option value="other">Outra</option>
              </Select>
            </Field>
            <Field id={`r-${i}`} label="Metodologia">
              <Select id={`r-${i}`} value={row.rubricId} onChange={(e) => update(i, { rubricId: e.target.value })}>
                {rubrics.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </Field>
            <Field id={`d-${i}`} label="Data da conversa">
              <Input id={`d-${i}`} type="date" value={row.occurredAt} onChange={(e) => update(i, { occurredAt: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <button type="button" className="text-xs text-muted underline" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                Remover da lista
              </button>
            </div>
          </fieldset>
        ))}

        {rows.length > 0 && (
          <>
            <Field id="drive-legal" label="Base legal para análise (vale para todas)">
              <Select id="drive-legal" value={legalBasis} onChange={(e) => setLegalBasis(e.target.value)}>
                <option value="consent">Consentimento dos participantes</option>
                <option value="legitimate_interest">Legítimo interesse</option>
                <option value="contract">Execução de contrato</option>
                <option value="other">Outra</option>
              </Select>
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={notified} onChange={(e) => (setNotified(e.target.checked), setError(null))} className="mt-1" />
              <span>Os participantes de todas essas conversas foram informados de que elas foram gravadas e serão analisadas.</span>
            </label>
            <div>
              <Button onClick={submit} disabled={busy}>
                {busy ? "Importando…" : `Importar e avaliar ${rows.length} ${rows.length === 1 ? "conversa" : "conversas"}`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
