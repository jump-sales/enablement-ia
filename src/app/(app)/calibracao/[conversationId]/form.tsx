"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Alert, Button, Card, Select } from "@/components/ui";

type Form = { scaleMin: number; scaleMax: number; criteria: { key: string; name: string; anchors: Record<string, string>; applicability: string | null }[] };

export function CalibrationForm({ conversationId, form }: { conversationId: string; form: Form }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, { status: string; score: string }>>(
    Object.fromEntries(form.criteria.map((c) => [c.key, { status: "scored", score: "" }])),
  );
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const scores = Object.fromEntries(
        Object.entries(values).map(([k, v]) => [k, v.status === "scored" ? { status: v.status, score: Number(v.score.replace(",", ".")) } : { status: v.status }]),
      );
      await api(`/calibration/${conversationId}`, { body: { scores, notes: notes || undefined } });
      router.push("/calibracao");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}
      {form.criteria.map((c) => (
        <Card key={c.key} title={c.name} description={c.applicability ?? undefined}>
          <ul className="mb-3 flex flex-col gap-1 text-xs text-muted">
            {Object.entries(c.anchors).map(([l, d]) => (
              <li key={l}><strong className="text-navy">{l}:</strong> {d}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            <Select
              aria-label={`Situação de ${c.name}`}
              className="max-w-52"
              value={values[c.key].status}
              onChange={(e) => setValues((v) => ({ ...v, [c.key]: { ...v[c.key], status: e.target.value } }))}
            >
              <option value="scored">Pontuar</option>
              <option value="not_applicable">Não aplicável</option>
              <option value="not_evaluable">Não avaliável</option>
            </Select>
            {values[c.key].status === "scored" && (
              <input
                aria-label={`Nota de ${c.name}`}
                className="w-28 rounded-md border border-line px-3 py-2 text-sm"
                inputMode="decimal"
                placeholder={`${form.scaleMin}–${form.scaleMax}`}
                required
                value={values[c.key].score}
                onChange={(e) => setValues((v) => ({ ...v, [c.key]: { ...v[c.key], score: e.target.value } }))}
              />
            )}
          </div>
        </Card>
      ))}
      <Card title="Observações (opcional)">
        <textarea className="w-full rounded-md border border-line px-3 py-2 text-sm" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Card>
      <div>
        <Button type="submit" disabled={busy}>{busy ? "Enviando…" : "Enviar avaliação de referência"}</Button>
      </div>
    </form>
  );
}
