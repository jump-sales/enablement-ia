/**
 * Modelo de dados — JUMP Sales Enablement AI
 *
 * Regras:
 * - Toda tabela com dado de cliente tem `organization_id` (tenant) e política RLS
 *   (ver drizzle/0001_rls.sql). A aplicação conecta com um papel sem BYPASSRLS.
 * - Tabelas de autenticação (user/session/account/verification) seguem o formato do
 *   Better Auth e são globais (um usuário pode pertencer a várias organizações).
 * - Versões de rubrica publicadas são imutáveis; avaliações referenciam a versão exata.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const orgId = () => uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" });

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */
export const memberRole = pgEnum("member_role", ["org_admin", "manager", "rep"]);
export const jobTitle = pgEnum("job_title", ["sdr", "closer", "manager", "other"]);
export const memberStatus = pgEnum("member_status", ["active", "disabled"]);
export const orgStatus = pgEnum("org_status", ["active", "suspended"]);
export const planKind = pgEnum("plan_kind", ["evaluator_one_time", "training_recurring"]);
export const entitlementStatus = pgEnum("entitlement_status", ["active", "expired", "canceled"]);
export const creditReason = pgEnum("credit_reason", ["grant", "consume", "refund", "adjust"]);
export const conversationType = pgEnum("conversation_type", ["sdr_call", "closer_meeting", "other"]);
export const conversationStatus = pgEnum("conversation_status", [
  "uploaded",
  "validating",
  "extracting_audio",
  "transcribing",
  "transcribed",
  "evaluating",
  "evaluated",
  "failed",
]);
export const legalBasis = pgEnum("legal_basis", ["consent", "legitimate_interest", "contract", "other"]);
export const mediaKind = pgEnum("media_kind", ["original", "audio"]);
export const mediaStatus = pgEnum("media_status", ["pending_upload", "uploaded", "valid", "invalid", "deleted"]);
export const speakerRole = pgEnum("speaker_role", ["seller", "customer", "other", "unknown"]);
export const assignedBy = pgEnum("assigned_by", ["auto", "manual"]);
export const processingStatus = pgEnum("processing_status", ["queued", "running", "completed", "failed", "superseded"]);
export const methodologyTemplate = pgEnum("methodology_template", [
  "spin",
  "challenger",
  "consultative",
  "sdr_qualification",
  "closer_discovery",
  "custom",
]);
export const rubricAppliesTo = pgEnum("rubric_applies_to", ["sdr", "closer", "any"]);
export const rubricVersionStatus = pgEnum("rubric_version_status", ["draft", "published", "archived"]);
export const criterionStatus = pgEnum("criterion_status", ["scored", "not_applicable", "not_evaluable"]);
export const reviewStatus = pgEnum("review_status", ["pending", "in_review", "approved", "contested"]);
export const evidenceKind = pgEnum("evidence_kind", [
  "criterion",
  "strength",
  "improvement",
  "objection",
  "next_step",
  "interest",
]);
export const overrideAction = pgEnum("override_action", [
  "score_change",
  "status_change",
  "evidence_correction",
  "false_positive",
  "contest",
  "approve",
  "reprocess",
  "speaker_correction",
]);
export const coachingStatus = pgEnum("coaching_status", ["open", "in_progress", "done", "dismissed"]);
export const usageStage = pgEnum("usage_stage", [
  "validate",
  "extract_audio",
  "transcribe",
  "redact",
  "role_mapping",
  "event_extraction",
  "evaluation",
  "feedback",
  "streaming",
]);
export const actorType = pgEnum("actor_type", ["user", "system", "platform_admin"]);

