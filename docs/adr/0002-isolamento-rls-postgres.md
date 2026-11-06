# ADR 0002 — Isolamento multi-tenant com RLS no PostgreSQL

- **Status:** aceito
- **Data:** 2026-11-06

## Contexto
O isolamento entre empresas é requisito central. Filtrar só na aplicação (`where organization_id = ?`) depende de nunca esquecer o filtro.

## Decisão
- Banco compartilhado e schema compartilhado, com coluna `organization_id` + **Row-Level Security**.
- Dois papéis: `jump_owner` (migrations, dono) e `jump_app` (runtime, sem BYPASSRLS).
- Contexto por transação via `set_config('app.*', ..., true)` em `withTenant`.
- Visibilidade individual (vendedor só vê o próprio) também em RLS.
- Teste automatizado garante RLS em toda tabela com `organization_id`.

## Alternativas descartadas
- Banco por cliente: isolamento máximo, mas operação cara para uma VPS e muitos clientes pequenos.
- Só filtro na aplicação: frágil.

## Consequências
- (+) Um bug de query não vaza dados entre empresas.
- (−) Toda operação de tenant precisa de transação; as subconsultas de visibilidade têm custo (aceitável no volume do MVP; há índices).
