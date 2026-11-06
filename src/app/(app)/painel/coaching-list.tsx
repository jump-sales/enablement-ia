"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Badge, Select } from "@/components/ui";

type Action = { id: string; title: string; description: string | null; status: string; personName: string; evaluationId: string | null; dueDate: string | null };
const LABEL: Record<string, string> = { open: "A fazer", in_progress: "Em andamento", done: "Concluída", dismissed: "Descartada" };

export function CoachingList({ actions, showPerson, canDismiss }: { actions: Action[]; showPerson: boolean; canDismiss: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  if (!actions.length) return <p className="text-sm text-muted">Nenhuma ação de desenvolvimento ainda. O gestor cria ações a partir das avaliações.</p>;
  return (
    <>
      {error && <p className="mb-2 text-sm text-red-700" role="alert">{error}</p>}
      <ul className="flex flex-col divide-y divide-line">
        {actions.map((a) => (
          <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <div className="text-sm font-medium text-navy">{a.title}</div>
              <div className="text-xs text-muted">
                {showPerson && <>{a.personName} · </>}
                {a.dueDate ? `até ${new Date(a.dueDate).toLocaleDateString("pt-BR")}` : "sem prazo"}
              </div>
              {a.description && <p className="mt-1 text-sm">{a.description}</p>}
            </div>
            {a.status === "dismissed" ? (
              <Badge>{LABEL[a.status]}</Badge>
            ) : (
              <Select
                aria-label={`Situação de ${a.title}`}
                className="max-w-40"
                value={a.status}
                onChange={async (e) => {
                  setError(null);
                  try {
                    await api(`/coaching/${a.id}`, { method: "PATCH", body: { status: e.target.value } });
                    router.refresh();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Erro.");
                  }
                }}
              >
                {Object.entries(LABEL)
                  .filter(([k]) => k !== "dismissed" || canDismiss)
                  .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted"><Link href="/conversas" className="underline">Ver conversas avaliadas</Link></p>
    </>
  );
}
