import { route } from "@/server/http";
import { publishDraft } from "@/server/services/methodologies";

export const POST = route<Promise<{ id: string }>>(async (_req, ctx, { id }) => publishDraft(ctx, id));
