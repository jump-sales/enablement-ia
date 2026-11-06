import { Badge } from "./ui";

const MAP: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" | "brand" }> = {
  uploaded: { label: "Recebida", tone: "neutral" },
  validating: { label: "Validando", tone: "neutral" },
  extracting_audio: { label: "Processando", tone: "neutral" },
  transcribing: { label: "Transcrevendo", tone: "neutral" },
  transcribed: { label: "Transcrita", tone: "neutral" },
  needs_speaker_review: { label: "Confirmar falantes", tone: "warning" },
  evaluating: { label: "Avaliando", tone: "brand" },
  evaluated: { label: "Avaliada", tone: "success" },
  failed: { label: "Falhou", tone: "danger" },
};

export function ConversationStatus({ status }: { status: string }) {
  const s = MAP[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const TYPE_LABEL: Record<string, string> = { sdr_call: "SDR", closer_meeting: "Closer", other: "Outra" };

export function fmtDuration(ms: number | null) {
  if (!ms) return "—";
  const m = Math.round(ms / 60000);
  return m < 1 ? `${Math.round(ms / 1000)} s` : m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m} min`;
}

export const fmtScore = (n: string | number | null | undefined) =>
  n === null || n === undefined ? "—" : Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
