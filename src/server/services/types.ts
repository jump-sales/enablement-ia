import type { MemberRole } from "../tenancy";

/** Contexto mínimo que os serviços exigem (independente do Next.js, testável). */
export type ServiceCtx = {
  orgId: string;
  userId: string;
  role: MemberRole;
  ip?: string | null;
  userAgent?: string | null;
};
