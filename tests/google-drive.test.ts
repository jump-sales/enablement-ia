import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { creditLedger } from "@/db/schema";
import { MockLlm, setLlmForTesting } from "@/server/ai/llm";
import { setQueueForTesting, type EvaluateJob } from "@/server/jobs/queue";
import { DriveError, fetchDriveFile } from "@/server/integrations/google-drive";
import { getConversationDetail } from "@/server/services/conversations";
import { importFromDrive } from "@/server/services/drive-import";
import { createFromTemplate } from "@/server/services/methodologies";
import { withTenant } from "@/server/tenancy";
import { addMember, makeOrg, ownerQuery } from "./helpers";

const TOKEN = "token-de-teste-123";
const MEET_DOC = "1MeetDocAbcdefghij";
const VTT_FILE = "1VttFileAbcdefghij";
const MP4_FILE = "1VideoFileAbcdefgh";
const BIG_FILE = "1BigFileAbcdefghij";
const NO_ACCESS = "1NoAccessAbcdefghi";

const files: Record<string, { meta: Record<string, unknown>; body?: string | Buffer }> = {
  [MEET_DOC]: { meta: { id: MEET_DOC, name: "Reunião Acme - Transcrição", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-11-03T14:00:00Z" }, body: readFileSync("tests/fixtures/closer-fraca-meet.txt", "utf8") },
  [VTT_FILE]: { meta: { id: VTT_FILE, name: "gravacao.vtt", mimeType: "text/vtt", size: "1500" }, body: readFileSync("tests/fixtures/sdr-boa-zoom.vtt") },
  [MP4_FILE]: { meta: { id: MP4_FILE, name: "gravacao.mp4", mimeType: "video/mp4", size: "900000" } },
  [BIG_FILE]: { meta: { id: BIG_FILE, name: "enorme.txt", mimeType: "text/plain", size: String(6 * 1024 * 1024) } },
};
const calls: string[] = [];

/** Google Drive simulado: valida o token e responde como a API v3. */
const fakeGoogle: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  calls.push(url.pathname + url.search);
  const auth = new Headers(init?.headers).get("authorization");
  if (auth === "Bearer token-expirado-xyz") return new Response("{}", { status: 401 });
  if (auth !== `Bearer ${TOKEN}`) return new Response("{}", { status: 403 });
  const [, , , , id, action] = url.pathname.split("/");
  if (id === NO_ACCESS || !files[id]) return new Response("{}", { status: 404 });
  const f = files[id];
  if (action === "export") return new Response(f.body as string, { status: 200 });
  if (url.searchParams.get("alt") === "media") return new Response(new Uint8Array(f.body as Buffer), { status: 200 });
  return Response.json(f.meta);
};

const jobs: EvaluateJob[] = [];
let org: Awaited<ReturnType<typeof makeOrg>>;
let sdr: Awaited<ReturnType<typeof addMember>>;
let rubricId: string;
const item = (fileId: string, over: Record<string, unknown> = {}) => ({
  fileId, title: `Importada ${fileId.slice(0, 6)}`, type: "sdr_call", ownerUserId: sdr.user.id, rubricId,
  occurredAt: null, legalBasis: "consent", participantsNotified: true, ...over,
});

beforeAll(async () => {
  process.env.GOOGLE_CLIENT_ID = "cliente.apps.googleusercontent.com";
  process.env.GOOGLE_API_KEY = "chave-publica";
  process.env.GOOGLE_APP_ID = "123456";
  setQueueForTesting({ enqueueEvaluation: async (j) => void jobs.push(j) });
  setLlmForTesting(new MockLlm());
  org = await makeOrg("drive");
  sdr = await addMember(org.adminCtx, "rep", "sdr");
  await ownerQuery(`update "user" set name = 'Bruno Lima' where id = $1`, [sdr.user.id]);
  rubricId = (await createFromTemplate(org.adminCtx, "sdr_qualification")).rubricId;
  await withTenant({ orgId: org.org.id, userId: null, role: "system" }, (tx) => tx.insert(creditLedger).values({ organizationId: org.org.id, delta: 10, reason: "grant" }));
});
afterAll(async () => {
  setLlmForTesting(null);
  await closeDb();
});

describe("leitura de arquivos do Google Drive", () => {
  it("documento do Meet é exportado como texto", async () => {
    const f = await fetchDriveFile(MEET_DOC, TOKEN, fakeGoogle);
    expect(f.name).toBe("Reunião Acme - Transcrição.txt");
    expect(f.data.toString()).toContain("Diana Rocha:");
    expect(calls.some((c) => c.includes(`/${MEET_DOC}/export?mimeType=text%2Fplain`))).toBe(true);
  });
  it(".vtt é baixado como está", async () => {
    const f = await fetchDriveFile(VTT_FILE, TOKEN, fakeGoogle);
    expect(f.data.toString()).toMatch(/^WEBVTT/);
  });
  it("recusa vídeo, arquivo grande, id inválido, sem acesso e token expirado — sem baixar o conteúdo", async () => {
    const before = calls.length;
    await expect(fetchDriveFile(MP4_FILE, TOKEN, fakeGoogle)).rejects.toMatchObject({ code: "unsupported" });
    await expect(fetchDriveFile(BIG_FILE, TOKEN, fakeGoogle)).rejects.toMatchObject({ code: "too_large" });
    expect(calls.slice(before).some((c) => c.includes("alt=media"))).toBe(false);
    await expect(fetchDriveFile("../../etc", TOKEN, fakeGoogle)).rejects.toMatchObject({ code: "invalid_id" });
    await expect(fetchDriveFile(NO_ACCESS, TOKEN, fakeGoogle)).rejects.toMatchObject({ code: "no_access" });
    await expect(fetchDriveFile(VTT_FILE, "token-expirado-xyz", fakeGoogle)).rejects.toBeInstanceOf(DriveError);
    const offline: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(fetchDriveFile(VTT_FILE, TOKEN, offline)).rejects.toMatchObject({ code: "google_error" });
  });
});

describe("importação para a plataforma", () => {
  it("importa com os dados informados pela pessoa e marca a origem", async () => {
    const res = await importFromDrive(org.adminCtx, { accessToken: TOKEN, items: [item(VTT_FILE, { title: "Ligação do Drive" })] }, fakeGoogle);
    expect(res[0]).toMatchObject({ ok: true, needsReview: false });
    const id = (res[0] as { conversationId: string }).conversationId;
    const d = await getConversationDetail(org.adminCtx, id);
    expect(d.conversation).toMatchObject({ title: "Ligação do Drive", source: "google_drive", externalRef: VTT_FILE, status: "evaluating" });
    expect(jobs.at(-1)!.conversationId).toBe(id);
  });

  it("transcrição do Meet usa a data do arquivo quando a pessoa não informa", async () => {
    const res = await importFromDrive(org.adminCtx, { accessToken: TOKEN, items: [item(MEET_DOC, { ownerUserId: org.admin.id, type: "closer_meeting" })] }, fakeGoogle);
    expect(res[0].ok).toBe(true);
    const d = await getConversationDetail(org.adminCtx, (res[0] as { conversationId: string }).conversationId);
    expect(new Date(d.conversation.occurredAt!).toISOString()).toBe("2026-11-03T14:00:00.000Z");
    expect(d.transcript!.timestampPrecision).toBe("approximate");
  });

  it("o mesmo arquivo não é importado duas vezes; erro em um arquivo não impede os outros", async () => {
    const res = await importFromDrive(org.adminCtx, { accessToken: TOKEN, items: [item(VTT_FILE), item(MP4_FILE), item(NO_ACCESS)] }, fakeGoogle);
    expect(res.map((r) => (r.ok ? "ok" : r.code))).toEqual(["duplicate", "unsupported", "no_access"]);
  });

  it("token expirado interrompe a importação com mensagem clara", async () => {
    const res = await importFromDrive(org.adminCtx, { accessToken: "token-expirado-xyz", items: [item(MEET_DOC), item(VTT_FILE)] }, fakeGoogle);
    expect(res.every((r) => !r.ok && r.code === "token_expired")).toBe(true);
  });

  it("vendedor só importa para si mesmo; dados obrigatórios são validados por arquivo", async () => {
    const other = await addMember(org.adminCtx, "rep", "closer");
    const res = await importFromDrive(sdr.ctx, { accessToken: TOKEN, items: [item(MEET_DOC, { ownerUserId: other.user.id }), item(MEET_DOC, { participantsNotified: false, ownerUserId: sdr.user.id })] }, fakeGoogle);
    expect(res[0]).toMatchObject({ ok: false, code: "forbidden" });
    expect(res[1]).toMatchObject({ ok: false, code: "validation_error" });
  });

  it("sem configuração do Google, a importação fica indisponível", async () => {
    const saved = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    await expect(importFromDrive(org.adminCtx, { accessToken: TOKEN, items: [item(VTT_FILE)] }, fakeGoogle)).rejects.toMatchObject({ code: "drive_not_configured" });
    process.env.GOOGLE_CLIENT_ID = saved;
  });

  it("limite de arquivos por importação", async () => {
    const many = Array.from({ length: 21 }, () => item(VTT_FILE));
    await expect(importFromDrive(org.adminCtx, { accessToken: TOKEN, items: many }, fakeGoogle)).rejects.toThrow(/no máximo 20/);
  });
});
