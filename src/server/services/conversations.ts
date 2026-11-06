import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import {
  consentRecords,
  conversations,
  criteria,
  criterionScores,
  evaluations,
  evidenceReferences,
  feedbackReports,
  mediaAssets,
  memberships,
  organizations,
  participants,
  rubricVersions,
  rubrics,
  transcriptSegments,
  transcripts,
  user,
} from "@/db/schema";
import { redactPii } from "../ai/redact";
import { getEvaluationLlm, LlmError } from "../ai/llm";
import { PROMPT_VERSION } from "../ai/evaluation";
import { audit } from "../audit";
import { AppError, assertCan, badRequest, can, conflict, forbidden, notFound } from "../authz";
import { queue } from "../jobs/queue";
import { reviewHistory } from "./reviews";
import { mediaKey, tenantStorage } from "../storage";
import { withTenant } from "../tenancy";
import { parseTranscriptFile, TranscriptParseError, type ParsedTranscript } from "../transcripts/parse";
import { assertWithinLimits, creditBalance } from "./billing";
import type { ServiceCtx } from "./types";

export const createConversationInput = z.object({
  title: z.string().trim().min(2, "Informe um título.").max(160),
  type: z.enum(["sdr_call", "closer_meeting", "other"]),
  ownerUserId: z.string().min(1, "Selecione o vendedor."),
  rubricId: z.string().uuid("Selecione a metodologia."),
  occurredAt: z.coerce.date().optional(),
  legalBasis: z.enum(["consent", "legitimate_interest", "contract", "other"]),
  participantsNotified: z.coerce.boolean().refine((v) => v, "Confirme que os participantes foram informados sobre a gravação."),
});

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .trim();

/**
 * Identifica vendedor e cliente pelo nome do falante.
 * Se o nome do vendedor cadastrado bater com um falante → confiável.
 * Senão, sugere o falante que mais pergunta como vendedor e pede revisão.
 */
export function guessRoles(parsed: ParsedTranscript, sellerName: string) {
  const sellerTokens = norm(sellerName).split(/\s+/).filter((t) => t.length > 1);
  const first = sellerTokens[0];
  const scored = parsed.speakers.map((sp) => {
    const t = norm(sp).split(/\s+/);
    const nameMatch = first ? t[0] === first || (sellerTokens.length > 1 && sellerTokens.every((x) => t.includes(x))) : false;
    const segs = parsed.segments.filter((s) => s.speaker === sp);
    const questions = segs.reduce((a, s) => a + (s.text.match(/\?/g)?.length ?? 0), 0);
    return { speaker: sp, nameMatch, questions };
  });
  const matches = scored.filter((s) => s.nameMatch);
  if (matches.length === 1) {
    return {
      needsReview: false,
      roles: scored.map((s) => ({ speaker: s.speaker, role: s.nameMatch ? ("seller" as const) : ("customer" as const), confidence: 0.95 })),
    };
  }
  if (scored.length === 0) return { needsReview: false, roles: [] };
  // Sugestão (sempre revisada por uma pessoa): quem abre a conversa costuma ser o vendedor;
  // perguntas feitas também pesam.
  const opener = parsed.segments.find((s) => s.speaker)?.speaker;
  const rank = (s: (typeof scored)[number]) => s.questions + (s.speaker === opener ? 3 : 0);
  const top = [...scored].sort((a, b) => rank(b) - rank(a))[0];
  return {
    needsReview: true,
    roles: scored.map((s) => ({ speaker: s.speaker, role: s.speaker === top.speaker ? ("seller" as const) : ("customer" as const), confidence: 0.5 })),
  };
}

