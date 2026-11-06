/**
 * Mascaramento de dados pessoais antes do envio ao LLM.
 * Conservador: prefere deixar passar um número comum a apagar um valor de proposta
 * (preços como "R$ 1.500,00" não são tocados).
 */

const digits = (s: string) => s.replace(/\D/g, "");

function validCpf(raw: string) {
  const d = digits(raw);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

function validCnpj(raw: string) {
  const d = digits(raw);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = w.reduce((acc, wi, i) => acc + wi * Number(d[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

function luhn(raw: string) {
  const d = digits(raw);
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

type Rule = { label: string; re: RegExp; check?: (m: string) => boolean };

const RULES: Rule[] = [
  { label: "[EMAIL]", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { label: "[CARTAO]", re: /\b(?:\d[ -]?){12,18}\d\b/g, check: luhn },
  { label: "[CNPJ]", re: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, check: validCnpj },
  { label: "[CPF]", re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, check: validCpf },
  // Telefones BR: (11) 98765-4321, 11 98765 4321, +55 11 3456-7890
  { label: "[TELEFONE]", re: /(?:\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g },
];

export type RedactionResult = { text: string; counts: Record<string, number> };

export function redactPii(text: string): RedactionResult {
  const counts: Record<string, number> = {};
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.re, (m) => {
      if (rule.check && !rule.check(m)) return m;
      counts[rule.label] = (counts[rule.label] ?? 0) + 1;
      return rule.label;
    });
  }
  return { text: out, counts };
}
