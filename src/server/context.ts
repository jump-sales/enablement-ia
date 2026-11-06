import { and, eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";
import { memberships, organizations } from "@/db/schema";
import { withUser, type MemberRole, type TenantContext } from "./tenancy";
import { AppError } from "./authz";

export const ACTIVE_ORG_COOKIE = "jump_org";

export type RequestContext = TenantContext & {
  userId: string;
  role: MemberRole;
  user: { id: string; name: string; email: string; isPlatformAdmin: boolean };
  org: { id: string; name: string; slug: string };
  jobTitle: string | null;
  ip: string | null;
  userAgent: string | null;
};

export async function getSessionUser() {
  const h = await headers();
  const s = await auth.api.getSession({ headers: h });
  return s?.user ?? null;
}

/** Organizações ativas do usuário (para seletor e escolha padrão). */
export async function listUserOrgs(userId: string) {
  return withUser(userId, (tx) =>
    tx
      .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active"), eq(organizations.status, "active"))),
  );
}

/**
 * Resolve o contexto autenticado: usuário + organização ativa + papel.
 * Lança 401 sem sessão e 403 sem vínculo ativo com a organização.
 */
export async function getRequestContext(): Promise<RequestContext> {
  const h = await headers();
  const s = await auth.api.getSession({ headers: h });
  if (!s) throw new AppError(401, "unauthenticated", "Sessão expirada. Entre novamente.");
  const orgs = await listUserOrgs(s.user.id);
  if (orgs.length === 0) throw new AppError(403, "no_organization", "Você não pertence a nenhuma empresa ativa.");
  const wanted = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  const org = orgs.find((o) => o.id === wanted) ?? orgs[0];

  const [m] = await withUser(s.user.id, (tx) =>
    tx
      .select({ role: memberships.role, jobTitle: memberships.jobTitle })
      .from(memberships)
      .where(and(eq(memberships.userId, s.user.id), eq(memberships.organizationId, org.id))),
  );

  return {
    orgId: org.id,
    userId: s.user.id,
    role: m.role,
    jobTitle: m.jobTitle,
    org: { id: org.id, name: org.name, slug: org.slug },
    user: {
      id: s.user.id,
      name: s.user.name,
      email: s.user.email,
      isPlatformAdmin: Boolean((s.user as { isPlatformAdmin?: boolean }).isPlatformAdmin),
    },
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  };
}
