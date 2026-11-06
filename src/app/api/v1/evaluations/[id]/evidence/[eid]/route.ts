import { readJson, route } from "@/server/http";
import { flagEvidence } from "@/server/services/reviews";

export const PATCH = route<Promise<{ id: string; eid: string }>>(async (req, ctx, { id, eid }) => flagEvidence(ctx, id, eid, await readJson(req)));
