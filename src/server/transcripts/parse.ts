/**
 * Leitura de transcrições já geradas pelas plataformas de reunião.
 *
 * Formatos suportados:
 *  - WebVTT (.vtt): Zoom ("Nome: fala"), Teams ("<v Nome>fala</v>")
 *  - SubRip (.srt)
 *  - Documento de transcrição do Google Meet (.txt exportado ou .docx):
 *      linhas "Nome: fala" com marcações de tempo ("00:05:00") a cada poucos minutos
 *  - Texto simples "Nome: fala" sem tempos
 *
 * Nunca inventamos precisão: quando os tempos por fala são estimados, o resultado
 * informa `timestampPrecision = "approximate"` e a interface mostra isso.
 */

export type ParsedSegment = { startMs: number; endMs: number; speaker: string | null; text: string };
export type TranscriptFormat = "vtt" | "srt" | "meet_doc" | "plain";

export type ParsedTranscript = {
  format: TranscriptFormat;
  segments: ParsedSegment[];
  timestampPrecision: "exact" | "approximate" | "none";
  durationMs: number;
  speakers: string[];
  warnings: string[];
};

export class TranscriptParseError extends Error {}

/** Palavras faladas por minuto usadas para estimar tempos quando não há marcação. */
const WORDS_PER_MINUTE = 150;
/** Falas consecutivas do mesmo falante são agrupadas até este limite (reduz tokens). */
const MERGE_MAX_MS = 45_000;
const MERGE_MAX_GAP_MS = 2_000;

const TS = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?/;

function tsToMs(s: string): number {
  const m = TS.exec(s.trim());
  if (!m) throw new TranscriptParseError(`Tempo inválido: ${s}`);
  const [, h, mi, se, ms] = m;
  return ((Number(h ?? 0) * 60 + Number(mi)) * 60 + Number(se)) * 1000 + Number((ms ?? "0").padEnd(3, "0"));
}

function clean(text: string) {
  return text
    .replace(/<[^>]+>/g, "") // marcações VTT (<c>, <i>, <v>)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Nome Sobrenome: texto" → [nome, texto]. Evita confundir "Obs: ..." longo ou horários. */
function splitSpeaker(line: string): [string | null, string] {
  const m = /^([^:\n]{1,60}?):\s+(.+)$/.exec(line);
  if (!m) return [null, line];
  const name = m[1].trim();
  if (/^\d/.test(name) || name.split(/\s+/).length > 6 || /https?$/i.test(name)) return [null, line];
  return [name, m[2]];
}

function mergeSameSpeaker(segs: ParsedSegment[]): ParsedSegment[] {
  const out: ParsedSegment[] = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.speaker === s.speaker &&
      s.startMs - prev.endMs <= MERGE_MAX_GAP_MS &&
      s.endMs - prev.startMs <= MERGE_MAX_MS
    ) {
      prev.text = `${prev.text} ${s.text}`;
      prev.endMs = Math.max(prev.endMs, s.endMs);
    } else out.push({ ...s });
  }
  return out;
}

/* ------------------------------- VTT / SRT ------------------------------ */
function parseCues(raw: string, format: "vtt" | "srt"): ParsedSegment[] {
  const blocks = raw.replace(/\r/g, "").split(/\n{2,}/);
  const segs: ParsedSegment[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const timeIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeIdx === -1) continue;
    const [a, b] = lines[timeIdx].split("-->");
    const startMs = tsToMs(a);
    const endMs = tsToMs(b.trim().split(/\s+/)[0]);
    let body = lines.slice(timeIdx + 1).join(" ");
    let speaker: string | null = null;
    const voice = /<v(?:\.[^\s>]+)?\s+([^>]+)>/.exec(body);
    if (voice) speaker = voice[1].trim();
    body = clean(body);
    if (!speaker) [speaker, body] = splitSpeaker(body);
    if (!body) continue;
    segs.push({ startMs, endMs: Math.max(endMs, startMs), speaker, text: body });
  }
  if (format === "vtt" && segs.length === 0 && !raw.trimStart().startsWith("WEBVTT")) {
    throw new TranscriptParseError("Arquivo .vtt sem cabeçalho WEBVTT.");
  }
  return segs;
}

/* ------------------------ Google Meet / texto simples ------------------- */
const TIME_LINE = /^\s*(?:\[)?(\d{1,2}:\d{2}(?::\d{2})?)(?:\])?\s*$/;

function estimateMs(text: string) {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1500, Math.round((words / WORDS_PER_MINUTE) * 60_000));
}

