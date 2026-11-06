import { readJson, route } from "@/server/http";
import { updateCoachingStatus } from "@/server/services/coaching";

export const PATCH = route<Promise<{ id: string }>>(async (req, ctx, { id }) => updateCoachingStatus(ctx, id, await readJson(req)));
