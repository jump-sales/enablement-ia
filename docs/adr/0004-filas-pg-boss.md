# ADR 0004 — Filas com pg-boss (sobre o Postgres)

- **Status:** aceito (implementação na Etapa C)
- **Data:** 2026-11-06

## Decisão
Usar **pg-boss**: filas no próprio Postgres, sem Redis. Permite enfileirar na mesma transação que cria o registro, `singletonKey` contra jobs duplicados, retentativas com backoff e agendamento (job de retenção).

## Consequências
- (+) Menos infraestrutura na VPS.
- (−) Em volumes muito altos, migrar para SQS/BullMQ; os handlers ficam isolados atrás de uma interface simples.
