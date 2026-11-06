-- Filas (pg-boss) em schema próprio. Os jobs carregam apenas IDs (sem conteúdo de conversas).
-- O papel da aplicação cria e gerencia as tabelas da fila somente aqui.
CREATE SCHEMA IF NOT EXISTS pgboss;
--> statement-breakpoint
GRANT USAGE, CREATE ON SCHEMA pgboss TO jump_app;
