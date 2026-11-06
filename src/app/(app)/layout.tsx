import { AppNav, type NavItem } from "@/components/app-nav";
import { ROLE_LABEL, JOB_LABEL } from "@/components/ui";
import { can } from "@/server/authz";
import { pageContext } from "@/server/page-context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await pageContext();
  const items: NavItem[] = [
    { href: "/painel", label: "Painel" },
    { href: "/conversas", label: "Conversas" },
    { href: "/metodologias", label: "Metodologias" },
    ...(can(ctx.role, "members.view") ? [{ href: "/equipe", label: "Equipe" }] : []),
    ...(can(ctx.role, "usage.view") ? [{ href: "/configuracoes", label: "Empresa e consumo" }] : []),
  ];
  const roleLabel = [ROLE_LABEL[ctx.role], ctx.jobTitle && ctx.role === "rep" ? JOB_LABEL[ctx.jobTitle] : null].filter(Boolean).join(" · ");
  return (
    <div className="min-h-dvh lg:pl-64">
      <AppNav items={items} orgName={ctx.org.name} userName={ctx.user.name} roleLabel={roleLabel} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </div>
  );
}
