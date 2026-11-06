import { z } from "zod";
import { readJson, route } from "@/server/http";
import { createFromTemplate, listRubrics, listTemplates } from "@/server/services/methodologies";

export const GET = route(async (_req, ctx) => ({ rubrics: await listRubrics(ctx), templates: listTemplates() }));
export const POST = route(async (req, ctx) => {
  const { template } = z.object({ template: z.string() }).parse(await readJson(req));
  return createFromTemplate(ctx, template);
});
