# ADR 0006 — Hospedagem em VPS com Docker Compose

- **Status:** aceito
- **Data:** 2026-11-06

## Contexto
Preferência do negócio por Hostinger ou similar.

## Decisão
VPS (Hostinger KVM ou equivalente) com Docker Compose: Postgres, web, migrate, worker (Etapa C) e Caddy (HTTPS automático). A mídia fica em disco local no início e em Cloudflare R2 (S3-compatível) ao crescer.

## Consequências
- (+) Custo baixo e previsível; deploy simples (`docker compose up -d --build`).
- (−) Backup, atualização de SO e monitoramento ficam sob nossa responsabilidade (ver DEPLOY.md).
- Caminho de evolução: Postgres gerenciado e mais workers, sem mudança de código.
