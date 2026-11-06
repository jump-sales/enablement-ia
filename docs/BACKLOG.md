# Backlog priorizado

Legenda: ✅ feito e testado · 🔜 próxima · ⏳ planejado

## Etapa B — Fundação ✅

- ✅ Modelo de dados completo (todas as entidades do brief) + migrations
- ✅ RLS em todas as tabelas de tenant, com visibilidade individual de vendedores
- ✅ Autenticação e-mail/senha (Better Auth), sessão segura, limite de tentativas
- ✅ Cadastro de empresa, convites (hash, uso único, expiração, preso ao e-mail), papéis e times
- ✅ Matriz de permissões aplicada nos serviços
- ✅ Auditoria append-only
- ✅ Storage com isolamento por tenant (local e S3), URLs temporárias assinadas
- ✅ Planos (Avaliador/Treinamento), razão de créditos idempotente, limites de consumo
- ✅ Interface: entrar, cadastro, convite, painel, equipe, empresa e consumo (responsiva)
- ✅ Script de operador para liberar planos e créditos (auditado)
- ✅ Dockerfile, Compose e Caddy para VPS (não executados: sem Docker no ambiente de dev)
- ✅ 32 testes de integração com Postgres real + fluxo ponta a ponta no navegador

## Etapa C — Pipeline de análise ✅ (com motor simulado)

Mudança de rumo: entrada pela **transcrição pronta** do Meet/Zoom/Teams ([ADR 0007](adr/0007-entrada-por-transcricao.md)).

- ✅ Leitura de .vtt (Zoom/Teams), .srt, documento do Meet (.txt/.docx) e texto simples; horários estimados sinalizados
- ✅ Validação: formato, tamanho (5 MB), duração (10 s a 2 h), duplicidade por hash
- ✅ Identificação do vendedor pelo nome; sugestão + confirmação quando não reconhece
- ✅ Redação de PII (e-mail, CPF/CNPJ válidos, telefone, cartão) antes do modelo; original preservado para o gestor
- ✅ Templates: Qualificação SDR, Discovery Closer, SPIN, Challenger, Consultiva (versão 1 publicada e imutável)
- ✅ Motor de avaliação em chamada única (Claude, saída estruturada, fallback em recusa, cache do bloco fixo) + motor simulado
- ✅ Validação de evidências contra a transcrição; nota calculada em código; "não avaliável" não vira zero; cobertura mínima
- ✅ Fila pg-boss + worker: idempotência, retentativa com backoff, estorno do crédito em falha definitiva, varredura de pendentes
- ✅ Custo por chamada em `usage_events`
- ✅ Telas: lista de conversas, envio, detalhe com scorecard, evidências clicáveis, feedback, perguntas sugeridas separadas, revisão de falantes, reavaliação, exclusão, histórico
- ✅ Transcrições sintéticas (inclui caso de prompt injection e dados pessoais fictícios)
- 🔜 **Configurar a chave da Anthropic** e repetir a suíte com o modelo real (concordância, estabilidade, injection)
- 🔜 Importação do Google Drive, opção A ([INTEGRACAO_GOOGLE_DRIVE.md](INTEGRACAO_GOOGLE_DRIVE.md)): depende do projeto Google Cloud da Jump
- ⏳ Job de retenção automática (apagar após N dias)
- ⏳ Upload de áudio/vídeo + transcrição própria (só para clientes sem transcrição da plataforma)

## Etapa D — Gestão ⏳

- ⏳ Templates editáveis: SPIN, Challenger, Consultiva, SDR Qualification, Closer Discovery
- ⏳ Editor de metodologia (critérios, âncoras, pesos, obrigatórios, aplicabilidade, limiares), versões com publicação imutável
- ⏳ Revisão humana: ajuste, contestação, falso positivo, comentários, aprovação, reprocessamento, histórico
- ⏳ **Calibração por empresa:** gestor avalia conversas de referência → concordância IA × gestor por critério → ajuste das âncoras
- ⏳ Dashboards: evolução mensal individual (vendedor) e por time/pessoa (gestor), melhorias recorrentes, pendências, custo por análise
- ⏳ Planos de coaching (Treinamento)

## Etapa E — Validação ⏳

- ⏳ Rodar a avaliação nas transcrições sintéticas com referências humanas; medir concordância, falsos positivos e estabilidade (3 execuções)
- ⏳ Suíte completa da seção 12 do brief; relatório de resultados
- ⏳ Ambiente de demonstração (VPS de homologação) com empresa e dados fictícios

## Etapa F — Expansão (após aprovação) ⏳

- ⏳ Simulador de streaming a partir de gravações
- ⏳ Detector de eventos + motor de regras + painel de coaching
- ⏳ Avaliação de integrações ao vivo (uma por vez, com consentimento)

## Depois do MVP

- Envio de convites por e-mail (SMTP), recuperação de senha por e-mail
- Gateway de pagamento (venda única + assinatura)
- SSO, 2FA para administradores
- Painel de administração da plataforma (hoje é via script)
- Batch API para avaliações sem urgência
- i18n (es/en)

## Decisões pendentes

| # | Decisão | Recomendação | Bloqueia |
|---|---|---|---|
| 1 | Repositório GitHub para versionar o código | Criar repositório privado e conectar à sessão | Persistência do trabalho |
| 2 | ~~Provedor de transcrição~~ | Resolvido: usar a transcrição do Meet/Zoom/Teams (ADR 0007) | — |
| 3 | Chave da Anthropic (avaliação) | Conta da Jump com limite de gasto mensal configurado no console | Avaliações reais |
| 4 | ~~Créditos por pacote~~ | Aprovado para começar: Avaliador 50; Treinamento 200/mês | — |
| 4b | Projeto Google Cloud para o Drive | Opção A (seletor + `drive.file`) | Importação do Drive |
| 5 | Modelo de avaliação padrão (Opus 5.5 vs. Sonnet 5.5) | Medir os dois no conjunto sintético e escolher pela concordância/custo | Etapa E |
| 6 | Bases legais e textos de transparência | Validação jurídica | Operação real |
