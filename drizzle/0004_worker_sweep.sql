-- Varredura do worker: reenfileira avaliações que ficaram "na fila" (ex.: queda entre
-- o commit e o envio do job). Retorna apenas identificadores — nenhum conteúdo.
CREATE OR REPLACE FUNCTION app_stale_queued_evaluations(p_older_than interval)
RETURNS TABLE (organization_id uuid, conversation_id uuid, evaluation_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.organization_id, e.conversation_id, e.id
  FROM evaluations e
  WHERE e.status = 'queued' AND e.created_at < now() - p_older_than
  ORDER BY e.created_at
  LIMIT 500
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_stale_queued_evaluations(interval) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_stale_queued_evaluations(interval) TO jump_app;
