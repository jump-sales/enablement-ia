import { route } from "@/server/http";
import { createDraft } from "@/server/services/methodologies";

export const POST = route<Promise<{ id: string }>>(async (_req, ctx, { id }) => createDraft(ctx, id));
