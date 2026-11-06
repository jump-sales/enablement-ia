import { readJson, route } from "@/server/http";
import { updateSpeakerRoles } from "@/server/services/conversations";

export const PUT = route<Promise<{ id: string }>>(async (req, ctx, { id }) => updateSpeakerRoles(ctx, id, ((await readJson(req)) as { roles: unknown }).roles));
