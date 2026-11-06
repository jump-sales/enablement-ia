"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, Field, Input, JOB_LABEL, Select } from "@/components/ui";

type Seller = { id: string; name: string; jobTitle: string | null };
type Rubric = { id: string; name: string; appliesTo: string };

export function UploadForm({ sellers, rubrics, defaultSeller }: { sellers: Seller[]; rubrics: Rubric[]; defaultSeller?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState("sdr_call");
  const suggested = rubrics.find((r) => r.appliesTo === (type === "sdr_call" ? "sdr" : type === "closer_meeting" ? "closer" : "any")) ?? rubrics[0];
  const [rubricId, setRubricId] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/v1/conversations", { method: "POST", body: form, credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? "Não foi possível enviar.");
      router.push(`/conversas/${data.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado.");
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" encType="multipart/form-data">
        {error && <Alert tone="error">{error}</Alert>}
        <Field id="file" label="Arquivo da transcrição" hint="Formatos aceitos: .vtt, .srt, .txt ou .docx">
          <Input id="file" name="file" type="file" accept=".vtt,.srt,.txt,.docx" required />
        </Field>
        <Field id="title" label="Título">
          <Input id="title" name="title" required minLength={2} placeholder="Ex.: Qualificação — Empresa X" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="ownerUserId" label="Vendedor avaliado">
            <Select id="ownerUserId" name="ownerUserId" defaultValue={defaultSeller ?? ""} required>
              {!defaultSeller && <option value="" disabled>Selecione</option>}
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.jobTitle ? ` (${JOB_LABEL[s.jobTitle]})` : ""}</option>
              ))}
            </Select>
          </Field>
          <Field id="type" label="Tipo de conversa">
            <Select id="type" name="type" value={type} onChange={(e) => (setType(e.target.value), setRubricId(null))}>
              <option value="sdr_call">Ligação de SDR</option>
              <option value="closer_meeting">Reunião de Closer</option>
              <option value="other">Outra</option>
            </Select>
          </Field>
          <Field id="rubricId" label="Metodologia">
            <Select id="rubricId" name="rubricId" value={rubricId ?? suggested?.id} onChange={(e) => setRubricId(e.target.value)}>
              {rubrics.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </Select>
          </Field>
          <Field id="occurredAt" label="Data da conversa">
            <Input id="occurredAt" name="occurredAt" type="date" />
          </Field>
        </div>
        <Field id="legalBasis" label="Base legal para análise" hint="Confirme com o jurídico qual se aplica à sua empresa.">
          <Select id="legalBasis" name="legalBasis" defaultValue="legitimate_interest">
            <option value="consent">Consentimento dos participantes</option>
            <option value="legitimate_interest">Legítimo interesse</option>
            <option value="contract">Execução de contrato</option>
            <option value="other">Outra</option>
          </Select>
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="participantsNotified" required className="mt-1" />
          <span>Os participantes foram informados de que a conversa foi gravada e será analisada.</span>
        </label>
        <div>
          <Button type="submit" disabled={busy}>{busy ? "Enviando…" : "Enviar e avaliar"}</Button>
        </div>
      </form>
    </Card>
  );
}
