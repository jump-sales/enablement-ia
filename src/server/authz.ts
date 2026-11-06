import type { MemberRole } from "./tenancy";

/**
 * Matriz de permissões (MVP: papéis fixos).
 * - org_admin: configura empresa, metodologia, usuários, retenção, limites.
 * - manager:   vê todos os vendedores, revisa e aprova avaliações, calibra.
 * - rep:       SDR/Closer — vê apenas o próprio desempenho (reforçado por RLS).
 */
export const PERMISSIONS = {
  "org.settings.manage": ["org_admin"],
  "members.view": ["org_admin", "manager"],
  "members.manage": ["org_admin"],
  "teams.manage": ["org_admin"],
  "methodology.view": ["org_admin", "manager", "rep"],
  "methodology.manage": ["org_admin"],
  "conversation.upload": ["org_admin", "manager", "rep"],
  "conversation.upload_for_others": ["org_admin", "manager"],
  "conversation.view_all": ["org_admin", "manager"],
  "conversation.delete": ["org_admin"],
  "evaluation.review": ["org_admin", "manager"],
  "evaluation.reprocess": ["org_admin", "manager"],
  "calibration.manage": ["org_admin", "manager"],
  "coaching.assign": ["org_admin", "manager"],
  "dashboard.team": ["org_admin", "manager"],
  "dashboard.self": ["org_admin", "manager", "rep"],
  "usage.view": ["org_admin", "manager"],
  "limits.manage": ["org_admin"],
  "audit.view": ["org_admin"],
} as const satisfies Record<string, readonly MemberRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: MemberRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly MemberRole[]).includes(role);
}

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const forbidden = (msg = "Você não tem permissão para esta ação.") => new AppError(403, "forbidden", msg);
export const notFound = (msg = "Recurso não encontrado.") => new AppError(404, "not_found", msg);
export const badRequest = (msg: string, code = "bad_request") => new AppError(400, code, msg);
export const conflict = (msg: string, code = "conflict") => new AppError(409, code, msg);

export function assertCan(role: MemberRole, permission: Permission) {
  if (!can(role, permission)) throw forbidden();
}