/* ------------------------------------------------------------------ */
/* Autenticação (formato Better Auth)                                  */
/* ------------------------------------------------------------------ */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  locale: text("locale").notNull().default("pt-BR"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ */
/* Organizações, membros, times                                        */
/* ------------------------------------------------------------------ */
export type OrgSettings = {
  /** Dias de retenção de mídia original após processamento (0 = apagar logo após extrair áudio). */
  mediaRetentionDays: number;
  /** Dias de retenção de transcrições e avaliações. */
  dataRetentionDays: number;
  /** Conversas mais curtas que isso são transcritas mas não avaliadas (economia). */
  minDurationForEvaluationSec: number;
  /** Mascarar dados pessoais (CPF, e-mail, telefone…) antes de enviar ao LLM. */
  redactPii: boolean;
  /** Avaliações exigem aprovação do gestor antes de ficarem visíveis ao vendedor. */
  requireApprovalBeforeRepVisibility: boolean;
  /** Proibição explícita de uso das conversas para treino por terceiros. */
  allowProviderTraining: false;
};

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  mediaRetentionDays: 30,
  dataRetentionDays: 365,
  minDurationForEvaluationSec: 60,
  redactPii: true,
  requireApprovalBeforeRepVisibility: false,
  allowProviderTraining: false,
};

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: orgStatus("status").notNull().default("active"),
  locale: text("locale").notNull().default("pt-BR"),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  settings: jsonb("settings").$type<OrgSettings>().notNull().default(DEFAULT_ORG_SETTINGS),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("teams_org_name_uq").on(t.organizationId, t.name)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull(),
    jobTitle: jobTitle("job_title"),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    status: memberStatus("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("memberships_org_user_uq").on(t.organizationId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    email: text("email").notNull(),
    role: memberRole("role").notNull(),
    jobTitle: jobTitle("job_title"),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    /** SHA-256 do token; o token em claro só existe no link enviado. */
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by").notNull().references(() => user.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: text("accepted_by").references(() => user.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("invitations_org_idx").on(t.organizationId)],
);

/* ------------------------------------------------------------------ */
/* Planos, direitos de uso, créditos e limites                         */
/* ------------------------------------------------------------------ */
export const subscriptionPlans = pgTable("subscription_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  kind: planKind("kind").notNull(),
  /** Créditos de avaliação concedidos na compra (avaliador) ou por mês (treinamento). */
  evaluationCredits: integer("evaluation_credits").notNull().default(0),
  priceCents: integer("price_cents").notNull().default(0),
  currency: text("currency").notNull().default("BRL"),
  features: jsonb("features").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const orgEntitlements = pgTable(
  "org_entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    planId: uuid("plan_id").notNull().references(() => subscriptionPlans.id),
    kind: planKind("kind").notNull(),
    status: entitlementStatus("status").notNull().default("active"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    /** Nulo para venda única (vitalícia); preenchido para recorrência. */
    endsAt: timestamp("ends_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("entitlements_org_idx").on(t.organizationId)],
);

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    delta: integer("delta").notNull(),
    reason: creditReason("reason").notNull(),
    evaluationId: uuid("evaluation_id"),
    entitlementId: uuid("entitlement_id").references(() => orgEntitlements.id),
    note: text("note"),
    createdBy: text("created_by"),
    /** Evita débito duplicado do mesmo job. */
    idempotencyKey: text("idempotency_key").unique(),
    createdAt: createdAt(),
  },
  (t) => [index("credit_ledger_org_idx").on(t.organizationId)],
);

export const orgLimits = pgTable("org_limits", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  monthlyCostCapUsdMicros: bigint("monthly_cost_cap_usd_micros", { mode: "number" }).notNull().default(50_000_000),
  monthlyAudioMinutesCap: integer("monthly_audio_minutes_cap").notNull().default(3000),
  maxFileMb: integer("max_file_mb").notNull().default(1024),
  maxDurationSec: integer("max_duration_sec").notNull().default(2 * 60 * 60),
  minDurationSec: integer("min_duration_sec").notNull().default(10),
  maxConcurrentJobs: integer("max_concurrent_jobs").notNull().default(3),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ */
/* Conversas, mídia, participantes, consentimento                      */
/* ------------------------------------------------------------------ */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    /** Vendedor avaliado (SDR/Closer). Base da regra de visibilidade individual. */
    ownerUserId: text("owner_user_id").notNull().references(() => user.id),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    uploadedBy: text("uploaded_by").notNull().references(() => user.id),
    title: text("title").notNull(),
    type: conversationType("type").notNull().default("other"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    language: text("language"),
    durationMs: integer("duration_ms"),
    status: conversationStatus("status").notNull().default("uploaded"),
    statusDetail: text("status_detail"),
    legalBasis: legalBasis("legal_basis").notNull(),
    participantsNotified: boolean("participants_notified").notNull().default(false),
    retentionUntil: timestamp("retention_until", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("conversations_org_owner_idx").on(t.organizationId, t.ownerUserId),
    index("conversations_org_created_idx").on(t.organizationId, t.createdAt),
  ],
);

export const consentRecords = pgTable("consent_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: orgId(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  basis: legalBasis("basis").notNull(),
  statement: text("statement").notNull(),
  recordedBy: text("recorded_by").notNull().references(() => user.id),
  createdAt: createdAt(),
});

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    kind: mediaKind("kind").notNull(),
    /** Sempre prefixada por org/{organization_id}/ — validado no serviço de storage. */
    storageKey: text("storage_key").notNull().unique(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    sha256: text("sha256"),
    durationMs: integer("duration_ms"),
    probe: jsonb("probe").$type<Record<string, unknown>>(),
    status: mediaStatus("status").notNull().default("pending_upload"),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("media_org_sha_idx").on(t.organizationId, t.sha256)],
);

