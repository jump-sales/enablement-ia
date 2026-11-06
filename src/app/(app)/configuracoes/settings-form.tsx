"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Card, Field, Input } from "@/components/ui";

type Settings = {
  mediaRetentionDays: number;
  dataRetentionDays: number;
  minDurationForEvaluationSec: number;
  redactPii: boolean;
  requireApprovalBeforeRepVisibility: boolean;
};

export function SettingsForm({ editable, name, settings }: { editable: boolean; name: string; settings: Settings }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setMsg(null);
    try {
      await api("/organization", {
        method: "PATCH",
        body: {
          name: f.get("name"),
          mediaRetentionDays: Number(f.get("mediaRetentionDays")),
          dataRetentionDays: Number(f.get("dataRetentionDays")),
          minDurationForEvaluationSec: Number(f.get("minDurationForEvaluationSec")),
          redactPii: f.get("redactPii") === "on",
          requireApprovalBeforeRepVisibility: f.get("requireApproval") === "on",
        },
      });
      setMsg({ tone: "success", text: "Configurações salvas." });
      router.refresh();
    } catch (err) {
      setMsg({ tone: "error", text: err instanceof Error ? err.message : "Erro ao salvar." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Configurações da empresa" description={editable ? undefined : "Somente administradores podem alterar."}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <fieldset disabled={!editable || busy} className="flex flex-col gap-4">
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <Field id="name" label="Nome da empresa">
            <Input id="name" name="name" defaultValue={name} required minLength={2} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="mediaRetentionDays" label="Guardar gravação original (dias)" hint="0 = apagar logo após extrair o áudio.">
              <Input id="mediaRetentionDays" name="mediaRetentionDays" type="number" min={0} max={3650} defaultValue={settings.mediaRetentionDays} />
            </Field>
            <Field id="dataRetentionDays" label="Guardar transcrições e avaliações (dias)">
              <Input id="dataRetentionDays" name="dataRetentionDays" type="number" min={30} max={3650} defaultValue={settings.dataRetentionDays} />
            </Field>
            <Field id="minDurationForEvaluationSec" label="Duração mínima para avaliar (s)" hint="Ligações mais curtas só são transcritas, sem gastar crédito.">
              <Input id="minDurationForEvaluationSec" name="minDurationForEvaluationSec" type="number" min={10} max={600} defaultValue={settings.minDurationForEvaluationSec} />
            </Field>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="redactPii" defaultChecked={settings.redactPii} className="mt-1" />
            <span>
              <strong>Mascarar dados pessoais</strong> (CPF, CNPJ, e-mail, telefone, cartão) antes do envio ao modelo de IA.
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="requireApproval" defaultChecked={settings.requireApprovalBeforeRepVisibility} className="mt-1" />
            <span>
              <strong>Aprovação do gestor</strong> antes de o vendedor ver a avaliação.
            </span>
          </label>
          <p className="text-xs text-muted">As conversas nunca são autorizadas para treinamento de modelos de terceiros.</p>
          {editable && (
            <div>
              <Button type="submit">Salvar</Button>
            </div>
          )}
        </fieldset>
      </form>
    </Card>
  );
}
