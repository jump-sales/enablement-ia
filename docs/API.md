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

## Implementado (Etapa C)

| Método e rota | Permissão | Corpo → Resposta |
|---|---|---|
| `GET /methodologies` | membro | `{rubrics[] (versão vigente + critérios), templates[]}` |
| `POST /methodologies` | `methodology.manage` | `{template}` → cria metodologia + rubrica v1 publicada |
| `POST /conversations` | `conversation.upload` (outro vendedor: `upload_for_others`) | `multipart/form-data`: `file`, `title`, `type`, `ownerUserId`, `rubricId`, `occurredAt?`, `legalBasis`, `participantsNotified` → `{id, evaluationId, needsReview, warnings[]}`. Erros: `invalid_transcript`, `duplicate`, `too_short`, `too_long`, `no_credits` |
| `GET /conversations` | membro (RLS: vendedor só as próprias) | `{conversations[]}` com nota vigente |
| `GET /conversations/:id` | idem | conversa, segmentos, participantes, avaliação vigente, scorecard, evidências, feedback, histórico |
| `PUT /conversations/:id/speakers` | gestor ou dono | `{roles: [{participantId, role}]}`; dispara a avaliação se estava aguardando |
| `POST /conversations/:id/reprocess` | `evaluation.reprocess` | nova avaliação (a anterior fica no histórico) |
| `DELETE /conversations/:id` | `conversation.delete` | exclusão definitiva (arquivo + transcrição + avaliações), auditada |

## Planejado (Etapa D e integrações)

| Método e rota | Descrição |
|---|---|
| `POST /integrations/google-drive/import` | Importa arquivos escolhidos no seletor do Google Drive |
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
