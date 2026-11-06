import { AppError } from "@/server/authz";
import { route } from "@/server/http";
import { createConversationFromTranscript, listConversations } from "@/server/services/conversations";

export const GET = route(async (_req, ctx) => ({ conversations: await listConversations(ctx) }));

/** Envio de transcrição (multipart/form-data: arquivo `file` + metadados). */
export const POST = route(async (req, ctx) => {
  const form = await req.formData().catch(() => {
    throw new AppError(400, "invalid_form", "Envio inválido.");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError(400, "file_required", "Selecione o arquivo da transcrição.");
  const meta = Object.fromEntries([...form.entries()].filter(([k]) => k !== "file"));
  if (meta.occurredAt === "") delete meta.occurredAt;
  meta.participantsNotified = (meta.participantsNotified === "on" || meta.participantsNotified === "true") as never;
  return createConversationFromTranscript(ctx, meta, { name: file.name, data: Buffer.from(await file.arrayBuffer()) });
});
