import { route, readJson } from "@/server/http";
import { updateMember } from "@/server/services/members";

export const PATCH = route<Promise<{ id: string }>>(async (req, ctx, { id }) => ({
  member: await updateMember(ctx, id, (await readJson(req)) as never),
}));
