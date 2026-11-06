/**
 * Cálculo determinístico da nota (nunca delegado ao LLM).
 *
 * - Critérios "não aplicáveis" saem do cálculo.
 * - Critérios "não avaliáveis" NÃO viram zero: saem da média e reduzem a cobertura.
 * - Nota geral = média ponderada apenas entre critérios pontuados, na escala da rubrica.
 * - Cobertura = peso pontuado / peso aplicável. Abaixo do mínimo ⇒ resultado inconclusivo.
 * - Critério obrigatório pontuado abaixo de 50% da escala limita a classificação à mais baixa.
 */

export type CriterionDef = { key: string; weight: number; mandatory: boolean };
export type CriterionResult = { key: string; status: "scored" | "not_applicable" | "not_evaluable"; score: number | null };
export type Threshold = { label: string; minScore: number };

export type ScoreSummary = {
  overall: number | null;
  classification: string;
  coverage: number;
  mandatoryFailed: string[];
  mandatoryNotEvaluable: string[];
};

export const INCONCLUSIVE = "Inconclusivo";

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function computeScore(
  defs: CriterionDef[],
  results: CriterionResult[],
  opts: { scaleMin: number; scaleMax: number; thresholds: Threshold[]; minCoverage: number },
): ScoreSummary {
  const byKey = new Map(results.map((r) => [r.key, r]));
  let applicableWeight = 0;
  let scoredWeight = 0;
  let weighted = 0;
  const mandatoryFailed: string[] = [];
  const mandatoryNotEvaluable: string[] = [];
  const mid = opts.scaleMin + (opts.scaleMax - opts.scaleMin) / 2;

  for (const d of defs) {
    const r = byKey.get(d.key) ?? { key: d.key, status: "not_evaluable" as const, score: null };
    if (r.status === "not_applicable" || d.weight <= 0) continue;
    applicableWeight += d.weight;
    if (r.status === "scored" && r.score !== null) {
      scoredWeight += d.weight;
      weighted += d.weight * r.score;
      if (d.mandatory && r.score < mid) mandatoryFailed.push(d.key);
    } else if (d.mandatory) mandatoryNotEvaluable.push(d.key);
  }

  const coverage = applicableWeight === 0 ? 0 : round(scoredWeight / applicableWeight, 3);
  if (scoredWeight === 0 || coverage < opts.minCoverage) {
    return { overall: null, classification: INCONCLUSIVE, coverage, mandatoryFailed, mandatoryNotEvaluable };
  }
  const overall = round(weighted / scoredWeight);
  const sorted = [...opts.thresholds].sort((a, b) => b.minScore - a.minScore);
  let classification = sorted.find((t) => overall >= t.minScore)?.label ?? sorted[sorted.length - 1]?.label ?? "";
  if (mandatoryFailed.length && sorted.length) classification = sorted[sorted.length - 1].label;
  return { overall, classification, coverage, mandatoryFailed, mandatoryNotEvaluable };
}
