import { route } from "@/server/http";
import { getDashboard } from "@/server/services/dashboard";

export const GET = route(async (req, ctx) => getDashboard(ctx, { userId: new URL(req.url).searchParams.get("userId") ?? undefined }));
