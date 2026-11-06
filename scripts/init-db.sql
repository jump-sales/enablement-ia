-- Executar UMA vez como superusuário (ex.: psql -U postgres -f scripts/init-db.sql)
-- Variáveis: :owner_pw, :app_pw, :dbname
CREATE ROLE jump_owner LOGIN PASSWORD :'owner_pw';
-- Papel de runtime: sem BYPASSRLS, sem ser dono das tabelas => RLS sempre aplicado.
CREATE ROLE jump_app LOGIN PASSWORD :'app_pw' NOBYPASSRLS;
CREATE DATABASE :"dbname" OWNER jump_owner;
\connect :"dbname"
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO jump_app;
ALTER SCHEMA public OWNER TO jump_owner;
