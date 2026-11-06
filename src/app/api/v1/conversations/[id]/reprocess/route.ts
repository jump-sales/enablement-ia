import { route } from "@/server/http";
import { reprocessConversation } from "@/server/services/conversations";

export const POST = route<Promise<{ id: string }>>(async (_req, ctx, { id }) => reprocessConversation(ctx, id));
