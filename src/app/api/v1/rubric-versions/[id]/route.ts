import { readJson, route } from "@/server/http";
import { discardDraft, saveDraft } from "@/server/services/methodologies";

export const PUT = route<Promise<{ id: string }>>(async (req, ctx, { id }) => saveDraft(ctx, id, await readJson(req)));
export const DELETE = route<Promise<{ id: string }>>(async (_req, ctx, { id }) => discardDraft(ctx, id));
