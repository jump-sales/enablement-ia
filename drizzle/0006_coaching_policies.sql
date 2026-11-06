-- Coaching: gestor cria/remove; vendedor vê e atualiza o andamento das próprias ações.
DROP POLICY IF EXISTS coaching_access ON coaching_actions;
--> statement-breakpoint
CREATE POLICY coaching_select ON coaching_actions FOR SELECT
  USING (organization_id = app_org() AND (app_sees_all() OR user_id = app_user()));
--> statement-breakpoint
CREATE POLICY coaching_insert ON coaching_actions FOR INSERT
  WITH CHECK (organization_id = app_org() AND app_sees_all());
--> statement-breakpoint
CREATE POLICY coaching_update ON coaching_actions FOR UPDATE
  USING (organization_id = app_org() AND (app_sees_all() OR user_id = app_user()))
  WITH CHECK (organization_id = app_org() AND (app_sees_all() OR user_id = app_user()));
--> statement-breakpoint
CREATE POLICY coaching_delete ON coaching_actions FOR DELETE
  USING (organization_id = app_org() AND app_sees_all());
