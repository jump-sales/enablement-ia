import { route, readJson } from "@/server/http";
import { getOrganization, updateOrganizationSettings } from "@/server/services/organizations";

export const GET = route(async (_req, ctx) => getOrganization(ctx));
export const PATCH = route(async (req, ctx) => ({ settings: await updateOrganizationSettings(ctx, (await readJson(req)) as never) }));
