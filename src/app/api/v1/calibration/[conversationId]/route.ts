import { readJson, route } from "@/server/http";
import { getCalibrationForm, submitCalibration } from "@/server/services/calibration";

type P = Promise<{ conversationId: string }>;
export const GET = route<P>(async (_req, ctx, { conversationId }) => getCalibrationForm(ctx, conversationId));
export const POST = route<P>(async (req, ctx, { conversationId }) => submitCalibration(ctx, conversationId, await readJson(req)));
