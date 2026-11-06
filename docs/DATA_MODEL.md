# Modelo de dados

Fonte da verdade: [`src/db/schema.ts`](../src/db/schema.ts). Políticas de isolamento: [`drizzle/0001_rls.sql`](../drizzle/0001_rls.sql).

## Convenções

- IDs `uuid` (tabelas de domínio) e `text` (tabelas do Better Auth).
- Toda tabela de cliente tem `organization_id` + política RLS.
- Exclusão lógica (`deleted_at`) nas entidades com dado pessoal; a exclusão física é feita pelo job de retenção.
- Datas em `timestamptz`; custos em micro-USD (`bigint`).

## Entidades

### Identidade e acesso
| Tabela | Função | Isolamento |
|---|---|---|
| `user`, `session`, `account`, `verification` | Identidade (Better Auth). Um usuário pode pertencer a várias empresas | Global; acesso só pela camada de auth |
| `organizations` | Empresa (tenant), configurações de retenção, PII e aprovação | Visível para os próprios membros |
| `memberships` | Vínculo usuário↔empresa: papel (`org_admin`, `manager`, `rep`), função (`sdr`, `closer`…), time, situação | Tenant; o usuário vê os próprios vínculos |
| `teams` | Times comerciais | Tenant |
| `invitations` | Convites; só o **hash** do token é guardado; expiram em 7 dias | Tenant; aceite via função `app_find_invitation` |

### Comercial
| Tabela | Função |
|---|---|
| `subscription_plans` | Catálogo global: `avaliador` (venda única) e `treinamento` (recorrente). Somente leitura para a aplicação |
| `org_entitlements` | Planos contratados pela empresa (vigência) |
| `credit_ledger` | Razão de créditos (concessão/consumo/estorno). Saldo = soma. Consumo idempotente por avaliação |
| `org_limits` | Teto de custo mensal, minutos de áudio, tamanho/duração máximos, concorrência |

### Conversas e transcrição
| Tabela | Função | Isolamento |
|---|---|---|
| `conversations` | Gravação avaliada: dono (vendedor), tipo, status do pipeline, base legal, retenção | Tenant **+ dono** (vendedor só vê as próprias) |
| `consent_records` | Base legal e declaração de ciência por conversa | Herda da conversa |
| `media_assets` | Arquivo original e áudio extraído: chave no storage, hash, duração, metadados ffprobe | Herda da conversa |
| `participants` | Falantes (rótulo do diarizador → vendedor/cliente), atribuição automática ou manual | Herda da conversa |
| `transcripts` | Versão da transcrição, provedor, idioma, qualidade, tentativas | Herda da conversa |
| `transcript_segments` | Trechos com início/fim (ms), falante, texto, **texto redigido** e confiança | Herda da transcrição |

### Metodologia e avaliação
| Tabela | Função |
|---|---|
| `methodologies` | Metodologia da empresa (criada a partir de template: SPIN, Challenger, Consultiva, SDR Qualification, Closer Discovery ou personalizada) |
| `rubrics` | Scorecard aplicável a SDR, Closer ou ambos; aponta para a versão vigente |
| `rubric_versions` | Versão **imutável depois de publicada**: escala, limiares de classificação, cobertura mínima, orientações ao avaliador, hash do conteúdo |
| `criteria` | Critério: competência, descrição, **âncoras comportamentais por nível** (calibradas pelo cliente), peso, obrigatório, regra de aplicabilidade |
| `evaluations` | Avaliação: versão da rubrica, versão do prompt, modelo, nota geral, classificação, cobertura, status de revisão, cadeia de reprocessamento (`supersedes_id`) |
| `criterion_scores` | Por critério: `scored`/`not_applicable`/`not_evaluable`, nota final **e** nota original da IA, justificativa, confiança |
| `evidence_references` | Citação literal + segmento + timestamps; `validated` indica se foi conferida contra a transcrição; marcação de falso positivo |
| `feedback_reports` | Resumo, objetivo, pontos fortes, melhorias, objeções, próximos passos, **perguntas sugeridas (hipotéticas)**, recomendações |
| `coaching_actions` | Plano de desenvolvimento por vendedor/critério | Tenant + dono |

Todas as tabelas de avaliação herdam a visibilidade da conversa via `evaluations`.

### Revisão e calibração
| Tabela | Função |
|---|---|
| `review_overrides` | Histórico imutável de ajustes humanos (antes/depois, motivo, autor): nota, status, evidência, falso positivo, contestação, aprovação, reprocessamento, correção de falante |
| `review_comments` | Comentários do gestor por avaliação/critério |
| `calibration_references` | Avaliação humana de referência do cliente para uma conversa e versão de rubrica. Base para medir a concordância IA × gestor por empresa |

### Operação
| Tabela | Função |
|---|---|
| `integrations` | Integrações futuras (config não secreta) |
| `usage_events` | Uso e custo por etapa/provedor/modelo, com idempotência |
| `audit_logs` | Trilha de auditoria append-only (a aplicação não pode alterar nem apagar) |

## Relacionamentos principais

```
organizations ─┬─ memberships ── user
               ├─ teams
               ├─ methodologies ── rubrics ── rubric_versions ── criteria
               └─ conversations ─┬─ media_assets
                                 ├─ participants
                                 ├─ transcripts ── transcript_segments
                                 └─ evaluations ─┬─ criterion_scores ── evidence_references
                                                 ├─ feedback_reports
                                                 ├─ review_overrides / review_comments
                                                 └─ (rubric_version, transcript)
```

## Funções de banco (SECURITY DEFINER, mínimas)

| Função | Por que existe |
|---|---|
| `app_find_invitation(token_hash)` | O convidado ainda não é membro; localiza só o convite exato |
| `app_slug_taken(slug)` | Cadastro: informa apenas se o identificador está em uso |
