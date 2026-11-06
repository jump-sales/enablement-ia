/**
 * Importação do Google Drive — opção A (seletor do Google + escopo `drive.file`).
 *
 * - O navegador obtém um token de acesso de curta duração (Google Identity Services)
 *   com o escopo `drive.file`, que só dá acesso aos arquivos que o usuário escolher no seletor.
 * - O servidor usa o token APENAS durante a importação; ele não é salvo nem registrado em log.
 * - Documentos do Google (transcrições do Meet) são exportados como texto puro;
 *   .vtt/.srt/.txt/.docx são baixados como estão.
 */

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const API = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_DOC = "application/vnd.google-apps.document";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXT = /\.(vtt|srt|txt|docx)$/i;
const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;

export class DriveError extends Error {
  constructor(
    message: string,
    public readonly code: "invalid_id" | "token_expired" | "no_access" | "unsupported" | "too_large" | "google_error",
  ) {
    super(message);
  }
}

export type DriveFile = { id: string; name: string; mimeType: string; modifiedTime: string | null; data: Buffer };

export function driveConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const apiKey = process.env.GOOGLE_API_KEY ?? "";
  const appId = process.env.GOOGLE_APP_ID ?? "";
  return { enabled: Boolean(clientId && apiKey && appId), clientId, apiKey, appId };
}

type Fetch = typeof fetch;

async function call(fetchImpl: Fetch, url: string, token: string) {
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (res.status === 401) throw new DriveError("A autorização do Google expirou. Clique em “Escolher no Google Drive” de novo.", "token_expired");
  if (res.status === 403 || res.status === 404) throw new DriveError("Sem acesso a este arquivo. Selecione-o novamente pelo seletor do Google.", "no_access");
  if (!res.ok) throw new DriveError("O Google Drive não respondeu como esperado. Tente novamente.", "google_error");
  return res;
}

async function readLimited(res: Response): Promise<Buffer> {
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new DriveError("Arquivo maior que 5 MB.", "too_large");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new DriveError("Arquivo maior que 5 MB.", "too_large");
  return buf;
}

/** Busca um arquivo escolhido no seletor. `fetchImpl` permite simular o Google nos testes. */
export async function fetchDriveFile(fileId: string, accessToken: string, fetchImpl: Fetch = fetch): Promise<DriveFile> {
  if (!FILE_ID.test(fileId)) throw new DriveError("Identificador de arquivo inválido.", "invalid_id");
  const id = encodeURIComponent(fileId);
  const meta = (await (
    await call(fetchImpl, `${API}/${id}?fields=id,name,mimeType,size,modifiedTime&supportsAllDrives=true`, accessToken)
  ).json()) as { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string };

  if (meta.mimeType === GOOGLE_DOC) {
    const res = await call(fetchImpl, `${API}/${id}/export?mimeType=text%2Fplain`, accessToken);
    return { id: meta.id, name: `${meta.name.replace(/\.[a-z0-9]{2,4}$/i, "")}.txt`, mimeType: meta.mimeType, modifiedTime: meta.modifiedTime ?? null, data: await readLimited(res) };
  }
  if (!ALLOWED_EXT.test(meta.name)) {
    throw new DriveError(`“${meta.name}” não é uma transcrição suportada. Escolha o documento de transcrição do Meet ou um arquivo .vtt, .srt, .txt ou .docx.`, "unsupported");
  }
  if (meta.size && Number(meta.size) > MAX_BYTES) throw new DriveError("Arquivo maior que 5 MB.", "too_large");
  const res = await call(fetchImpl, `${API}/${id}?alt=media&supportsAllDrives=true`, accessToken);
  return { id: meta.id, name: meta.name, mimeType: meta.mimeType, modifiedTime: meta.modifiedTime ?? null, data: await readLimited(res) };
}