/** Cria a avaliação (fila) se a conversa estiver apta. Deve rodar dentro da transação do tenant. */
async function requestEvaluationTx(tx: Tx, ctx: { orgId: string }, conversationId: string): Promise<string | null> {
  const [conv] = await tx.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conv) throw notFound("Conversa não encontrada.");
  const [org] = await tx.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, ctx.orgId));
  if ((conv.durationMs ?? 0) < org.settings.minDurationForEvaluationSec * 1000) {
    await tx
      .update(conversations)
      .set({ status: "transcribed", statusDetail: "Conversa curta: transcrita, sem avaliação (não consome crédito).", updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
    return null;
  }
  if (!conv.rubricId) throw badRequest("Selecione uma metodologia para avaliar.");
  const [rubric] = await tx.select().from(rubrics).where(eq(rubrics.id, conv.rubricId));
  if (!rubric?.currentVersionId) throw badRequest("A metodologia escolhida não tem versão publicada.");
  const [tr] = await tx
    .select({ id: transcripts.id })
    .from(transcripts)
    .where(and(eq(transcripts.conversationId, conversationId), eq(transcripts.isCurrent, true)));
  if (!tr) throw badRequest("Conversa sem transcrição.");
  if ((await creditBalance(tx, ctx.orgId)) <= 0) throw conflict("Sem créditos de avaliação disponíveis.", "no_credits");
  await assertWithinLimits(tx, ctx.orgId);

  let llm;
  try {
    llm = getEvaluationLlm();
  } catch (e) {
    if (e instanceof LlmError) throw new AppError(503, e.code, "O motor de avaliação não está configurado. Fale com o suporte.");
    throw e;
  }
  const pending = await tx
    .select({ id: evaluations.id })
    .from(evaluations)
    .where(and(eq(evaluations.conversationId, conversationId), inArray(evaluations.status, ["queued", "running"])));
  if (pending.length) return pending[0].id; // já existe pedido em andamento (idempotente)

  const [ev] = await tx
    .insert(evaluations)
    .values({
      organizationId: ctx.orgId,
      conversationId,
      transcriptId: tr.id,
      rubricVersionId: rubric.currentVersionId,
      promptVersion: PROMPT_VERSION,
      provider: llm.provider,
      model: llm.model,
      status: "queued",
      isCurrent: false,
    })
    .returning({ id: evaluations.id });
  await tx
    .update(conversations)
    .set({ status: "evaluating", statusDetail: null, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
  return ev.id;
}

export type UploadedFile = { name: string; data: Buffer };

export type ConversationOrigin = { source: "transcript_upload" | "google_drive"; externalRef?: string | null };

export async function createConversationFromTranscript(
  ctx: ServiceCtx,
  rawInput: unknown,
  file: UploadedFile,
  origin: ConversationOrigin = { source: "transcript_upload" },
) {
  assertCan(ctx.role, "conversation.upload");
  const input = createConversationInput.parse(rawInput);
  if (input.ownerUserId !== ctx.userId) assertCan(ctx.role, "conversation.upload_for_others");

  let parsed: ParsedTranscript;
  try {
    parsed = await parseTranscriptFile(file.name, file.data);
  } catch (e) {
    if (e instanceof TranscriptParseError) throw badRequest(e.message, "invalid_transcript");
    throw e;
  }
  const sha256 = createHash("sha256").update(file.data).digest("hex");
  const conversationId = crypto.randomUUID();
  const ext = file.name.toLowerCase().match(/\.(vtt|srt|txt|docx)$/)?.[1] ?? "txt";
  const key = mediaKey(ctx.orgId, conversationId, `transcricao.${ext}`);

  const result = await withTenant(ctx, async (tx) => {
    const [owner] = await tx
      .select({ name: user.name, teamId: memberships.teamId })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(and(eq(memberships.userId, input.ownerUserId), eq(memberships.organizationId, ctx.orgId), eq(memberships.status, "active")));
    if (!owner) throw badRequest("Vendedor não encontrado nesta empresa.");
    const [rubric] = await tx.select({ id: rubrics.id }).from(rubrics).where(eq(rubrics.id, input.rubricId));
    if (!rubric) throw badRequest("Metodologia inválida.");
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, ctx.orgId));
    const limits = (await tx.query.orgLimits.findFirst()) ?? null;
    if (limits && parsed.durationMs > limits.maxDurationSec * 1000) {
      throw badRequest(`Conversa maior que o limite de ${Math.round(limits.maxDurationSec / 60)} minutos.`, "too_long");
    }
    if (parsed.durationMs < (limits?.minDurationSec ?? 10) * 1000) throw badRequest("Conversa curta demais (menos de 10 segundos).", "too_short");

    const dup = await tx
      .select({ id: mediaAssets.conversationId })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.sha256, sha256), isNull(mediaAssets.deletedAt)));
    if (dup.length) throw conflict("Esta transcrição já foi enviada.", "duplicate");
    if (origin.externalRef) {
      const imported = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.externalRef, origin.externalRef), isNull(conversations.deletedAt)));
      if (imported.length) throw conflict("Este arquivo do Google Drive já foi importado.", "duplicate");
    }

    const roles = guessRoles(parsed, owner.name);
    await tx.insert(conversations).values({
      id: conversationId,
      organizationId: ctx.orgId,
      ownerUserId: input.ownerUserId,
      teamId: owner.teamId,
      uploadedBy: ctx.userId,
      title: input.title,
      type: input.type,
      source: origin.source,
      externalRef: origin.externalRef ?? null,
      rubricId: input.rubricId,
      occurredAt: input.occurredAt ?? null,
      durationMs: parsed.durationMs,
      status: roles.needsReview ? "needs_speaker_review" : "transcribed",
      statusDetail: roles.needsReview ? "Confirme quem é o vendedor antes da avaliação." : null,
      legalBasis: input.legalBasis,
      participantsNotified: input.participantsNotified,
      retentionUntil: new Date(Date.now() + org.settings.dataRetentionDays * 86_400_000),
    });
    await tx.insert(consentRecords).values({
      organizationId: ctx.orgId,
      conversationId,
      basis: input.legalBasis,
      statement: "Declarado no envio: participantes informados sobre a gravação e a análise.",
      recordedBy: ctx.userId,
    });
    await tx.insert(mediaAssets).values({
      organizationId: ctx.orgId,
      conversationId,
      kind: "transcript",
      storageKey: key,
      mimeType: ext === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "text/plain",
      sizeBytes: file.data.length,
      sha256,
      durationMs: parsed.durationMs,
      status: "valid",
    });
    const words = parsed.segments.reduce((a, s) => a + s.text.split(/\s+/).length, 0);
    const [tr] = await tx
      .insert(transcripts)
      .values({
        organizationId: ctx.orgId,
        conversationId,
        provider: `import:${parsed.format}`,
        status: "completed",
        timestampPrecision: parsed.timestampPrecision,
        quality: {
          avgConfidence: null,
          diarizationAvailable: parsed.speakers.length > 0,
          speakerCount: parsed.speakers.length,
          wordCount: words,
          lowConfidenceRatio: null,
        },
        completedAt: new Date(),
      })
      .returning({ id: transcripts.id });
    await tx.insert(transcriptSegments).values(
      parsed.segments.map((s, i) => ({
        organizationId: ctx.orgId,
        transcriptId: tr.id,
        idx: i + 1,
        startMs: s.startMs,
        endMs: s.endMs,
        speakerLabel: s.speaker,
        text: s.text,
        textRedacted: org.settings.redactPii ? redactPii(s.text).text : null,
      })),
    );
    if (roles.roles.length) {
      await tx.insert(participants).values(
        roles.roles.map((r) => ({
          organizationId: ctx.orgId,
          conversationId,
          speakerLabel: r.speaker,
          role: r.role,
          displayName: r.speaker,
          userId: r.role === "seller" && !roles.needsReview ? input.ownerUserId : null,
          assignedBy: "auto" as const,
          confidence: String(r.confidence),
        })),
      );
    }
    let evaluationId: string | null = null;
    if (!roles.needsReview) evaluationId = await requestEvaluationTx(tx, ctx, conversationId);
    await audit(tx, {
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "conversation.created",
      targetType: "conversation",
      targetId: conversationId,
      metadata: { source: origin.source, format: parsed.format, segments: parsed.segments.length },
    });
    return { evaluationId, needsReview: roles.needsReview };
  });

  await tenantStorage(ctx.orgId).put(key, Readable.from([file.data]), "application/octet-stream");
  if (result.evaluationId) await queue().enqueueEvaluation({ orgId: ctx.orgId, conversationId, evaluationId: result.evaluationId });
  return { id: conversationId, warnings: parsed.warnings, ...result };
}

