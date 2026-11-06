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

## Etapa C — Pipeline de análise 🔜

1. 🔜 Worker pg-boss (filas, `singletonKey`, retentativas com backoff, estados)
2. 🔜 Upload em streaming (até ~2 GB) com validação ffprobe (10 s a 2 h), hash e deduplicação
3. 🔜 Extração de áudio (ffmpeg → mono 16 kHz)
4. 🔜 Interface `TranscriptionProvider`: simulado + 1 provedor real (escolher entre AssemblyAI e Deepgram por qualidade de diarização em pt-BR; requer chave de API)
5. 🔜 Redação de PII
6. 🔜 Mapeamento de falantes + correção manual
7. 🔜 Interface `LLMProvider`: simulado + Claude (structured outputs)
8. 🔜 Avaliação em chamada única + validação de evidências + scoring determinístico
9. 🔜 Relatório de feedback; tela da conversa com player e transcrição sincronizada
10. 🔜 `usage_events` com custo por etapa
11. 🔜 Dados sintéticos: 10 a 15 transcrições de vendas fictícias (SDR e Closer, boas e ruins) + suíte de prompt injection
12. 🔜 Exclusão de conversa e job de retenção

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
| 2 | Provedor de transcrição | Testar AssemblyAI e Deepgram com 3 gravações reais autorizadas; escolher por diarização em pt-BR | Etapa C (item 4) |
| 3 | Chaves de API (STT e Anthropic) | Contas da Jump, com limite de gasto configurado | Testes com provedores reais |
| 4 | Créditos por pacote (Avaliador: 50; Treinamento: 200/mês) e preço | Validar com o comercial | Configuração dos planos |
| 5 | Modelo de avaliação padrão (Opus 5.5 vs. Sonnet 5.5) | Medir os dois no conjunto sintético e escolher pela concordância/custo | Etapa E |
| 6 | Bases legais e textos de transparência | Validação jurídica | Operação real |
