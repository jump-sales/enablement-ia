# ADR 0001 — Monólito modular: Next.js + worker Node

- **Status:** aceito
- **Data:** 2026-11-06

## Contexto
O MVP precisa de UI, API, processamento pesado (ffmpeg, chamadas de IA de minutos) e deve rodar em uma VPS simples (Hostinger), mantido por uma equipe pequena.

## Decisão
Um único repositório e pacote TypeScript. O Next.js (App Router) serve a UI e a API REST `/api/v1`. Um processo worker separado (mesmo código de domínio) executa os jobs. Sem microsserviços.

## Consequências
- (+) Um deploy, um conjunto de tipos, regras de domínio compartilhadas.
- (+) O worker escala independentemente (mais contêineres).
- (−) Se a API pública crescer muito, pode valer extraí-la depois; a camada de serviços já é independente do Next.
