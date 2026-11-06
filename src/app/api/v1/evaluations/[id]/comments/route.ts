import { readJson, route } from "@/server/http";
import { addComment } from "@/server/services/reviews";

export const POST = route<Promise<{ id: string }>>(async (req, ctx, { id }) => addComment(ctx, id, await readJson(req)));
