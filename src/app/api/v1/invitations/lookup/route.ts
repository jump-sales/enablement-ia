import { z } from "zod";
import { publicRoute, readJson } from "@/server/http";
import { lookupInvitation } from "@/server/services/invitations";

/** Mostra apenas empresa e e-mail convidado (POST para o token não ir para logs de URL). */
export const POST = publicRoute(async (req) => {
  const { token } = z.object({ token: z.string().min(20).max(200) }).parse(await readJson(req));
  const inv = await lookupInvitation(token);
  return { organizationName: inv.organization_name, email: inv.email, role: inv.role };
});
