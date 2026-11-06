import { readJson, route } from "@/server/http";
import { importFromDrive } from "@/server/services/drive-import";

export const POST = route(async (req, ctx) => ({ results: await importFromDrive(ctx, await readJson(req)) }));
