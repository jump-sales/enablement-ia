import { route } from "@/server/http";
import { revokeInvitation } from "@/server/services/invitations";

export const DELETE = route<Promise<{ id: string }>>(async (_req, ctx, { id }) => {
  await revokeInvitation(ctx, id);
  return { ok: true };
});
