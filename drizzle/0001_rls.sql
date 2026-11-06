-- =====================================================================
-- Isolamento multi-tenant com Row-Level Security
--
-- A aplicação conecta como `jump_app` (sem BYPASSRLS, não é dona das tabelas).
-- Cada transação define, via set_config(..., true):
--   app.org_id  -> organização ativa
--   app.user_id -> usuário autenticado
--   app.role    -> papel na organização (org_admin | manager | rep)
-- Sem essas variáveis, nenhuma linha de tenant é visível.
-- =====================================================================

CREATE OR REPLACE FUNCTION app_org() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_user() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_role() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.role', true), '') $$;
--> statement-breakpoint
-- Gestores e administradores enxergam toda a organização; vendedores só o próprio.
CREATE OR REPLACE FUNCTION app_sees_all() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT app_role() IN ('org_admin', 'manager') $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Permissões base do papel de runtime
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO jump_app;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON subscription_plans FROM jump_app;
--> statement-breakpoint
-- Auditoria é append-only para a aplicação.
REVOKE UPDATE, DELETE ON audit_logs FROM jump_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_org(), app_user(), app_role(), app_sees_all() TO jump_app;
--> statement-breakpoint
-- Tabelas futuras criadas pelo dono recebem as mesmas permissões
-- (o teste "toda tabela com organization_id tem RLS" protege contra esquecimentos).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO jump_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Organizações e membros
-- ---------------------------------------------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_select ON organizations FOR SELECT USING (
  id = app_org()
  OR id IN (SELECT m.organization_id FROM memberships m WHERE m.user_id = app_user() AND m.status = 'active')
);
--> statement-breakpoint
CREATE POLICY org_insert ON organizations FOR INSERT WITH CHECK (id = app_org());
--> statement-breakpoint
CREATE POLICY org_update ON organizations FOR UPDATE USING (id = app_org()) WITH CHECK (id = app_org());
--> statement-breakpoint

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- O usuário enxerga as próprias associações (para escolher a organização) e,
-- dentro da organização ativa, todas as associações.
CREATE POLICY memberships_select ON memberships FOR SELECT USING (
  organization_id = app_org() OR user_id = app_user()
);
--> statement-breakpoint
CREATE POLICY memberships_write ON memberships FOR ALL
  USING (organization_id = app_org()) WITH CHECK (organization_id = app_org());
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Tabelas de tenant "simples": visíveis a qualquer membro da organização
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'teams', 'invitations', 'org_entitlements', 'credit_ledger', 'org_limits',
    'methodologies', 'rubrics', 'rubric_versions', 'criteria',
    'integrations', 'usage_events', 'audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (organization_id = app_org()) WITH CHECK (organization_id = app_org())',
      t
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Conversas: tenant + visibilidade individual
-- ---------------------------------------------------------------------
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY conversations_access ON conversations FOR ALL
  USING (organization_id = app_org() AND (app_sees_all() OR owner_user_id = app_user()))
  WITH CHECK (organization_id = app_org() AND (app_sees_all() OR owner_user_id = app_user()));
--> statement-breakpoint

-- Tabelas filhas de conversa herdam a visibilidade da conversa
-- (a subconsulta em `conversations` também passa pelo RLS).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'media_assets', 'participants', 'transcripts', 'evaluations', 'consent_records', 'calibration_references'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY via_conversation ON %I FOR ALL
         USING (organization_id = app_org() AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id))
         WITH CHECK (organization_id = app_org() AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id))',
      t
    );
  END LOOP;
END $$;
--> statement-breakpoint

ALTER TABLE transcript_segments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY via_transcript ON transcript_segments FOR ALL
  USING (organization_id = app_org() AND EXISTS (SELECT 1 FROM transcripts tr WHERE tr.id = transcript_id))
  WITH CHECK (organization_id = app_org() AND EXISTS (SELECT 1 FROM transcripts tr WHERE tr.id = transcript_id));
--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'criterion_scores', 'evidence_references', 'feedback_reports', 'review_overrides', 'review_comments'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY via_evaluation ON %I FOR ALL
         USING (organization_id = app_org() AND EXISTS (SELECT 1 FROM evaluations e WHERE e.id = evaluation_id))
         WITH CHECK (organization_id = app_org() AND EXISTS (SELECT 1 FROM evaluations e WHERE e.id = evaluation_id))',
      t
    );
  END LOOP;
END $$;
--> statement-breakpoint

ALTER TABLE coaching_actions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY coaching_access ON coaching_actions FOR ALL
  USING (organization_id = app_org() AND (app_sees_all() OR user_id = app_user()))
  WITH CHECK (organization_id = app_org() AND app_sees_all());
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Funções privilegiadas e estreitas (SECURITY DEFINER, dono = jump_owner)
-- ---------------------------------------------------------------------
-- Aceite de convite: o usuário convidado ainda não é membro, então precisa
-- localizar o convite pelo hash do token sem ver outras organizações.
CREATE OR REPLACE FUNCTION app_find_invitation(p_token_hash text)
RETURNS TABLE (id uuid, organization_id uuid, email text, role member_role, job_title job_title,
               team_id uuid, expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz,
               organization_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.organization_id, i.email, i.role, i.job_title, i.team_id, i.expires_at,
         i.accepted_at, i.revoked_at, o.name
  FROM invitations i JOIN organizations o ON o.id = i.organization_id
  WHERE i.token_hash = p_token_hash
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_find_invitation(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_find_invitation(text) TO jump_app;
--> statement-breakpoint

-- Disponibilidade de slug no cadastro (não revela nada além de true/false).
CREATE OR REPLACE FUNCTION app_slug_taken(p_slug text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM organizations WHERE slug = p_slug)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_slug_taken(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_slug_taken(text) TO jump_app;
--> statement-breakpoint

-- Planos padrão (catálogo global, somente leitura para a aplicação)
INSERT INTO subscription_plans (code, name, kind, evaluation_credits, features) VALUES
  ('avaliador', 'Avaliador de Ligações (venda única)', 'evaluator_one_time', 50,
   '["evaluation","feedback","review","custom_rubric"]'::jsonb),
  ('treinamento', 'Treinamento Contínuo (recorrente)', 'training_recurring', 200,
   '["evaluation","feedback","review","custom_rubric","evolution_dashboard","coaching_plans","calibration","team_comparison"]'::jsonb)
ON CONFLICT (code) DO NOTHING;
