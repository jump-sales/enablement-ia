# API v1 — contratos

Base: `/api/v1`. JSON em UTF-8. Autenticação por cookie de sessão (Better Auth, `/api/auth/*`). A organização ativa vem do cookie `jump_org`, validado contra os vínculos do usuário.

**Mutações** (`POST`/`PATCH`/`DELETE`) exigem cabeçalho `Origin` igual ao host (defesa CSRF).

**Erros** seguem sempre o formato:

```json
{ "error": { "code": "forbidden", "message": "Você não tem permissão para esta ação." } }
```

| HTTP | `code` (exemplos) |
|---|---|
| 400 | `bad_request`, `invalid_json`, `email_mismatch`, `slug_taken` |
| 401 | `unauthenticated` |
| 403 | `forbidden`, `bad_origin`, `no_organization` |
| 404 | `not_found` |
| 409 | `conflict`, `already_member`, `last_admin`, `no_credits`, `cost_cap_reached`, `audio_cap_reached` |
| 410 | `invitation_expired`, `invitation_used`, `invitation_revoked` |
| 422 | `validation_error` (com `details`) |

## Implementado (Etapa B)

| Método e rota | Permissão | Corpo → Resposta |
|---|---|---|
| `POST /api/auth/sign-up/email` | pública | Better Auth `{name,email,password}` |
| `POST /api/auth/sign-in/email` | pública | Better Auth `{email,password}` (limite de 5/min em produção) |
| `POST /api/auth/sign-out` | sessão | — |
| `GET /me` | sessão + org | `{user, organization, role, jobTitle, permissions[], organizations[]}` |
| `POST /organizations` | sessão | `{name, slug}` → `{organization}`; quem cria vira `org_admin` |
| `POST /active-org` | sessão | `{organizationId}`; troca a organização ativa (só entre os vínculos do usuário) |
| `GET /organization` | membro | empresa + configurações + limites |
| `PATCH /organization` | `org.settings.manage` | `{name?, mediaRetentionDays?, dataRetentionDays?, minDurationForEvaluationSec?, redactPii?, requireApprovalBeforeRepVisibility?}` |
| `GET /members` | `members.view` | `{members[]}` |
| `PATCH /members/:id` | `members.manage` | `{role?, jobTitle?, teamId?, status?}`; bloqueia remover o último admin |
| `GET /teams` | membro | `{teams[]}` |
| `POST /teams` | `teams.manage` | `{name}` |
| `GET /invitations` | `members.view` | `{invitations[]}` (sem token) |
| `POST /invitations` | `members.manage` | `{email, role, jobTitle?, teamId?}` → `{invitation, inviteUrl}`. O link aparece **só nesta resposta** |
| `DELETE /invitations/:id` | `members.manage` | revoga |
| `POST /invitations/lookup` | pública | `{token}` → `{organizationName, email, role}` |
| `POST /invitations/accept` | sessão | `{token}`; o e-mail da sessão precisa ser o convidado |
| `GET /media/local?key&exp&sig` | URL assinada | entrega de mídia (driver local), expira em `MEDIA_URL_TTL_SECONDS` |

## Planejado (Etapas C e D)

| Método e rota | Descrição |
|---|---|
| `POST /conversations` | Cria a conversa (`title`, `type`, `ownerUserId`, `occurredAt`, `legalBasis`, `participantsNotified`) e devolve o destino de upload |
| `PUT /conversations/:id/upload` | Upload em streaming (local) ou URL pré-assinada multipart (S3/R2) |
| `POST /conversations/:id/process` | Enfileira o pipeline (idempotente) |
| `GET /conversations?owner&team&status&from&to` | Lista; o RLS restringe o vendedor às próprias |
| `GET /conversations/:id` | Detalhe + status do pipeline + URL temporária do áudio |
| `GET /conversations/:id/transcript` | Segmentos com timestamps e falantes |
| `PATCH /conversations/:id/participants/:pid` | Correção manual de falante (auditada) |
| `DELETE /conversations/:id` | Exclusão (mídia + transcrição + avaliação) |
| `GET /evaluations/:id` | Scorecard, evidências, feedback, histórico de revisão |
| `PATCH /evaluations/:id/criteria/:cid` | Ajuste humano de nota/status, com motivo |
| `POST /evaluations/:id/evidence/:eid/false-positive` | Marca falso positivo |
| `POST /evaluations/:id/comments` | Comentário |
| `POST /evaluations/:id/approve` | Aprovação do gestor |
| `POST /evaluations/:id/reprocess` | Nova avaliação (opcionalmente com outra versão da rubrica); preserva a anterior |
| `GET/POST /methodologies`, `POST /methodologies/from-template` | Metodologias e templates |
| `POST /rubrics/:id/versions`, `POST /rubric-versions/:id/publish` | Rascunho e publicação (imutável) |
| `POST /calibration` | Avaliação humana de referência |
| `GET /calibration/agreement` | Concordância IA × gestor por critério |
| `GET /dashboard/self`, `GET /dashboard/team` | Evolução mensal por competência; comparação individual e de time |
| `GET /usage?month` | Consumo e custo por etapa |
