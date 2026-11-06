import { route } from "@/server/http";
import { deleteConversation, getConversationDetail } from "@/server/services/conversations";

export const GET = route<Promise<{ id: string }>>(async (_req, ctx, { id }) => getConversationDetail(ctx, id));
export const DELETE = route<Promise<{ id: string }>>(async (_req, ctx, { id }) => deleteConversation(ctx, id));
