#!/bin/bash
# Executado só na primeira inicialização do volume do Postgres.
set -euo pipefail
psql -v ON_ERROR_STOP=1 -U postgres <<SQL
CREATE ROLE jump_owner LOGIN PASSWORD '${JUMP_OWNER_PASSWORD}';
CREATE ROLE jump_app LOGIN PASSWORD '${JUMP_APP_PASSWORD}' NOBYPASSRLS;
CREATE DATABASE jump OWNER jump_owner;
\connect jump
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO jump_owner;
GRANT USAGE ON SCHEMA public TO jump_app;
SQL
