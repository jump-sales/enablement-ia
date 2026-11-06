import { route } from "@/server/http";
import { calibrationAgreement } from "@/server/services/calibration";

export const GET = route(async (_req, ctx) => calibrationAgreement(ctx));
