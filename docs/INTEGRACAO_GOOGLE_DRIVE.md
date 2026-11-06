# Integração com o Google Drive (planejada)

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

## O que a Jump precisa providenciar (opção A)
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
