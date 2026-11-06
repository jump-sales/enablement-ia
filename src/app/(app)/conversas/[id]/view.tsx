"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Card, Select } from "@/components/ui";
import { ConversationStatus, fmtDuration, fmtScore, TYPE_LABEL } from "@/components/status";
import { fmtTime } from "@/server/ai/format";

type Seg = { id: string; idx: number; startMs: number; endMs: number; speakerLabel: string | null; text: string };
type Part = { id: string; speakerLabel: string; role: string; assignedBy: string };
type Evidence = { id: string; criterionScoreId: string | null; segmentId: string | null; quote: string; startMs: number | null };
type Score = {
  s: { id: string; status: string; score: string | null; justification: string | null; confidence: string | null };
  name: string;
  competency: string;
  weight: string;
  mandatory: boolean;
};
type FeedbackItem = { text: string; evidenceIds?: string[] };
type Data = {
  conversation: { id: string; title: string; type: string; status: string; statusDetail: string | null; durationMs: number | null; ownerName: string; occurredAt: string | null; createdAt: string };
  transcript: { timestampPrecision: string; format: string } | null;
  segments: Seg[];
  participants: Part[];
  evaluation: { id: string; overallScore: string | null; classification: string | null; coverage: string | null; provider: string; model: string; promptVersion: string; completedAt: string | null } | null;
  latestEvaluation: { status: string; error: string | null } | null;
  history: { id: string; status: string; overallScore: string | null; createdAt: string; isCurrent: boolean }[];
  scorecard: {
    rubric: { version: number; scaleMin: number; scaleMax: number; rubricName: string };
    scores: Score[];
    evidence: Evidence[];
    feedback: {
      summary: string;
      objective: string | null;
      strengths: FeedbackItem[];
      improvements: FeedbackItem[];
      objections: { objection: string; handling: string; evidenceIds?: string[] }[];
      investigationQuality: string | null;
      nextSteps: FeedbackItem[];
      suggestedQuestions: string[];
      coachingRecommendations: string[];
    } | null;
  } | null;
};

const ROLE: Record<string, string> = { seller: "Vendedor", customer: "Cliente", other: "Outro", unknown: "?" };

