/**
 * Camada de provedores de LLM (substituível).
 *  - "mock": avaliador SIMULADO e determinístico, para desenvolvimento, testes e demonstração
 *    sem custo. As avaliações simuladas são sinalizadas na interface.
 *  - "anthropic": Claude com saída estruturada validada por schema.
 */
import type { EvalInput, EvaluationOutput } from "./evaluation";
import { buildSystemPrompt, buildUserPrompt, evaluationOutputSchema } from "./evaluation";

export type LlmUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
export type LlmResult = { output: unknown; usage: LlmUsage; model: string; latencyMs: number };

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly code: string,
  ) {
    super(message);
  }
}

export interface EvaluationLlm {
  readonly provider: string;
  readonly model: string;
  evaluate(input: EvalInput): Promise<LlmResult>;
}

/* ------------------------------ Preços ------------------------------- */
// USD por milhão de tokens (tabela de referência; conferir periodicamente).
const PRICES: Record<string, { in: number; out: number; cacheRead: number }> = {
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01 },
};

/** Custo estimado em micro-USD. Escrita em cache cobrada a 1,25× a entrada. */
export function estimateCostMicros(model: string, u: LlmUsage) {
  const p = PRICES[model];
  if (!p) return 0;
  const usd = (u.inputTokens * p.in + u.cacheWriteTokens * p.in * 1.25 + u.cacheReadTokens * p.cacheRead + u.outputTokens * p.out) / 1_000_000;
  return Math.round(usd * 1_000_000);
}

/* ---------------------------- Simulado ------------------------------- */
const STOP = new Set("a o os as de da do das dos e que em um uma para com por no na nos nas se ao à é ou como mais sem seu sua".split(" "));
const words = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !STOP.has(w));

export class MockLlm implements EvaluationLlm {
  readonly provider = "mock";
  readonly model = "simulado-v1";
  /** Permite injetar respostas em testes (ex.: falhas, saídas maliciosas). */
  constructor(private readonly override?: (input: EvalInput) => unknown | Promise<unknown>) {}

  async evaluate(input: EvalInput): Promise<LlmResult> {
    const started = Date.now();
    const output = this.override ? await this.override(input) : this.heuristic(input);
    const chars = input.segments.reduce((a, s) => a + s.text.length, 0);
    return {
      output,
      model: this.model,
      latencyMs: Date.now() - started,
      usage: { inputTokens: Math.round(chars / 4), outputTokens: 1500, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }

  /** Heurística simples: sobreposição de palavras entre o critério e as falas do vendedor. */
  private heuristic(input: EvalInput): EvaluationOutput {
    const seller = input.segments.filter((s) => s.role === "seller");
    const pool = seller.length ? seller : input.segments;
    const criteria = input.criteria.map((c) => {
      const target = new Set(words(`${c.name} ${c.description} ${Object.values(c.anchors).join(" ")}`));
      let best = pool[0];
      let bestHits = -1;
      for (const s of pool) {
        const hits = words(s.text).filter((w) => target.has(w)).length + (s.text.includes("?") ? 1 : 0);
        if (hits > bestHits) [best, bestHits] = [s, hits];
      }
      if (!best || bestHits < 1) {
        return { key: c.key, status: "not_evaluable" as const, score: null, justification: "Sem evidência na transcrição (avaliação simulada).", confidence: 0.3, evidence: [] };
      }
      const score = Math.min(input.scaleMax, input.scaleMin + 4 + bestHits);
      const quote = best.text.split(/\s+/).slice(0, 15).join(" ");
      return {
        key: c.key,
        status: "scored" as const,
        score,
        justification: `Avaliação simulada com base no trecho S${best.idx}.`,
        confidence: 0.5,
        evidence: [{ segment: best.idx, quote }],
      };
    });
    const first = pool[0];
    return {
      criteria,
      feedback: {
        summary: `Conversa com ${input.segments.length} trechos. Resumo gerado pelo avaliador simulado.`,
        objective: "Objetivo identificado pelo avaliador simulado.",
        strengths: first ? [{ text: "Ponto forte de exemplo (simulado).", segments: [first.idx] }] : [],
        improvements: [{ text: "Oportunidade de melhoria de exemplo (simulada).", segments: [] }],
        objections: [],
        investigation_quality: "Qualidade da investigação não analisada no modo simulado.",
        next_steps: [],
        suggested_questions: ["Qual o impacto desse problema no resultado do seu time hoje?"],
        coaching_recommendations: ["Configure uma chave de IA para obter avaliações reais."],
      },
    };
  }
}

/* ----------------------------- Claude -------------------------------- */
export class AnthropicLlm implements EvaluationLlm {
  readonly provider = "anthropic";
  constructor(readonly model: string) {}

  async evaluate(input: EvalInput): Promise<LlmResult> {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { betaZodOutputFormat } = await import("@anthropic-ai/sdk/helpers/beta/zod");
    const client = new Anthropic({ maxRetries: 2, timeout: 10 * 60 * 1000 });
    const started = Date.now();
    try {
      const res = await client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        // Recusa por política: o servidor tenta automaticamente um modelo alternativo.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // Bloco fixo (instruções + rubrica) em cache: reaproveitado entre conversas da mesma versão.
        system: [{ type: "text", text: buildSystemPrompt(input), cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: buildUserPrompt(input) }],
        output_config: { format: betaZodOutputFormat(evaluationOutputSchema), effort: "medium" },
      });
      if (res.stop_reason === "refusal") throw new LlmError("O modelo recusou a avaliação.", false, "refusal");
      if (res.stop_reason === "max_tokens") throw new LlmError("Resposta do modelo truncada.", true, "max_tokens");
      if (!res.parsed_output) throw new LlmError("Resposta fora do formato esperado.", true, "parse_failed");
      return {
        output: res.parsed_output,
        model: res.model,
        latencyMs: Date.now() - started,
        usage: {
          inputTokens: res.usage.input_tokens,
          outputTokens: res.usage.output_tokens,
          cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
        },
      };
    } catch (e) {
      if (e instanceof LlmError) throw e;
      if (e instanceof Anthropic.RateLimitError) throw new LlmError("Limite de requisições do provedor.", true, "rate_limited");
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
        throw new LlmError("Chave de API inválida ou sem permissão.", false, "auth");
      }
      if (e instanceof Anthropic.BadRequestError) throw new LlmError("Requisição rejeitada pelo provedor.", false, "bad_request");
      if (e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) {
        throw new LlmError("Provedor indisponível.", true, "unavailable");
      }
      if (e instanceof Anthropic.APIError) throw new LlmError("Erro do provedor de IA.", (e.status ?? 500) >= 500, "provider_error");
      throw e;
    }
  }
}

let override: EvaluationLlm | null = null;
/** Usado pelos testes para injetar um provedor. */
export function setLlmForTesting(llm: EvaluationLlm | null) {
  override = llm;
}

export function getEvaluationLlm(): EvaluationLlm {
  if (override) return override;
  if (process.env.LLM_PROVIDER === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) throw new LlmError("ANTHROPIC_API_KEY não configurada.", false, "not_configured");
    return new AnthropicLlm(process.env.LLM_MODEL_EVALUATION || "claude-opus-5-5");
  }
  return new MockLlm();
}
