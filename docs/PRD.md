# PRD — JUMP Sales Enablement AI (MVP)

## 1. Problema

Empresas não revisam sistematicamente as conversas comerciais. O Call Review manual é caro, inconsistente entre avaliadores e não escala. Sem isso, gestores não conseguem identificar falhas de abordagem, padronizar metodologia nem dar feedback individual recorrente.

## 2. Objetivo

Transformar o Call Review em um processo **contínuo, acessível e configurável por empresa**, reduzindo o esforço humano de revisão **sem eliminar** a supervisão e a calibração pelo gestor.

## 3. Produtos e modelo comercial

| | Avaliador | Treinamento |
|---|---|---|
| Venda | Única | Recorrente (mensal) |
| Créditos | Pacote inicial (padrão: 50) | Mensais (padrão: 200) |
| Avaliação + feedback + revisão humana | ✔ | ✔ |
| Rubrica personalizada da empresa | ✔ | ✔ |
| Evolução mês a mês (individual e por time) | — | ✔ |
| Planos de coaching | — | ✔ |
| Calibração com avaliações de referência | — | ✔ |

1 crédito = 1 conversa avaliada pelo motor de IA. Conversas abaixo da duração mínima configurada são só transcritas e não consomem crédito. No MVP, a liberação de planos e créditos é manual (`npm run plan:grant`); integração com gateway de pagamento está no backlog.

## 4. Perfis e visibilidade

| Perfil | Pode |
|---|---|
| **Administrador da plataforma** (Jump) | Liberar planos/créditos, suporte autorizado (auditado) |
| **Administrador da empresa** | Configurar empresa, metodologia, usuários, retenção, limites |
| **Gestor** | Ver **todos** os vendedores, revisar e aprovar avaliações, calibrar, atribuir coaching |
| **Vendedor (SDR/Closer)** | Ver **apenas o próprio** desempenho e compará-lo com os meses anteriores |

A regra "vendedor só vê o próprio" é aplicada no banco de dados (RLS), não apenas na interface.

## 5. Escopo do MVP

### Dentro
1. **Autenticação e organizações:** login, cadastro de empresa, convites, papéis, isolamento por empresa, auditoria e limites de consumo. *(Etapa B: concluída)*
2. **Upload** de áudio/vídeo com validação de formato, duração (10 s a 2 h), tamanho e integridade. Extração de áudio de vídeos. *(C)*
3. **Transcrição** com idioma, timestamps, separação de falantes quando disponível, correção manual de falantes, estados, retentativas e indicadores de qualidade. *(C)*
4. **Motor de avaliação** por rubrica da empresa, com templates editáveis: SPIN, Challenger, Consultiva, Qualificação SDR e Discovery Closer. *(C)*
5. **Scorecard configurável e versionado:** competências, critérios, descrições comportamentais, pesos, escala, aplicabilidade, critérios obrigatórios, limiares e orientações ao avaliador. *(D)*
6. **Feedback estruturado** *(C: concluído)*: resumo, objetivo, pontos fortes, melhorias, evidências com timestamp, objeções e tratamentos, qualidade da investigação, próximos passos, perguntas sugeridas (sinalizadas como hipotéticas), recomendações e notas. *(C)*
7. **Dashboard:** conversas avaliadas, média por competência, evolução temporal, comparação individual e de time (sem ranking punitivo), melhorias recorrentes, pendências, custo por análise e consumo mensal. *(D)*
8. **Revisão humana:** ajustar notas, contestar critérios, corrigir evidências, comentar, aprovar, marcar falsos positivos e reprocessar, com histórico preservado. *(D)*
9. **Calibração por empresa:** o gestor avalia conversas de referência; o sistema mede a concordância da IA com ele. *(D)*

### Fora do MVP
- Upload de áudio/vídeo com transcrição própria (backlog; só para clientes sem transcrição da plataforma).
- Captura ao vivo e coaching em tempo real (Fase 2: só a arquitetura e um simulador).
- Integrações com Zoom/Meet/Teams/telefonia/CRM.
- Gateway de pagamento, SSO/SAML.
- Qualquer análise visual, facial, de emoção por aparência ou biométrica.
- Interface em outros idiomas (a estrutura fica preparada para i18n).

## 6. Requisitos de qualidade da IA

- Toda nota tem evidência textual (citação literal), timestamp válido, critério relacionado, justificativa e grau de confiança.
- Critério sem evidência fica como **"não avaliável"**, nunca como zero automático.
- Nota geral = média ponderada **apenas** dos critérios aplicáveis e avaliáveis.
- Abaixo da cobertura mínima configurada, o resultado é **"inconclusivo"**.
- Perguntas sugeridas são exibidas como hipotéticas, separadas das falas reais.
- Prompts e rubricas são versionados; cada avaliação registra versão da rubrica, versão do prompt e modelo.
- Métricas acompanhadas: concordância com o avaliador humano da empresa, taxa de falsos positivos e estabilidade entre execuções.

## 7. Critérios de aceite do MVP

| # | Critério | Situação |
|---|---|---|
| 1 | Usuário de uma empresa não acessa dados de outra (API, storage, banco com RLS) | ✅ testado |
| 2 | Permissões dos 3 papéis aplicadas em serviços e rotas | ✅ testado |
| 3 | Vendedor vê só as próprias conversas; gestor vê todas | ✅ testado (RLS) |
| 4 | Convite: uso único, expira, restrito ao e-mail convidado | ✅ testado |
| 5 | Auditoria append-only | ✅ testado |
| 6 | Débito de crédito idempotente; bloqueio ao atingir o teto de custo | ✅ testado |
| 7 | 100% das evidências exibidas apontam para um segmento existente, com citação verificada e timestamp válido | ✅ testado |
| 8 | Nota geral confere com o cálculo determinístico; "não avaliável" não vira zero | ✅ testado |
| 9 | Mudar a rubrica não altera avaliações antigas | Etapa D |
| 10 | Job duplicado não gera avaliação duplicada; falhas são retentadas com backoff | ✅ testado |
| 11 | Nenhum caso da suíte de prompt injection altera a nota | ✅ testado com o motor simulado (defesas de prompt e de validação); falta repetir com o modelo real |
| 12 | Excluir uma conversa remove mídia, transcrição e avaliação, e fica registrado | ✅ testado |
| 13 | Concordância IA × gestor dentro de ±1 ponto em ≥ X% dos critérios (X a definir com o piloto) | Etapa E |

## 8. Perguntas em aberto

Ver [BACKLOG.md § Decisões pendentes](BACKLOG.md#decisões-pendentes).
