import { cookies } from "next/headers";
import { z } from "zod";
import { AppError, forbidden } from "@/server/authz";
import { ACTIVE_ORG_COOKIE, getSessionUser, listUserOrgs } from "@/server/context";
import { publicRoute, readJson } from "@/server/http";

export const POST = publicRoute(async (req) => {
  const u = await getSessionUser();
  if (!u) throw new AppError(401, "unauthenticated", "Sessão expirada.");
  const { organizationId } = z.object({ organizationId: z.string().uuid() }).parse(await readJson(req));
  const orgs = await listUserOrgs(u.id);
  if (!orgs.some((o) => o.id === organizationId)) throw forbidden();
  (await cookies()).set(ACTIVE_ORG_COOKIE, organizationId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  return { ok: true };
});
