import { cookies } from "next/headers";
import { AppError } from "@/server/authz";
import { ACTIVE_ORG_COOKIE, getSessionUser } from "@/server/context";
import { publicRoute, readJson } from "@/server/http";
import { createOrganization } from "@/server/services/organizations";

/** Cadastro de empresa pelo usuário autenticado (que vira administrador). */
export const POST = publicRoute(async (req) => {
  const u = await getSessionUser();
  if (!u) throw new AppError(401, "unauthenticated", "Entre para cadastrar a empresa.");
  const org = await createOrganization(u.id, (await readJson(req)) as never);
  (await cookies()).set(ACTIVE_ORG_COOKIE, org.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  return { organization: org };
});
