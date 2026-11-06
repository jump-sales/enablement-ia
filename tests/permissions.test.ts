import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { can, PERMISSIONS } from "@/server/authz";
import { createTeam, listMembers, updateMember } from "@/server/services/members";
import { createInvitation, listInvitations } from "@/server/services/invitations";
import { updateOrganizationSettings } from "@/server/services/organizations";
import { addMember, makeOrg } from "./helpers";

afterAll(closeDb);

describe("matriz de permissões", () => {
  it("vendedor não gerencia nada e não vê a equipe", () => {
    const repAllowed = Object.keys(PERMISSIONS).filter((p) => can("rep", p as keyof typeof PERMISSIONS));
    expect(repAllowed.sort()).toEqual(["conversation.upload", "dashboard.self", "methodology.view"].sort());
  });
  it("gestor revisa, calibra e vê equipe, mas não configura a empresa", () => {
    expect(can("manager", "evaluation.review")).toBe(true);
    expect(can("manager", "calibration.manage")).toBe(true);
    expect(can("manager", "conversation.view_all")).toBe(true);
    expect(can("manager", "org.settings.manage")).toBe(false);
    expect(can("manager", "members.manage")).toBe(false);
    expect(can("manager", "methodology.manage")).toBe(false);
  });
  it("administrador tem todas as permissões", () => {
    for (const p of Object.keys(PERMISSIONS)) expect(can("org_admin", p as keyof typeof PERMISSIONS)).toBe(true);
  });
});

describe("permissões aplicadas nos serviços", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let rep: Awaited<ReturnType<typeof addMember>>;
  let manager: Awaited<ReturnType<typeof addMember>>;
  beforeAll(async () => {
    org = await makeOrg("perm");
    rep = await addMember(org.adminCtx, "rep", "sdr");
    manager = await addMember(org.adminCtx, "manager", "manager");
  });

  it("vendedor não lista membros nem convites", async () => {
    await expect(listMembers(rep.ctx)).rejects.toMatchObject({ status: 403 });
    await expect(listInvitations(rep.ctx)).rejects.toMatchObject({ status: 403 });
  });
  it("gestor lista membros mas não convida nem altera configurações", async () => {
    expect((await listMembers(manager.ctx)).length).toBe(3);
    await expect(createInvitation(manager.ctx, { email: "x@exemplo.test", role: "rep" })).rejects.toMatchObject({ status: 403 });
    await expect(updateOrganizationSettings(manager.ctx, { redactPii: false })).rejects.toMatchObject({ status: 403 });
    await expect(createTeam(manager.ctx, { name: "Novo" })).rejects.toMatchObject({ status: 403 });
  });
  it("não permite remover o último administrador", async () => {
    const members = await listMembers(org.adminCtx);
    const adminMembership = members.find((m) => m.userId === org.admin.id)!;
    await expect(updateMember(org.adminCtx, adminMembership.id, { role: "manager" })).rejects.toMatchObject({ code: "last_admin" });
  });
  it("configurações nunca permitem treino por provedores", async () => {
    const s = await updateOrganizationSettings(org.adminCtx, { redactPii: true, allowProviderTraining: true } as never);
    expect(s.allowProviderTraining).toBe(false);
  });
});