/** Confirma/corrige papéis dos falantes e, se pendente, dispara a avaliação. */
export async function updateSpeakerRoles(ctx: ServiceCtx, conversationId: string, rolesInput: unknown) {
  const roles = z.array(z.object({ participantId: z.string().uuid(), role: z.enum(["seller", "customer", "other"]) })).min(1).parse(rolesInput);
  const out = await withTenant(ctx, async (tx) => {
    const [conv] = await tx.select().from(conversations).where(eq(conversations.id, conversationId));
    if (!conv) throw notFound("Conversa não encontrada.");
    if (!can(ctx.role, "conversation.view_all") && conv.ownerUserId !== ctx.userId) throw forbidden();
    if (!roles.some((r) => r.role === "seller")) throw badRequest("Indique pelo menos um falante como vendedor.");
    for (const r of roles) {
      const [p] = await tx
        .update(participants)
        .set({ role: r.role, assignedBy: "manual", confidence: "1", userId: r.role === "seller" ? conv.ownerUserId : null })
        .where(and(eq(participants.id, r.participantId), eq(participants.conversationId, conversationId)))
        .returning({ id: participants.id });
      if (!p) throw badRequest("Participante inválido.");
    }
    await audit(tx, { orgId: ctx.orgId, actorUserId: ctx.userId, action: "conversation.speakers_updated", targetType: "conversation", targetId: conversationId, metadata: { roles } });
    if (conv.status === "needs_speaker_review") return requestEvaluationTx(tx, ctx, conversationId);
    return null;
  });
  if (out) await queue().enqueueEvaluation({ orgId: ctx.orgId, conversationId, evaluationId: out });
  return { evaluationId: out };
}

