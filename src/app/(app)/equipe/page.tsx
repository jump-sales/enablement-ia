import { PageHeader } from "@/components/ui";
import { can } from "@/server/authz";
import { pageContext } from "@/server/page-context";
import { listInvitations } from "@/server/services/invitations";
import { listMembers, listTeams } from "@/server/services/members";
import { TeamManager } from "./team-manager";

export const metadata = { title: "Equipe" };

export default async function TeamPage() {
  const ctx = await pageContext("members.view");
  const [members, invitations, teams] = await Promise.all([listMembers(ctx), listInvitations(ctx), listTeams(ctx)]);
  const pending = invitations.filter((i) => !i.acceptedAt && !i.revokedAt && i.expiresAt > new Date());
  return (
    <>
      <PageHeader
        title="Equipe"
        description="Gestores veem o desempenho de todos. SDRs e Closers veem apenas o próprio desempenho."
      />
      <TeamManager
        canManage={can(ctx.role, "members.manage")}
        currentUserId={ctx.userId}
        members={members.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))}
        invitations={pending.map((i) => ({ id: i.id, email: i.email, role: i.role, jobTitle: i.jobTitle, expiresAt: i.expiresAt.toISOString() }))}
        teams={teams.map((t) => ({ id: t.id, name: t.name }))}
      />
    </>
  );
}