function parseLines(raw: string): { segs: ParsedSegment[]; precision: "approximate" | "none"; format: TranscriptFormat } {
  const lines = raw.replace(/\r/g, "").split("\n");
  type Pending = { speaker: string | null; text: string; anchorMs: number | null };
  const items: Pending[] = [];
  let anchor: number | null = null;
  let sawTimeLine = false;
  for (const line of lines) {
    const t = TIME_LINE.exec(line);
    if (t) {
      anchor = tsToMs(t[1]);
      sawTimeLine = true;
      continue;
    }
    const text = clean(line);
    if (!text) continue;
    const [speaker, body] = splitSpeaker(text);
    if (speaker) {
      items.push({ speaker, text: body, anchorMs: anchor });
      anchor = null;
    } else if (items.length) {
      items[items.length - 1].text += ` ${body}`; // continuação da fala anterior
    } // linhas antes da primeira fala (título, participantes) são ignoradas
  }
  // Distribui o tempo: entre duas marcações, proporcional ao tamanho das falas.
  const segs: ParsedSegment[] = [];
  let cursor = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.anchorMs !== null && it.anchorMs >= cursor) cursor = it.anchorMs;
    // próximo âncora, para não ultrapassar
    let nextAnchor: number | null = null;
    let charsUntil = 0;
    for (let j = i; j < items.length; j++) {
      if (j > i && items[j].anchorMs !== null) {
        nextAnchor = items[j].anchorMs;
        break;
      }
      charsUntil += items[j].text.length;
    }
    let dur = estimateMs(it.text);
    if (nextAnchor !== null && nextAnchor > cursor) dur = Math.round(((nextAnchor - cursor) * it.text.length) / Math.max(1, charsUntil));
    segs.push({ startMs: cursor, endMs: cursor + Math.max(500, dur), speaker: it.speaker, text: it.text });
    cursor += Math.max(500, dur);
  }
  return { segs, precision: sawTimeLine ? "approximate" : "none", format: sawTimeLine ? "meet_doc" : "plain" };
}

/* --------------------------------- API --------------------------------- */
export const SUPPORTED_EXTENSIONS = [".vtt", ".srt", ".txt", ".docx"] as const;
export const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024;

export async function extractText(fileName: string, data: Buffer): Promise<string> {
  const lower = fileName.toLowerCase();
  if (data.length === 0) throw new TranscriptParseError("Arquivo vazio.");
  if (data.length > MAX_TRANSCRIPT_BYTES) throw new TranscriptParseError("Arquivo maior que 5 MB. Envie apenas a transcrição.");
  if (lower.endsWith(".docx")) {
    if (data[0] !== 0x50 || data[1] !== 0x4b) throw new TranscriptParseError("Arquivo .docx inválido ou corrompido.");
    const mammoth = await import("mammoth");
    try {
      return (await mammoth.extractRawText({ buffer: data })).value;
    } catch {
      throw new TranscriptParseError("Não foi possível ler o .docx.");
    }
  }
  if (!SUPPORTED_EXTENSIONS.some((e) => lower.endsWith(e))) {
    throw new TranscriptParseError("Formato não suportado. Envie .vtt, .srt, .txt ou .docx.");
  }
  const text = data.toString("utf8");
  if (text.includes("\u0000")) throw new TranscriptParseError("O arquivo não parece ser texto.");
  return text.replace(/^﻿/, "");
}

export function parseTranscriptText(fileName: string, text: string): ParsedTranscript {
  const lower = fileName.toLowerCase();
  const warnings: string[] = [];
  let segs: ParsedSegment[];
  let format: TranscriptFormat;
  let precision: ParsedTranscript["timestampPrecision"];

  if (lower.endsWith(".vtt") || text.trimStart().startsWith("WEBVTT")) {
    segs = parseCues(text, "vtt");
    format = "vtt";
    precision = "exact";
  } else if (lower.endsWith(".srt") || /^\d+\s*\n\d{2}:\d{2}:\d{2},\d{3}\s*-->/m.test(text)) {
    segs = parseCues(text, "srt");
    format = "srt";
    precision = "exact";
  } else {
    const r = parseLines(text);
    segs = r.segs;
    format = r.format;
    precision = r.precision;
    if (precision !== "exact") warnings.push("Os horários de cada fala são estimados a partir das marcações do documento.");
  }

  segs = mergeSameSpeaker(segs.filter((s) => s.text.length > 0)).sort((a, b) => a.startMs - b.startMs);
  if (segs.length < 2) throw new TranscriptParseError("Não encontramos falas suficientes na transcrição.");
  const speakers = [...new Set(segs.map((s) => s.speaker).filter((s): s is string => Boolean(s)))];
  if (speakers.length === 0) warnings.push("A transcrição não identifica quem fala; a avaliação pode ficar limitada.");
  else if (speakers.length === 1) warnings.push("Apenas um falante identificado.");
  const withoutSpeaker = segs.filter((s) => !s.speaker).length;
  if (withoutSpeaker > 0 && speakers.length > 0) warnings.push(`${withoutSpeaker} trecho(s) sem identificação de falante.`);

  return {
    format,
    segments: segs,
    timestampPrecision: precision,
    durationMs: segs[segs.length - 1].endMs,
    speakers,
    warnings,
  };
}

export async function parseTranscriptFile(fileName: string, data: Buffer) {
  return parseTranscriptText(fileName, await extractText(fileName, data));
}