/** Reavaliação manual (gestor). Mantém a avaliação anterior no histórico. */
export async function reprocessConversation(ctx: ServiceCtx, conversationId: string) {
  assertCan(ctx.role, "evaluation.reprocess");
  const evaluationId = await withTenant(ctx, async (tx) => {
    const id = await requestEvaluationTx(tx, ctx, conversationId);
    await audit(tx, { orgId: ctx.orgId, actorUserId: ctx.userId, action: "evaluation.reprocess_requested", targetType: "conversation", targetId: conversationId });
    return id;
  });
  if (evaluationId) await queue().enqueueEvaluation({ orgId: ctx.orgId, conversationId, evaluationId });
  return { evaluationId };
}

export async function listConversations(ctx: ServiceCtx) {
  return withTenant(ctx, async (tx) => {
    // RLS já restringe o vendedor às próprias conversas.
    const rows = await tx
      .select({
        id: conversations.id,
        title: conversations.title,
        type: conversations.type,
        status: conversations.status,
        statusDetail: conversations.statusDetail,
        occurredAt: conversations.occurredAt,
        createdAt: conversations.createdAt,
        durationMs: conversations.durationMs,
        ownerName: user.name,
        ownerUserId: conversations.ownerUserId,
      })
      .from(conversations)
      .innerJoin(user, eq(user.id, conversations.ownerUserId))
      .where(isNull(conversations.deletedAt))
      .orderBy(desc(conversations.createdAt))
      .limit(200);
    const ids = rows.map((r) => r.id);
    const evs = ids.length
      ? await tx
          .select({ conversationId: evaluations.conversationId, overallScore: evaluations.overallScore, classification: evaluations.classification, provider: evaluations.provider, reviewStatus: evaluations.reviewStatus })
          .from(evaluations)
          .where(and(inArray(evaluations.conversationId, ids), eq(evaluations.isCurrent, true)))
      : [];
    const [org] = await tx.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, ctx.orgId));
    const hideUnapproved = org.settings.requireApprovalBeforeRepVisibility && !can(ctx.role, "evaluation.review");
    return rows.map((r) => {
      const ev = evs.find((e) => e.conversationId === r.id) ?? null;
      if (ev && hideUnapproved && ev.reviewStatus !== "approved") {
        return { ...r, evaluation: { ...ev, overallScore: null, classification: "Aguardando aprovação" } };
      }
      return { ...r, evaluation: ev };
    });
  });
}

