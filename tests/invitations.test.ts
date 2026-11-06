import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { acceptInvitation, createInvitation, INVITE_TTL_MS, lookupInvitation, revokeInvitation } from "@/server/services/invitations";
import { listMembers } from "@/server/services/members";
import { makeOrg, makeUser, ownerQuery } from "./helpers";

afterAll(closeDb);

describe("convites", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  beforeAll(async () => {
    org = await makeOrg("convites");
  });

  it("guarda apenas o hash do token", async () => {
    const u = await makeUser("hash");
    const { token, invitation } = await createInvitation(org.adminCtx, { email: u.email, role: "rep" });
    const [row] = await ownerQuery<{ token_hash: string }>(`select token_hash from invitations where id=$1`, [invitation.id]);
    expect(row.token_hash).not.toContain(token);
    expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("aceite cria o vínculo com o papel do convite e não pode ser reutilizado", async () => {
    const u = await makeUser("aceite");
    const { token } = await createInvitation(org.adminCtx, { email: u.email, role: "rep", jobTitle: "closer" });
    await acceptInvitation(token, u);
    const m = (await listMembers(org.adminCtx)).find((x) => x.userId === u.id);
    expect(m).toMatchObject({ role: "rep", jobTitle: "closer", status: "active" });
    await expect(acceptInvitation(token, u)).rejects.toMatchObject({ code: "invitation_used" });
  });

  it("recusa e-mail diferente do convidado", async () => {
    const u = await makeUser("certo");
    const other = await makeUser("errado");
    const { token } = await createInvitation(org.adminCtx, { email: u.email, role: "rep" });
    await expect(acceptInvitation(token, other)).rejects.toMatchObject({ code: "email_mismatch" });
  });

  it("recusa convite expirado, revogado ou inexistente", async () => {
    const u = await makeUser("exp");
    const { token } = await createInvitation(org.adminCtx, { email: u.email, role: "rep" });
    await expect(lookupInvitation(token, new Date(Date.now() + INVITE_TTL_MS + 1000))).rejects.toMatchObject({ code: "invitation_expired" });
    const u2 = await makeUser("rev");
    const r = await createInvitation(org.adminCtx, { email: u2.email, role: "rep" });
    await revokeInvitation(org.adminCtx, r.invitation.id);
    await expect(acceptInvitation(r.token, u2)).rejects.toMatchObject({ code: "invitation_revoked" });
    await expect(lookupInvitation("token-inventado")).rejects.toMatchObject({ status: 404 });
  });

  it("usuário de outra empresa pode aceitar convite (multiempresa) sem misturar dados", async () => {
    const other = await makeOrg("outra");
    const { token } = await createInvitation(org.adminCtx, { email: other.admin.email, role: "manager" });
    await acceptInvitation(token, other.admin);
    const rows = await ownerQuery<{ organization_id: string; role: string }>(
      `select organization_id, role from memberships where user_id=$1 order by role`,
      [other.admin.id],
    );
    expect(rows).toHaveLength(2);
  });

  it("não convida quem já é membro", async () => {
    await expect(createInvitation(org.adminCtx, { email: org.admin.email, role: "rep" })).rejects.toMatchObject({ code: "already_member" });
  });
});
