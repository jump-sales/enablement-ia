# ADR 0005 — Camada de provedores de IA e avaliação em chamada única

- **Status:** aceito (implementação na Etapa C)
- **Data:** 2026-11-06

## Decisão
- Interfaces `TranscriptionProvider` e `LLMProvider` com implementação simulada (testes e demonstração) e real.
- LLM inicial: Claude (structured outputs). Modelo configurável por etapa: leve para tarefas simples, robusto para a avaliação.
- **Avaliação em uma única chamada** (rubrica + transcrição numerada → JSON com notas, evidências e feedback). A nota final é calculada em código, e as evidências são verificadas contra a transcrição.
- Toda chamada registra uso e custo estimado em `usage_events`.

## Consequências
- (+) Custo previsível, sem reenvio da transcrição.
- (+) Troca de provedor sem mudar o domínio.
- (−) Uma rubrica muito grande aumenta a saída de uma chamada; se necessário, dividir por grupo de competências usando só os segmentos relevantes.
