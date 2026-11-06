import { Readable } from "node:stream";
import { getStorage, LocalStorage } from "@/server/storage";

/** Entrega de mídia do driver local via URL assinada e de curta duração. */
export async function GET(req: Request) {
  const s = getStorage();
  if (!(s instanceof LocalStorage)) return new Response("Not found", { status: 404 });
  const u = new URL(req.url);
  const key = u.searchParams.get("key") ?? "";
  const exp = Number(u.searchParams.get("exp"));
  const sig = u.searchParams.get("sig") ?? "";
  if (!s.verify(key, exp, sig)) return new Response("Link expirado ou inválido", { status: 403 });
  const stream = await s.get(key);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: { "Cache-Control": "private, no-store", "Content-Type": "application/octet-stream" },
  });
}
