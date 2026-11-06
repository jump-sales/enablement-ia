import { readJson, route } from "@/server/http";
import { overrideCriterion } from "@/server/services/reviews";

export const PATCH = route<Promise<{ id: string; cid: string }>>(async (req, ctx, { id, cid }) => overrideCriterion(ctx, id, cid, await readJson(req)));
