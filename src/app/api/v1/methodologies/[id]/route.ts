import { route } from "@/server/http";
import { getRubricForEdit } from "@/server/services/methodologies";

export const GET = route<Promise<{ id: string }>>(async (_req, ctx, { id }) => getRubricForEdit(ctx, id));