export const participants = pgTable("participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: orgId(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  speakerLabel: text("speaker_label").notNull(),
  role: speakerRole("role").notNull().default("unknown"),
  displayName: text("display_name"),
  userId: text("user_id").references(() => user.id),
  assignedBy: assignedBy("assigned_by").notNull().default("auto"),
  confidence: numeric("confidence", { precision: 4, scale: 3 }),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Transcrição                                                         */
/* ------------------------------------------------------------------ */
export type TranscriptQuality = {
  avgConfidence: number | null;
  diarizationAvailable: boolean;
  speakerCount: number;
  wordCount: number;
  lowConfidenceRatio: number | null;
};

export const transcripts = pgTable(
  "transcripts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    provider: text("provider").notNull(),
    model: text("model"),
    language: text("language"),
    status: processingStatus("status").notNull().default("queued"),
    isCurrent: boolean("is_current").notNull().default(true),
    quality: jsonb("quality").$type<TranscriptQuality>(),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("transcripts_conv_version_uq").on(t.conversationId, t.version)],
);

export const transcriptSegments = pgTable(
  "transcript_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    transcriptId: uuid("transcript_id").notNull().references(() => transcripts.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    speakerLabel: text("speaker_label"),
    text: text("text").notNull(),
    /** Texto com dados pessoais mascarados — é o que vai para o LLM. */
    textRedacted: text("text_redacted"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
  },
  (t) => [uniqueIndex("segments_transcript_idx_uq").on(t.transcriptId, t.idx)],
);

