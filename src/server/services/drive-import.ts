import { z } from "zod";
import { AppError, assertCan } from "../authz";
import { DriveError, driveConfig, fetchDriveFile } from "../integrations/google-drive";
import { createConversationFromTranscript } from "./conversations";
import type { ServiceCtx } from "./types";

export const MAX_FILES_PER_IMPORT = 20;

const itemSchema = z.object({
  fileId: z.string().min(1),
  title: z.string(),
  type: z.string(),
  ownerUserId: z.string(),
  rubricId: z.string(),
  occurredAt: z.string().optional().nullable(),
  legalBasis: z.string(),
  participantsNotified: z.boolean(),
});

export const driveImportInput = z.object({
  accessToken: z.string().min(10).max(4096),
  items: z.array(itemSchema).min(1, "Selecione pelo menos um arquivo.").max(MAX_FILES_PER_IMPORT, `Importe no máximo ${MAX_FILES_PER_IMPORT} arquivos por vez.`),
});

export type DriveImportResult =
  | { fileId: string; ok: true; conversationId: string; needsReview: boolean; warnings: string[] }
  | { fileId: string; ok: false; code: string; message: string };

/**
 * Importa transcrições escolhidas no seletor do Google Drive, com os dados que a pessoa
 * preencheu para cada uma. Cada arquivo é processado de forma independente: um erro
 * em um não impede os outros. O token do Google não é armazenado.
 */
export async function importFromDrive(ctx: ServiceCtx, raw: unknown, fetchImpl: typeof fetch = fetch): Promise<DriveImportResult[]> {
  assertCan(ctx.role, "conversation.upload");
  if (!driveConfig().enabled) throw new AppError(503, "drive_not_configured", "A importação do Google Drive ainda não foi configurada.");
  const { accessToken, items } = driveImportInput.parse(raw);
  const results: DriveImportResult[] = [];
  for (const item of items) {
    try {
      const file = await fetchDriveFile(item.fileId, accessToken, fetchImpl);
      const r = await createConversationFromTranscript(
        ctx,
        { ...item, occurredAt: item.occurredAt || (file.modifiedTime ?? undefined) },
        { name: file.name, data: file.data },
        { source: "google_drive", externalRef: file.id },
      );
      results.push({ fileId: item.fileId, ok: true, conversationId: r.id, needsReview: r.needsReview, warnings: r.warnings });
    } catch (e) {
      if (e instanceof DriveError) {
        results.push({ fileId: item.fileId, ok: false, code: e.code, message: e.message });
        if (e.code === "token_expired") {
          // Sem token válido, os demais também falhariam: interrompe com a mesma mensagem.
          for (const rest of items.slice(items.indexOf(item) + 1)) results.push({ fileId: rest.fileId, ok: false, code: e.code, message: e.message });
          break;
        }
      } else if (e instanceof AppError) {
        results.push({ fileId: item.fileId, ok: false, code: e.code, message: e.message });
      } else if (e instanceof z.ZodError) {
        results.push({ fileId: item.fileId, ok: false, code: "validation_error", message: e.issues[0]?.message ?? "Dados inválidos." });
      } else throw e;
    }
  }
  return results;
}
