# Integração com o Google Drive

> **Situação:** opção A **implementada e testada com um Google simulado**. Para funcionar de verdade, falta a Jump criar o projeto no Google Cloud (passo a passo abaixo) e preencher `GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY` e `GOOGLE_APP_ID` no servidor. Sem essas variáveis, o botão não aparece e o envio manual continua funcionando.

## Como funciona para o usuário
1. Em **Conversas → Enviar transcrição**, clica em **Escolher no Google Drive** e autoriza (só na primeira vez).
2. No seletor do Google, escolhe uma ou várias transcrições (até 20), como o documento “Transcrição” que o Meet salva na pasta “Meet Recordings”.
3. Para cada arquivo, confere ou preenche: título (sugerido pelo nome), vendedor, tipo de conversa, metodologia e data (sugerida pela data do arquivo).
4. Informa a base legal e confirma que os participantes foram avisados (vale para todos).
5. Clica em **Importar e avaliar**. Cada arquivo mostra o resultado; os que falharem ficam na lista para corrigir e tentar de novo.

## Segurança
- Escopo `drive.file`: o sistema só lê os arquivos que a pessoa escolheu no seletor.
- O token do Google tem validade curta (~1 h), é usado só durante a importação e **não é salvo** nem registrado em log.
- O mesmo arquivo do Drive não é importado duas vezes (`external_ref`).
- Vendedor só importa para si mesmo; gestor/admin pode importar para qualquer vendedor.

## Objetivo
Importar transcrições (e, futuramente, gravações) direto do Google Drive, onde o Google Meet salva automaticamente o documento "Transcrição" de cada reunião. O Drive é **fonte** dos arquivos: os dados processados continuam no banco da plataforma, com isolamento por empresa, retenção e exclusão sob nosso controle (exigências da LGPD que o Drive não atende sozinho).

## Opções

| | A. Seletor de arquivos (recomendado para o MVP) | B. Sincronização automática de pasta |
|---|---|---|
| Como funciona | O usuário clica em "Importar do Drive", escolhe uma ou mais transcrições no seletor do Google e o sistema importa | O sistema monitora uma pasta (ex.: "Meet Recordings") e importa cada nova transcrição sozinho |
| Permissão Google | `drive.file` (acesso só aos arquivos que o usuário escolher) | `drive.readonly` (acesso a todo o Drive do usuário) |
| Exigência do Google | Verificação simples do app | Escopo **restrito**: verificação do app e avaliação de segurança anual por terceiro (segundo a política atual do Google; confirmar ao configurar) |
| Esforço | Baixo | Alto (verificação + sincronização + renovação de tokens) |

Alternativa à opção B para clientes com Google Workspace: o administrador do Workspace do cliente autoriza uma conta de serviço (delegação em todo o domínio), sem a avaliação de segurança, mas com configuração feita pelo cliente.

## Passo a passo para a Jump (Google Cloud)

1. Acesse **console.cloud.google.com** com a conta Google da Jump e crie um projeto (ex.: “Jump Enablement”). Anote o **número do projeto** (painel do projeto → “Número do projeto”): é o `GOOGLE_APP_ID`.
2. **APIs e serviços → Biblioteca:** ative **Google Drive API** e **Google Picker API**.
3. **APIs e serviços → Tela de permissão OAuth:** tipo **Externo**; nome do app; e-mail de suporte; domínio da aplicação; links da política de privacidade e dos termos; escopo `.../auth/drive.file`. Enquanto estiver em teste, adicione os e-mails que vão testar.
4. **Credenciais → Criar credenciais → ID do cliente OAuth:** tipo **Aplicativo da Web**; em “Origens JavaScript autorizadas”, coloque o endereço da aplicação (ex.: `https://app.seudominio.com.br`). Copie o **ID do cliente**: é o `GOOGLE_CLIENT_ID`.
5. **Credenciais → Criar credenciais → Chave de API:** restrinja a chave à **Google Picker API** e ao domínio da aplicação (referenciadores HTTP). Copie: é a `GOOGLE_API_KEY`.
6. Coloque os três valores no `deploy/.env` do servidor e reinicie (`docker compose up -d`).
7. Para uso por clientes fora da Jump, envie o app para **verificação** na tela de permissão OAuth.

Os três valores são públicos por natureza (aparecem no navegador), mas a chave de API precisa das restrições do passo 5.

## O que a Jump precisa providenciar (resumo)
1. Projeto no Google Cloud (conta da Jump).
2. Ativar a Google Drive API e a Google Picker API.
3. Configurar a tela de consentimento OAuth (nome do app, domínio, política de privacidade e termos).
4. Criar um ID de cliente OAuth (aplicativo da Web) com o domínio de produção autorizado e uma chave de API restrita ao Picker.
5. Enviar o app para verificação do Google.

Nenhuma dessas credenciais deve ser enviada por chat: elas entram como variáveis de ambiente do servidor (`deploy/.env`).

## Fluxo técnico (opção A)
1. Seletor do Google no navegador → retorna os IDs dos arquivos escolhidos.
2. Servidor exporta o documento do Meet como texto (`files.export`, `text/plain`) ou baixa o .vtt/.docx.
3. Mesmo pipeline do upload manual (leitura, identificação de falantes, redação, avaliação).
4. `conversations.source = google_drive` e `external_ref = <ID do arquivo>` evitam importar o mesmo arquivo duas vezes.
