import { route } from "@/server/http";
import { listMembers } from "@/server/services/members";

export const GET = route(async (_req, ctx) => ({ members: await listMembers(ctx) }));