/* ------------------------------------------------------------------ */
/* Metodologias e rubricas versionadas                                 */
/* ------------------------------------------------------------------ */
export const methodologies = pgTable("methodologies", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: orgId(),
  name: text("name").notNull(),
  template: methodologyTemplate("template").notNull().default("custom"),
  description: text("description"),
  createdAt: createdAt(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const rubrics = pgTable("rubrics", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: orgId(),
  methodologyId: uuid("methodology_id").notNull().references(() => methodologies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  appliesTo: rubricAppliesTo("applies_to").notNull().default("any"),
  currentVersionId: uuid("current_version_id"),
  createdAt: createdAt(),
});

export type ClassificationThreshold = { label: string; minScore: number };

export const rubricVersions = pgTable(
  "rubric_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    rubricId: uuid("rubric_id").notNull().references(() => rubrics.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: rubricVersionStatus("status").notNull().default("draft"),
    scaleMin: integer("scale_min").notNull().default(0),
    scaleMax: integer("scale_max").notNull().default(10),
    thresholds: jsonb("thresholds").$type<ClassificationThreshold[]>().notNull().default([]),
    /** Fração mínima do peso aplicável que precisa ser avaliável para emitir nota geral. */
    minCoverage: numeric("min_coverage", { precision: 4, scale: 3 }).notNull().default("0.5"),
    evaluatorGuidance: text("evaluator_guidance"),
    contentHash: text("content_hash"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: text("published_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("rubric_versions_uq").on(t.rubricId, t.version)],
);

export const criteria = pgTable(
  "criteria",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    rubricVersionId: uuid("rubric_version_id").notNull().references(() => rubricVersions.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    competency: text("competency").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    /** Âncoras comportamentais por nível: { "0": "...", "5": "...", "10": "..." } — calibradas por cliente. */
    behavioralAnchors: jsonb("behavioral_anchors").$type<Record<string, string>>().notNull().default({}),
    weight: numeric("weight", { precision: 6, scale: 3 }).notNull().default("1"),
    mandatory: boolean("mandatory").notNull().default(false),
    /** Regra de aplicabilidade em linguagem natural (ex.: "somente se houver objeção de preço"). */
    applicability: text("applicability"),
    guidance: text("guidance"),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("criteria_version_key_uq").on(t.rubricVersionId, t.key)],
);

/* ------------------------------------------------------------------ */
/* Avaliações                                                          */
/* ------------------------------------------------------------------ */
export const evaluations = pgTable(
  "evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    transcriptId: uuid("transcript_id").notNull().references(() => transcripts.id),
    rubricVersionId: uuid("rubric_version_id").notNull().references(() => rubricVersions.id),
    promptVersion: text("prompt_version").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    status: processingStatus("status").notNull().default("queued"),
    overallScore: numeric("overall_score", { precision: 6, scale: 3 }),
    classification: text("classification"),
    coverage: numeric("coverage", { precision: 4, scale: 3 }),
    isCurrent: boolean("is_current").notNull().default(true),
    supersedesId: uuid("supersedes_id"),
    reviewStatus: reviewStatus("review_status").notNull().default("pending"),
    approvedBy: text("approved_by").references(() => user.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("evaluations_org_conv_idx").on(t.organizationId, t.conversationId)],
);

export const criterionScores = pgTable(
  "criterion_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    evaluationId: uuid("evaluation_id").notNull().references(() => evaluations.id, { onDelete: "cascade" }),
    criterionId: uuid("criterion_id").notNull().references(() => criteria.id),
    status: criterionStatus("status").notNull(),
    score: numeric("score", { precision: 6, scale: 3 }),
    /** Nota original da IA, preservada mesmo após ajuste humano. */
    aiStatus: criterionStatus("ai_status").notNull(),
    aiScore: numeric("ai_score", { precision: 6, scale: 3 }),
    justification: text("justification"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    overridden: boolean("overridden").notNull().default(false),
  },
  (t) => [uniqueIndex("criterion_scores_uq").on(t.evaluationId, t.criterionId)],
);

export const evidenceReferences = pgTable("evidence_references", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: orgId(),
  evaluationId: uuid("evaluation_id").notNull().references(() => evaluations.id, { onDelete: "cascade" }),
  criterionScoreId: uuid("criterion_score_id").references(() => criterionScores.id, { onDelete: "cascade" }),
  segmentId: uuid("segment_id").references(() => transcriptSegments.id),
  kind: evidenceKind("kind").notNull().default("criterion"),
  quote: text("quote").notNull(),
  startMs: integer("start_ms"),
  endMs: integer("end_ms"),
  validated: boolean("validated").notNull().default(false),
  validationNote: text("validation_note"),
  flaggedFalsePositive: boolean("flagged_false_positive").notNull().default(false),
});

export type FeedbackItem = { text: string; evidenceIds?: string[] };

export const feedbackReports = pgTable("feedback_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: orgId(),
  evaluationId: uuid("evaluation_id")
    .notNull()
    .unique()
    .references(() => evaluations.id, { onDelete: "cascade" }),
  summary: text("summary").notNull(),
  objective: text("objective"),
  strengths: jsonb("strengths").$type<FeedbackItem[]>().notNull().default([]),
  improvements: jsonb("improvements").$type<FeedbackItem[]>().notNull().default([]),
  objections: jsonb("objections").$type<{ objection: string; handling: string; evidenceIds?: string[] }[]>().notNull().default([]),
  investigationQuality: text("investigation_quality"),
  nextSteps: jsonb("next_steps").$type<FeedbackItem[]>().notNull().default([]),
  /** Perguntas HIPOTÉTICAS — nunca exibidas como fala real. */
  suggestedQuestions: jsonb("suggested_questions").$type<string[]>().notNull().default([]),
  coachingRecommendations: jsonb("coaching_recommendations").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
});

export const coachingActions = pgTable("coaching_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: orgId(),
  userId: text("user_id").notNull().references(() => user.id),
  evaluationId: uuid("evaluation_id").references(() => evaluations.id, { onDelete: "set null" }),
  criterionKey: text("criterion_key"),
  title: text("title").notNull(),
  description: text("description"),
  status: coachingStatus("status").notNull().default("open"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  createdBy: text("created_by").references(() => user.id),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Revisão humana e calibração                                         */
/* ------------------------------------------------------------------ */
export const reviewOverrides = pgTable("review_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: orgId(),
  evaluationId: uuid("evaluation_id").notNull().references(() => evaluations.id, { onDelete: "cascade" }),
  criterionScoreId: uuid("criterion_score_id").references(() => criterionScores.id, { onDelete: "cascade" }),
  evidenceId: uuid("evidence_id").references(() => evidenceReferences.id, { onDelete: "cascade" }),
  action: overrideAction("action").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  reason: text("reason"),
  actorUserId: text("actor_user_id").notNull().references(() => user.id),
  createdAt: createdAt(),
});

export const reviewComments = pgTable("review_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: orgId(),
  evaluationId: uuid("evaluation_id").notNull().references(() => evaluations.id, { onDelete: "cascade" }),
  criterionScoreId: uuid("criterion_score_id").references(() => criterionScores.id, { onDelete: "cascade" }),
  authorUserId: text("author_user_id").notNull().references(() => user.id),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

/** Avaliação humana de referência feita pelo cliente — base da calibração por empresa. */
export const calibrationReferences = pgTable("calibration_references", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: orgId(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  rubricVersionId: uuid("rubric_version_id").notNull().references(() => rubricVersions.id),
  reviewerUserId: text("reviewer_user_id").notNull().references(() => user.id),
  scores: jsonb("scores").$type<Record<string, { status: "scored" | "not_applicable" | "not_evaluable"; score?: number }>>().notNull(),
  notes: text("notes"),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Integrações, uso/custos e auditoria                                 */
/* ------------------------------------------------------------------ */
export const integrations = pgTable("integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: orgId(),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("disabled"),
  /** Configuração NÃO secreta. Segredos ficam fora do banco (cofre/variáveis). */
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    conversationId: uuid("conversation_id"),
    evaluationId: uuid("evaluation_id"),
    stage: usageStage("stage").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    audioSeconds: integer("audio_seconds").notNull().default(0),
    /** Custo estimado em micro-dólares (1 USD = 1_000_000). */
    costUsdMicros: bigint("cost_usd_micros", { mode: "number" }).notNull().default(0),
    latencyMs: integer("latency_ms"),
    success: boolean("success").notNull(),
    errorCode: text("error_code"),
    idempotencyKey: text("idempotency_key").unique(),
    createdAt: createdAt(),
  },
  (t) => [index("usage_org_created_idx").on(t.organizationId, t.createdAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    actorUserId: text("actor_user_id"),
    actorType: actorType("actor_type").notNull().default("user"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index("audit_org_created_idx").on(t.organizationId, t.createdAt)],
);
