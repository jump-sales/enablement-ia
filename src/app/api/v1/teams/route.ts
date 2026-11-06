import { route, readJson } from "@/server/http";
import { createTeam, listTeams } from "@/server/services/members";

export const GET = route(async (_req, ctx) => ({ teams: await listTeams(ctx) }));
export const POST = route(async (req, ctx) => ({ team: await createTeam(ctx, (await readJson(req)) as never) }));
