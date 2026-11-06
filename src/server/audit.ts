import type { Tx } from "@/db/client";
import { auditLogs } from "@/db/schema";

export type AuditInput = {
  orgId: string | null;
  actorUserId: string | null;
  actorType?: "user" | "system" | "platform_admin";
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
};

/** Registro de auditoria na mesma transação da ação auditada (append-only). */
export async function audit(tx: Tx, input: AuditInput) {
  await tx.insert(auditLogs).values({
    organizationId: input.orgId,
    actorUserId: input.actorUserId,
    actorType: input.actorType ?? (input.actorUserId ? "user" : "system"),
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata ?? {},
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });
}
