# ADR 0003 — Better Auth + Drizzle ORM

- **Status:** aceito
- **Data:** 2026-11-06

## Decisão
- **Better Auth** (self-hosted) para identidade: e-mail/senha, sessões, limite de tentativas; sem custo por usuário e com os dados no nosso Postgres. Organizações, papéis e convites ficam no **nosso** domínio (tabelas com RLS), não no plugin de organizações, para manter um único modelo de isolamento.
- **Drizzle ORM**, porque permite transações com `set_config` (necessário para RLS), SQL explícito e migrations em SQL revisáveis.

## Alternativas
- Clerk/Auth0: prontos, mas pagos por usuário e com dados fora do Brasil.
- Prisma: suporte a RLS por transação é mais trabalhoso.

## Consequências
- SSO e 2FA podem ser adicionados por plugins do Better Auth.
