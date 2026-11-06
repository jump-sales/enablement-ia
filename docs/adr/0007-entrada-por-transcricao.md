# ADR 0007 — Entrada por transcrição pronta (Meet/Zoom/Teams) em vez de áudio

- **Status:** aceito
- **Data:** 2026-11-06

## Contexto
A transcrição de áudio é o maior custo por conversa (≈ 60% do total estimado) e exige um provedor de STT ou um servidor com muita CPU. As plataformas de reunião usadas pelos clientes (Google Meet, Zoom, Teams) já geram a transcrição com o nome de cada participante.

## Decisão
- O MVP recebe **o arquivo de transcrição** (.vtt, .srt, .txt ou .docx), não o áudio.
- O vendedor é identificado pelo nome do falante comparado ao cadastro; se não houver correspondência, o sistema sugere e **pede confirmação** antes de avaliar.
- Transcrições do Meet trazem marcação de tempo só a cada alguns minutos: os horários de cada fala são **estimados** e a interface mostra "~" e um aviso.
- Somente a etapa de avaliação usa IA paga.
- O upload de áudio/vídeo com STT continua no backlog, como opção para quem não tem transcrição.

## Consequências
- (+) Custo por conversa cai para apenas a avaliação (~US$ 0,05–0,35, conforme duração e modelo).
- (+) Nomes reais dos falantes (melhor que a diarização por rótulos).
- (−) Depende de o cliente ativar a transcrição na plataforma.
- (−) Qualidade da transcrição fica a cargo da plataforma (erros de reconhecimento não são corrigíveis por nós).
- (−) Evidências em transcrições do Meet têm horário aproximado.