export function ConversationView({ data, canReprocess, canDelete, canEditSpeakers }: { data: Data; canReprocess: boolean; canDelete: boolean; canEditSpeakers: boolean }) {
  const router = useRouter();
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const c = data.conversation;
  const segById = new Map(data.segments.map((s) => [s.id, s]));
  const roleBySpeaker = new Map(data.participants.map((p) => [p.speakerLabel, p.role]));
  const approx = data.transcript?.timestampPrecision !== "exact";
  const reviewing = c.status === "needs_speaker_review";

  // Atualiza sozinho enquanto a avaliação está em andamento.
  useEffect(() => {
    if (c.status !== "evaluating") return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [c.status, router]);

  function jump(segmentId: string | null) {
    if (!segmentId) return;
    setActive(segmentId);
    document.getElementById(`seg-${segmentId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setBusy(false);
    }
  }

  const Chips = ({ ids }: { ids?: string[] }) =>
    ids && ids.length ? (
      <span className="ml-1 inline-flex flex-wrap gap-1">
        {ids.map((id) => {
          const s = segById.get(id);
          return s ? (
            <button key={id} onClick={() => jump(id)} className="rounded bg-surface px-1.5 text-xs text-navy underline-offset-2 hover:underline" aria-label={`Ir para o trecho em ${fmtTime(s.startMs)}`}>
              {approx ? "~" : ""}{fmtTime(s.startMs)}
            </button>
          ) : null;
        })}
      </span>
    ) : null;

  const sc = data.scorecard;
  const fb = sc?.feedback;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/conversas" className="text-sm text-muted underline">← Conversas</Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-navy">{c.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {c.ownerName} · {TYPE_LABEL[c.type]} · {fmtDuration(c.durationMs)} · {new Date(c.occurredAt ?? c.createdAt).toLocaleDateString("pt-BR")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ConversationStatus status={c.status} />
          {canReprocess && (c.status === "evaluated" || c.status === "failed") && (
            <Button variant="secondary" disabled={busy} onClick={() => run(() => api(`/conversations/${c.id}/reprocess`, { method: "POST" }))}>
              Reavaliar
            </Button>
          )}
          {canDelete && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (!confirm("Excluir definitivamente a conversa, a transcrição e as avaliações? Esta ação não pode ser desfeita.")) return;
                run(async () => {
                  await api(`/conversations/${c.id}`, { method: "DELETE" });
                  router.push("/conversas");
                });
              }}
            >
              Excluir
            </Button>
          )}
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {data.evaluation?.provider === "mock" && (
        <Alert tone="info">
          <strong>Avaliação simulada.</strong> O motor de IA ainda não está configurado; notas e textos abaixo servem só para demonstrar o fluxo.
        </Alert>
      )}
      {c.status === "evaluating" && <Alert tone="info">Avaliando a conversa… esta página atualiza sozinha.</Alert>}
      {c.status === "failed" && <Alert tone="error">{c.statusDetail ?? "A avaliação não pôde ser concluída."}</Alert>}
      {c.status === "transcribed" && c.statusDetail && <Alert tone="info">{c.statusDetail}</Alert>}
      {c.status === "needs_speaker_review" && (
        <SpeakerReview participants={data.participants} editable={canEditSpeakers} busy={busy} onSave={(roles) => run(() => api(`/conversations/${c.id}/speakers`, { method: "PUT", body: { roles } }))} />
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        {sc && (
        <div className="flex flex-col gap-6 lg:col-span-3">
          {data.evaluation && (
            <Card>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="text-sm text-muted">Nota geral</div>
                  <div className="text-4xl font-semibold tabular-nums text-navy">
                    {fmtScore(data.evaluation.overallScore)}
                    <span className="text-lg text-muted"> / {sc.rubric.scaleMax}</span>
                  </div>
                  <div className="mt-1"><Badge tone="brand">{data.evaluation.classification}</Badge></div>
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                  <dt className="text-muted">Critérios avaliados</dt>
                  <dd className="text-right tabular-nums">{Math.round(Number(data.evaluation.coverage ?? 0) * 100)}% do peso</dd>
                  <dt className="text-muted">Metodologia</dt>
                  <dd className="text-right">{sc.rubric.rubricName} v{sc.rubric.version}</dd>
                </dl>
              </div>
              <p className="mt-3 text-xs text-muted">
                A nota considera apenas critérios aplicáveis com evidência. Critérios “não avaliáveis” não contam como zero.
              </p>
            </Card>
          )}

          {(
            <Card title="Scorecard">
              <ul className="flex flex-col divide-y divide-line">
                {sc.scores.map((row) => {
                  const ev = sc.evidence.filter((e) => e.criterionScoreId === row.s.id);
                  const pct = row.s.score === null ? 0 : ((Number(row.s.score) - sc.rubric.scaleMin) / (sc.rubric.scaleMax - sc.rubric.scaleMin)) * 100;
                  return (
                    <li key={row.s.id} className="py-4 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="font-medium text-navy">
                            {row.name} {row.mandatory && <Badge tone="brand">Obrigatório</Badge>}
                          </div>
                          <div className="text-xs text-muted">{row.competency} · peso {Number(row.weight)}</div>
                        </div>
                        <div className="text-right">
                          {row.s.status === "scored" ? (
                            <span className="text-lg font-semibold tabular-nums">{fmtScore(row.s.score)}</span>
                          ) : (
                            <Badge>{row.s.status === "not_applicable" ? "Não aplicável" : "Não avaliável"}</Badge>
                          )}
                          {row.s.confidence !== null && row.s.status === "scored" && (
                            <div className="text-xs text-muted">confiança {Math.round(Number(row.s.confidence) * 100)}%</div>
                          )}
                        </div>
                      </div>
                      {row.s.status === "scored" && (
                        <div className="mt-2 h-1.5 overflow-hidden rounded bg-surface" aria-hidden>
                          <div className="h-full bg-navy" style={{ width: `${pct}%` }} />
                        </div>
                      )}
                      {row.s.justification && <p className="mt-2 whitespace-pre-line text-sm text-ink/90">{row.s.justification}</p>}
                      {ev.length > 0 && (
                        <ul className="mt-2 flex flex-col gap-1">
                          {ev.map((e) => (
                            <li key={e.id}>
                              <button onClick={() => jump(e.segmentId)} className="text-left text-sm text-navy hover:underline">
                                <span className="mr-1 rounded bg-surface px-1.5 text-xs tabular-nums">{approx ? "~" : ""}{fmtTime(e.startMs ?? 0)}</span>
                                “{e.quote}”
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {fb && (
            <Card title="Feedback">
              <div className="flex flex-col gap-5 text-sm">
                <section>
                  <h3 className="font-semibold text-navy">Resumo</h3>
                  <p className="mt-1">{fb.summary}</p>
                  {fb.objective && <p className="mt-1 text-muted"><strong className="text-navy">Objetivo identificado:</strong> {fb.objective}</p>}
                </section>
                <FeedbackList title="Pontos fortes" items={fb.strengths} Chips={Chips} />
                <FeedbackList title="Oportunidades de melhoria" items={fb.improvements} Chips={Chips} />
                {fb.objections.length > 0 && (
                  <section>
                    <h3 className="font-semibold text-navy">Objeções e tratamentos</h3>
                    <ul className="mt-1 flex flex-col gap-2">
                      {fb.objections.map((o, i) => (
                        <li key={i}><strong>{o.objection}</strong> — {o.handling} <Chips ids={o.evidenceIds} /></li>
                      ))}
                    </ul>
                  </section>
                )}
                {fb.investigationQuality && (
                  <section>
                    <h3 className="font-semibold text-navy">Qualidade da investigação</h3>
                    <p className="mt-1">{fb.investigationQuality}</p>
                  </section>
                )}
                <FeedbackList title="Próximos passos acordados" items={fb.nextSteps} Chips={Chips} empty="Nenhum próximo passo identificado na conversa." />
                {fb.suggestedQuestions.length > 0 && (
                  <section className="rounded-md border border-dashed border-navy-700/40 bg-navy/5 p-3">
                    <h3 className="font-semibold text-navy">Perguntas que poderiam ter sido feitas</h3>
                    <p className="text-xs text-muted">Sugestões — não foram ditas na conversa.</p>
                    <ul className="mt-2 list-disc pl-5">
                      {fb.suggestedQuestions.map((q, i) => <li key={i}>{q}</li>)}
                    </ul>
                  </section>
                )}
                {fb.coachingRecommendations.length > 0 && (
                  <section>
                    <h3 className="font-semibold text-navy">Recomendações de coaching</h3>
                    <ul className="mt-1 list-disc pl-5">
                      {fb.coachingRecommendations.map((q, i) => <li key={i}>{q}</li>)}
                    </ul>
                  </section>
                )}
              </div>
            </Card>
          )}

          {data.history.length > 1 && (
            <Card title="Histórico de avaliações">
              <ul className="text-sm">
                {data.history.map((h) => (
                  <li key={h.id} className="flex justify-between py-1">
                    <span>{new Date(h.createdAt).toLocaleString("pt-BR")} {h.isCurrent && <Badge tone="success">Vigente</Badge>}</span>
                    <span className="tabular-nums text-muted">{h.status === "failed" ? "falhou" : fmtScore(h.overallScore)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        )}

        <div className={sc ? "lg:col-span-2" : "lg:col-span-5"}>
          <Card title="Transcrição" description={approx ? "Horários aproximados (o arquivo original não traz o tempo de cada fala)." : undefined} className="lg:sticky lg:top-6">
            <ol className="-mx-2 flex max-h-[70vh] flex-col gap-1 overflow-y-auto px-2">
              {data.segments.map((s) => {
                const role = (s.speakerLabel && roleBySpeaker.get(s.speakerLabel)) || "unknown";
                return (
                  <li
                    key={s.id}
                    id={`seg-${s.id}`}
                    className={`rounded-md px-2 py-1.5 text-sm transition-colors ${active === s.id ? "bg-orange/20 ring-1 ring-orange" : ""}`}
                  >
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <span className="tabular-nums">{approx ? "~" : ""}{fmtTime(s.startMs)}</span>
                      <span className={role === "seller" ? "font-semibold text-navy" : ""}>{s.speakerLabel ?? "Falante não identificado"}</span>
                      {role !== "unknown" && <span>· {ROLE[role]}{reviewing ? " (sugestão)" : ""}</span>}
                    </div>
                    <p className="mt-0.5">{s.text}</p>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}

function FeedbackList({ title, items, Chips, empty }: { title: string; items: FeedbackItem[]; Chips: (p: { ids?: string[] }) => React.ReactNode; empty?: string }) {
  if (!items.length && !empty) return null;
  return (
    <section>
      <h3 className="font-semibold text-navy">{title}</h3>
      {items.length ? (
        <ul className="mt-1 list-disc pl-5">
          {items.map((it, i) => (
            <li key={i}>{it.text} <Chips ids={it.evidenceIds} /></li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-muted">{empty}</p>
      )}
    </section>
  );
}

function SpeakerReview({ participants, editable, busy, onSave }: { participants: Part[]; editable: boolean; busy: boolean; onSave: (r: { participantId: string; role: string }[]) => void }) {
  const [roles, setRoles] = useState(() => Object.fromEntries(participants.map((p) => [p.id, p.role === "unknown" ? "customer" : p.role])));
  return (
    <Card title="Quem é o vendedor nesta conversa?" description="Não conseguimos identificar o vendedor pelo nome. Confirme os papéis para iniciar a avaliação.">
      <div className="flex flex-col gap-3">
        {participants.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{p.speakerLabel}</span>
            <Select
              aria-label={`Papel de ${p.speakerLabel}`}
              className="max-w-48"
              value={roles[p.id]}
              disabled={!editable}
              onChange={(e) => setRoles((r) => ({ ...r, [p.id]: e.target.value }))}
            >
              <option value="seller">Vendedor</option>
              <option value="customer">Cliente</option>
              <option value="other">Outro</option>
            </Select>
          </div>
        ))}
        {editable && (
          <div>
            <Button disabled={busy} onClick={() => onSave(Object.entries(roles).map(([participantId, role]) => ({ participantId, role })))}>
              Confirmar e avaliar
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
