import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { ConversationStatus, fmtDuration, fmtScore, TYPE_LABEL } from "@/components/status";
import { can } from "@/server/authz";
import { pageContext } from "@/server/page-context";
import { listConversations } from "@/server/services/conversations";

export const metadata = { title: "Conversas" };

export default async function ConversationsPage() {
  const ctx = await pageContext();
  const rows = await listConversations(ctx);
  const all = can(ctx.role, "conversation.view_all");
  return (
    <>
      <PageHeader
        title="Conversas"
        description={all ? "Todas as conversas enviadas pela equipe." : "Suas conversas avaliadas."}
        actions={
          <Link href="/conversas/nova" className="inline-flex items-center rounded-md bg-orange px-4 py-2 text-sm font-semibold text-navy hover:bg-orange-600">
            Enviar transcrição
          </Link>
        }
      />
      <Card>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma conversa ainda. Envie a transcrição gerada pelo Meet, Zoom ou Teams.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-2 font-medium">Conversa</th>
                  {all && <th className="px-5 py-2 font-medium">Vendedor</th>}
                  <th className="px-5 py-2 font-medium">Duração</th>
                  <th className="px-5 py-2 font-medium">Situação</th>
                  <th className="px-5 py-2 text-right font-medium">Nota</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface">
                    <td className="px-5 py-3">
                      <Link href={`/conversas/${r.id}`} className="font-medium text-navy underline-offset-2 hover:underline">{r.title}</Link>
                      <div className="text-xs text-muted">
                        {TYPE_LABEL[r.type]} · {(r.occurredAt ?? r.createdAt).toLocaleDateString("pt-BR")}
                      </div>
                    </td>
                    {all && <td className="px-5 py-3">{r.ownerName}</td>}
                    <td className="px-5 py-3 tabular-nums">{fmtDuration(r.durationMs)}</td>
                    <td className="px-5 py-3"><ConversationStatus status={r.status} /></td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {r.evaluation ? (
                        <span title={r.evaluation.classification ?? ""}>{fmtScore(r.evaluation.overallScore)}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
