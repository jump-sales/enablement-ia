import { cookies } from "next/headers";
import { z } from "zod";
import { AppError } from "@/server/authz";
import { ACTIVE_ORG_COOKIE, getSessionUser } from "@/server/context";
import { publicRoute, readJson } from "@/server/http";
import { acceptInvitation } from "@/server/services/invitations";

export const POST = publicRoute(async (req) => {
  const u = await getSessionUser();
  if (!u) throw new AppError(401, "unauthenticated", "Entre ou crie sua conta para aceitar o convite.");
  const { token } = z.object({ token: z.string().min(20).max(200) }).parse(await readJson(req));
  const r = await acceptInvitation(token, { id: u.id, email: u.email });
  (await cookies()).set(ACTIVE_ORG_COOKIE, r.organizationId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  return r;
});