export async function getConversationDetail(ctx: ServiceCtx, id: string) {
  return withTenant(ctx, async (tx) => {
    const [conv] = await tx
      .select({ c: conversations, ownerName: user.name })
      .from(conversations)
      .innerJoin(user, eq(user.id, conversations.ownerUserId))
      .where(and(eq(conversations.id, id), isNull(conversations.deletedAt)));
    if (!conv) throw notFound("Conversa não encontrada.");
    const [tr] = await tx.select().from(transcripts).where(and(eq(transcripts.conversationId, id), eq(transcripts.isCurrent, true)));
    const segs = tr
      ? await tx
          .select({ id: transcriptSegments.id, idx: transcriptSegments.idx, startMs: transcriptSegments.startMs, endMs: transcriptSegments.endMs, speakerLabel: transcriptSegments.speakerLabel, text: transcriptSegments.text })
          .from(transcriptSegments)
          .where(eq(transcriptSegments.transcriptId, tr.id))
          .orderBy(asc(transcriptSegments.idx))
      : [];
    const parts = await tx.select().from(participants).where(eq(participants.conversationId, id));
    const evs = await tx.select().from(evaluations).where(eq(evaluations.conversationId, id)).orderBy(desc(evaluations.createdAt));
    const current = evs.find((e) => e.isCurrent) ?? null;
    const latest = evs[0] ?? null;
    let scorecard = null;
    if (current) {
      const [rv] = await tx
        .select({ version: rubricVersions.version, scaleMin: rubricVersions.scaleMin, scaleMax: rubricVersions.scaleMax, rubricName: rubrics.name })
        .from(rubricVersions)
        .innerJoin(rubrics, eq(rubrics.id, rubricVersions.rubricId))
        .where(eq(rubricVersions.id, current.rubricVersionId));
      const scores = await tx
        .select({ s: criterionScores, name: criteria.name, competency: criteria.competency, weight: criteria.weight, mandatory: criteria.mandatory, position: criteria.position })
        .from(criterionScores)
        .innerJoin(criteria, eq(criteria.id, criterionScores.criterionId))
        .where(eq(criterionScores.evaluationId, current.id))
        .orderBy(asc(criteria.position));
      const evidence = await tx.select().from(evidenceReferences).where(eq(evidenceReferences.evaluationId, current.id));
      const [feedback] = await tx.select().from(feedbackReports).where(eq(feedbackReports.evaluationId, current.id));
      scorecard = { rubric: rv, scores, evidence, feedback: feedback ?? null, review: await reviewHistory(tx, current.id) };
    }
    // Política da empresa: o vendedor só vê a avaliação depois da aprovação do gestor.
    let pendingApproval = false;
    if (current && !can(ctx.role, "evaluation.review")) {
      const [org] = await tx.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, ctx.orgId));
      if (org.settings.requireApprovalBeforeRepVisibility && current.reviewStatus !== "approved") {
        pendingApproval = true;
        scorecard = null;
      }
    }
    return {
      pendingApproval,
      conversation: { ...conv.c, ownerName: conv.ownerName },
      transcript: tr ? { id: tr.id, format: tr.provider, timestampPrecision: tr.timestampPrecision, quality: tr.quality } : null,
      segments: segs,
      participants: parts,
      evaluation: pendingApproval && current ? { ...current, overallScore: null, classification: null, coverage: null } : current,
      latestEvaluation: latest,
      history: evs.map((e) => ({ id: e.id, status: e.status, overallScore: pendingApproval ? null : e.overallScore, classification: e.classification, createdAt: e.createdAt, isCurrent: e.isCurrent, model: e.model, error: e.error })),
      scorecard,
    };
  });
}

/** Exclusão definitiva (LGPD): arquivos + transcrição + avaliações. */
export async function deleteConversation(ctx: ServiceCtx, id: string) {
  assertCan(ctx.role, "conversation.delete");
  const keys = await withTenant(ctx, async (tx) => {
    const [conv] = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, id));
    if (!conv) throw notFound("Conversa não encontrada.");
    const assets = await tx.select({ key: mediaAssets.storageKey }).from(mediaAssets).where(eq(mediaAssets.conversationId, id));
    await tx.delete(conversations).where(eq(conversations.id, id));
    await audit(tx, { orgId: ctx.orgId, actorUserId: ctx.userId, action: "conversation.deleted", targetType: "conversation", targetId: id, metadata: { files: assets.length } });
    return assets.map((a) => a.key);
  });
  const st = tenantStorage(ctx.orgId);
  for (const k of keys) await st.delete(k);
  return { deletedFiles: keys.length };
}
