# Segurança, privacidade e LGPD

> **Importante:** as bases legais, os textos de transparência e os contratos citados aqui são **propostas técnicas**. Eles precisam de validação jurídica antes de qualquer operação com dados reais de clientes.

## Papéis no tratamento

- **Empresa cliente:** controladora dos dados das conversas (dos vendedores e dos clientes/prospects dela).
- **Jump Sales:** operadora. Requer contrato de tratamento de dados (DPA) com cada cliente.
- **Provedores de IA (STT, LLM):** suboperadores. Requerem contrato que proíba o uso dos dados para treinamento e, quando possível, retenção zero.

## Controles implementados (Etapa B)

| Controle | Como |
|---|---|
| Isolamento entre empresas | RLS no Postgres com papel sem bypass; testes automatizados |
| Visibilidade individual | Vendedor só vê as próprias conversas (RLS) |
| Controle de acesso por papel | Matriz em `src/server/authz.ts`, aplicada em todo serviço |
| Autenticação | Better Auth: senha com hash forte, sessão em cookie httpOnly, `Secure` em produção, limite de tentativas |
| CSRF | Checagem de `Origin` em toda mutação |
| Auditoria | `audit_logs` append-only na mesma transação da ação |
| Mídia | Chaves por tenant validadas em toda operação; URLs temporárias assinadas (5 min) |
| Convites | Token aleatório de 256 bits; só o hash é guardado; uso único; expira em 7 dias; preso ao e-mail |
| Treinamento por terceiros | `allowProviderTraining` é sempre `false` (o servidor ignora outro valor) |
| Cabeçalhos | HSTS (Caddy), X-Frame-Options DENY, nosniff, Permissions-Policy bloqueando câmera, microfone e geolocalização |
| Segredos | Somente por variáveis de ambiente; nada versionado |

## Controles previstos (Etapas C e D)

- **Base legal por conversa:** o upload exige declarar a base legal (consentimento, legítimo interesse, contrato) e se os participantes foram informados (`consent_records`).
- **Redação de PII** antes do envio ao LLM: CPF, CNPJ, e-mail, telefone, cartão. Configurável e ligada por padrão.
- **Retenção:** job diário apaga a mídia original após N dias e transcrições/avaliações após M dias, conforme a configuração da empresa.
- **Exclusão sob demanda:** de conversa (mídia + transcrição + avaliação) e de empresa inteira.
- **Proteção contra prompt injection:** descrita em [ARCHITECTURE.md § 3](ARCHITECTURE.md#3-pipeline-de-análise-etapa-c).
- **Transparência:** texto-modelo de aviso de gravação e análise para o cliente usar com os participantes.
- **Criptografia em repouso:** com S3/R2 vem do provedor. No disco da VPS, usar volume criptografado (ver [DEPLOY.md](DEPLOY.md)).

## Proibições de produto

- Nenhuma captura oculta de áudio, vídeo ou tela.
- Nenhum reconhecimento facial, inferência de emoção por aparência ou classificação biométrica.
- Nenhuma análise visual dos participantes no MVP (vídeo é usado só para extrair o áudio).

## Pontos para validação jurídica

1. Base legal para o titular **terceiro** (o prospect gravado), que não é cliente da plataforma: consentimento ou legítimo interesse (com LIA).
2. **Transferência internacional** (art. 33): provedores de STT e LLM fora do Brasil; cláusulas contratuais e transparência.
3. **Monitoramento de empregados:** avaliações usadas em decisões de RH. Direito à revisão de decisão automatizada (art. 20). A revisão humana e o histórico ajudam, mas não substituem a análise jurídica.
4. **Dados sensíveis** (art. 11) que podem aparecer nas conversas (saúde, religião etc.).
5. Prazos padrão de retenção e o modelo de DPA.
6. Termos de uso e política de privacidade da plataforma.
