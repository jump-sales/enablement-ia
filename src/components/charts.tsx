"use client";
import { useState } from "react";

/* Cores validadas (scripts/validate_palette.js do guia de visualização):
 * - série única: #2a78d6 (passa banda de luminosidade, croma e contraste)
 * - comparação ordenada mês anterior → atual: #86b6ef → #1c5cab (rampa ordinal, um só tom) */
const SERIES = "#2a78d6";
const PREV = "#86b6ef";
const CUR = "#1c5cab";
const GRID = "#e3e6eb";
const INK_MUTED = "#5b6676";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1]}/${y.slice(2)}`;
};
const fmt = (v: number | null) => (v === null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 1 }));

export type TrendPoint = { month: string; avg: number | null; count: number };

/** Linha da nota média (0–10) mês a mês. Meses sem avaliação ficam como lacuna, nunca como zero. */
export function TrendChart({ points, label }: { points: TrendPoint[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 220;
  const pad = { l: 32, r: 16, t: 16, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (points.length === 1 ? iw / 2 : (i * iw) / (points.length - 1));
  const y = (v: number) => pad.t + ih - (v / 10) * ih;
  // Segmentos contínuos (quebra a linha em meses sem dado).
  const segments: string[] = [];
  let cur: string[] = [];
  points.forEach((p, i) => {
    if (p.avg === null) {
      if (cur.length > 1) segments.push(cur.join(" "));
      cur = [];
    } else cur.push(`${cur.length ? "L" : "M"}${x(i).toFixed(1)},${y(p.avg).toFixed(1)}`);
  });
  if (cur.length > 1) segments.push(cur.join(" "));
  const h = hover !== null ? points[hover] : null;

  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
        {[0, 5, 10].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill={INK_MUTED}>{v}</text>
          </g>
        ))}
        {points.map((p, i) => (
          <text key={p.month} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill={INK_MUTED}>{monthLabel(p.month)}</text>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke={GRID} strokeWidth={1} />}
        {segments.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {points.map((p, i) =>
          p.avg === null ? null : (
            <circle key={p.month} cx={x(i)} cy={y(p.avg)} r={hover === i ? 5 : 4} fill={SERIES} stroke="#fff" strokeWidth={2} />
          ),
        )}
        {points.map((p, i) => (
          <rect
            key={`hit-${p.month}`}
            x={x(i) - iw / Math.max(1, points.length - 1) / 2}
            y={pad.t}
            width={iw / Math.max(1, points.length - 1)}
            height={ih}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute top-2 rounded-md border border-line bg-white px-3 py-2 text-xs shadow-sm"
          style={{ left: `${(x(hover) / W) * 100}%`, transform: "translateX(-50%)" }}
          role="status"
        >
          <div className="font-medium text-navy">{monthLabel(h.month)}</div>
          <div className="text-muted">Nota média: <span className="tabular-nums text-navy">{fmt(h.avg)}</span></div>
          <div className="text-muted">{h.count} {h.count === 1 ? "conversa" : "conversas"}</div>
        </div>
      )}
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer">Ver como tabela</summary>
        <table className="mt-2 w-full text-left">
          <thead><tr><th className="py-1 font-medium">Mês</th><th className="font-medium">Nota média</th><th className="font-medium">Conversas</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.month}><td className="py-0.5">{monthLabel(p.month)}</td><td className="tabular-nums">{fmt(p.avg)}</td><td className="tabular-nums">{p.count}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}

export type CompetencyBar = { competency: string; current: number | null; previous: number | null };

/** Barras horizontais por competência: mês anterior × mês atual (0–10). */
export function CompetencyBars({ rows }: { rows: CompetencyBar[] }) {
  const [hover, setHover] = useState<string | null>(null);
  return (
    <figure>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: PREV }} /> Mês anterior</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: CUR }} /> Mês atual</span>
      </div>
      <ul className="flex flex-col gap-3">
        {rows.map((r) => {
          const delta = r.current !== null && r.previous !== null ? r.current - r.previous : null;
          return (
            <li key={r.competency} onMouseEnter={() => setHover(r.competency)} onMouseLeave={() => setHover(null)} className="relative">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-navy">{r.competency}</span>
                <span className="tabular-nums text-ink">
                  {fmt(r.current)}
                  {delta !== null && Math.abs(delta) >= 0.05 && (
                    <span className="ml-1.5 text-xs text-muted">{delta > 0 ? "▲" : "▼"} {fmt(Math.abs(delta))}</span>
                  )}
                </span>
              </div>
              <div className="mt-1 flex flex-col gap-[2px]" aria-hidden>
                <div className="h-2 rounded-r-[4px] bg-surface"><div className="h-2 rounded-r-[4px]" style={{ width: `${((r.previous ?? 0) / 10) * 100}%`, background: PREV }} /></div>
                <div className="h-2 rounded-r-[4px] bg-surface"><div className="h-2 rounded-r-[4px]" style={{ width: `${((r.current ?? 0) / 10) * 100}%`, background: CUR }} /></div>
              </div>
              {hover === r.competency && (
                <div className="pointer-events-none absolute right-0 top-full z-10 mt-1 rounded-md border border-line bg-white px-3 py-2 text-xs shadow-sm" role="status">
                  <div className="font-medium text-navy">{r.competency}</div>
                  <div className="text-muted">Mês anterior: <span className="tabular-nums text-navy">{fmt(r.previous)}</span></div>
                  <div className="text-muted">Mês atual: <span className="tabular-nums text-navy">{fmt(r.current)}</span></div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer">Ver como tabela</summary>
        <table className="mt-2 w-full text-left">
          <thead><tr><th className="py-1 font-medium">Competência</th><th className="font-medium">Anterior</th><th className="font-medium">Atual</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.competency}><td className="py-0.5">{r.competency}</td><td className="tabular-nums">{fmt(r.previous)}</td><td className="tabular-nums">{fmt(r.current)}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}
