import { route } from "@/server/http";
import { approveEvaluation } from "@/server/services/reviews";

export const POST = route<Promise<{ id: string }>>(async (_req, ctx, { id }) => approveEvaluation(ctx, id));
