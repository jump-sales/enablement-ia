import { readJson, route } from "@/server/http";
import { createCoachingAction, listCoachingActions } from "@/server/services/coaching";

export const GET = route(async (_req, ctx) => ({ actions: await listCoachingActions(ctx) }));
export const POST = route(async (req, ctx) => createCoachingAction(ctx, await readJson(req)));
