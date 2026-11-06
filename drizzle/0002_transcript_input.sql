CREATE TYPE "public"."conversation_source" AS ENUM('transcript_upload', 'media_upload', 'google_drive');--> statement-breakpoint
CREATE TYPE "public"."timestamp_precision" AS ENUM('exact', 'approximate', 'none');--> statement-breakpoint
ALTER TYPE "public"."conversation_status" ADD VALUE 'needs_speaker_review' BEFORE 'evaluating';--> statement-breakpoint
ALTER TYPE "public"."media_kind" ADD VALUE 'transcript';--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "source" "conversation_source" DEFAULT 'transcript_upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "rubric_id" uuid;--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "timestamp_precision" timestamp_precision DEFAULT 'exact' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_rubric_id_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubrics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_org_external_idx" ON "conversations" USING btree ("organization_id","external_ref");