# JUMP Sales Enablement AI

Plataforma SaaS B2B multiempresa que avalia ligações e videochamadas comerciais a partir de gravações, gera feedback fundamentado em evidências e acompanha a evolução de SDRs e Closers ao longo do tempo.

> **Status:** Etapas B (Fundação), C (Pipeline de análise) e D (Gestão: revisão, versões, calibração, painéis, coaching) concluídas e testadas. A avaliação usa um **motor simulado** até a chave de IA ser configurada (`LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`). Veja [docs/BACKLOG.md](docs/BACKLOG.md).

Fluxo: o vendedor ou o gestor envia a **transcrição** que o Meet, o Zoom ou o Teams já geram → o sistema identifica quem é o vendedor → avalia pela metodologia da empresa → mostra a nota, as evidências com horário e o feedback.

## Produtos

| Produto | Modelo comercial | O que libera |
|---|---|---|
| **Avaliador** | Venda única | Motor de avaliação configurado para a empresa + pacote de créditos (1 crédito = 1 conversa avaliada) |
| **Treinamento** | Recorrente (mensal) | Créditos mensais + evolução mês a mês, planos de coaching, calibração e comparação de times |

## Stack

- **Next.js 16 + TypeScript** (UI e API REST `/api/v1`), **Tailwind CSS 4**
- **PostgreSQL 16** com **Row-Level Security** para isolamento entre empresas
- **Drizzle ORM** · **Better Auth** (e-mail e senha, self-hosted) · **pg-boss** (filas)
- Storage de mídia: disco local (VPS) ou S3-compatível (Cloudflare R2/MinIO)
- IA atrás de interfaces substituíveis (transcrição e LLM); provedores simulados para desenvolvimento

Justificativas em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) e [docs/adr/](docs/adr/).

## Rodando localmente

Pré-requisitos: Node 22+ e PostgreSQL 16.

```bash
npm install
cp .env.example .env            # preencha as senhas e gere BETTER_AUTH_SECRET
```

Criar papéis e banco (uma vez, como superusuário do Postgres):

```bash
psql -U postgres -v owner_pw=SENHA_DONO -v app_pw=SENHA_APP -v dbname=jump -f scripts/init-db.sql
```

```bash
npm run db:migrate              # aplica schema + políticas RLS
npm run dev                     # http://localhost:3000
```

Em outro terminal, o worker que processa as avaliações:

```bash
npm run worker
```

Acesse `/cadastro` para criar a primeira empresa. Para liberar plano e créditos (operação Jump, sem gateway de pagamento no MVP):

```bash
npm run plan:grant -- --org <identificador-da-empresa> --plan avaliador
```

```bash
npm run plan:grant -- --org <identificador-da-empresa> --plan treinamento --months 1
```

## Testes

Os testes usam um banco separado (`jump_test`), recriado do zero a cada execução, apenas com dados sintéticos.

```bash
psql -U postgres -v owner_pw=SENHA_DONO -v app_pw=SENHA_APP -v dbname=jump_test -f scripts/init-db.sql
```

```bash
npm test
```

Variáveis opcionais: `TEST_DATABASE_OWNER_URL`, `TEST_DATABASE_URL`.

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/PRD.md](docs/PRD.md) | Requisitos de produto, perfis, escopo do MVP, critérios de aceite |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitetura, pipeline de IA, custos, Fase 2 (tempo real) |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Entidades, relacionamentos e regras de isolamento |
| [docs/API.md](docs/API.md) | Contratos da API v1 |
| [docs/SECURITY_LGPD.md](docs/SECURITY_LGPD.md) | Segurança, privacidade e pontos para validação jurídica |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Plano de deploy em VPS (Hostinger ou similar) |
| [docs/INTEGRACAO_GOOGLE_DRIVE.md](docs/INTEGRACAO_GOOGLE_DRIVE.md) | Plano de importação do Google Drive |
| [docs/BACKLOG.md](docs/BACKLOG.md) | Backlog priorizado e estado de cada etapa |
| [docs/adr/](docs/adr/) | Registro de decisões arquiteturais |

## Estrutura

```
src/app/            páginas (pt-BR) e rotas /api/v1
src/db/schema.ts    modelo de dados completo
drizzle/            migrations (0001_rls.sql = políticas de isolamento)
src/server/         domínio: tenancy, permissões, auditoria, storage, serviços
scripts/            migrations, init do banco, operação de planos
tests/              testes de integração com Postgres real
deploy/             Docker Compose + Caddy para VPS
```

Nenhuma credencial é versionada. Use `.env` (local) e `deploy/.env` (servidor).
