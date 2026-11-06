import { route, readJson } from "@/server/http";
import { createInvitation, listInvitations } from "@/server/services/invitations";

export const GET = route(async (_req, ctx) => ({ invitations: await listInvitations(ctx) }));

/**
 * Cria convite. MVP: o link é devolvido ao administrador para envio manual
 * (WhatsApp/e-mail). Envio automático por SMTP entra no backlog.
 */
export const POST = route(async (req, ctx) => {
  const { invitation, token } = await createInvitation(ctx, (await readJson(req)) as never);
  const base = process.env.APP_URL ?? new URL(req.url).origin;
  return { invitation, inviteUrl: `${base}/convite/${token}` };
});
