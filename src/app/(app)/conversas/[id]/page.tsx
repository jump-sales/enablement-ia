import { notFound } from "next/navigation";
import { AppError, can } from "@/server/authz";
import { pageContext } from "@/server/page-context";
import { getConversationDetail } from "@/server/services/conversations";
import { ConversationView } from "./view";

export const metadata = { title: "Conversa" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await pageContext();
  let detail;
  try {
    detail = await getConversationDetail(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
  return (
    <ConversationView
      data={JSON.parse(JSON.stringify(detail))}
      canReprocess={can(ctx.role, "evaluation.reprocess")}
      canDelete={can(ctx.role, "conversation.delete")}
      canEditSpeakers={can(ctx.role, "conversation.view_all") || detail.conversation.ownerUserId === ctx.userId}
    />
  );
}
