/**
 * Selección heurística del monto en texto OCR de comprobantes (PY / transferencias).
 * Evita usar número de cuenta o alias como “monto” cuando hay candidatos monetarios plausibles.
 */
import type { DatosBancariosEsperadosConfig } from "@/lib/chat/comprobante-validation-types";
import { normalizeBankAccountDigits } from "@/lib/chat/comprobante-bank-data-validation";

export type MontoOcrCandidateAudit = {
  /** Primeros dígitos + longitud; no expone el valor completo */
  digits_masked: string;
  score: number;
  flags: string[];
};

export type MontoOcrSelectionAudit = {
  chosen: string | null;
  chosen_reason: string;
  candidates: MontoOcrCandidateAudit[];
  discarded_bank_match: string[];
};

export type SelectReceiptMontoFromOcrOptions = {
  /** Monto esperado del flujo (Gs), si ya se conoce */
  expectedMontoGs?: number | null;
  toleranciaAbsolutaGs?: number;
  datosBancariosEsperados?: DatosBancariosEsperadosConfig | null;
};

const POS_LINE =
  /monto|total|importe|pagad[oa]|transferencia|enviad[oa]|env[ií]o|acreditad[oa]|d[eé]bito|pago|valor/i;
const NEG_LINE =
  /cuenta|nro\.?\s*cuenta|n[uú]mero\s+de\s+cuenta|cta\.?|alias|titular|\bruc\b|\bci\b|c[eé]dula|documento|operaci[oó]n|transacci[oó]n|referencia|tel[eé]fono|celular/i;

/** Ventana alrededor del match para detectar prefijo monetario */
function currencyNearFullText(text: string, start: number, end: number): boolean {
  const win = text.slice(Math.max(0, start - 45), Math.min(text.length, end + 30));
  return /(?:gs\.?|₲|pyg)/i.test(win);
}

function lineAtIndex(text: string, idx: number): string {
  const head = text.slice(0, idx);
  const lineStart = head.lastIndexOf("\n") + 1;
  const tail = text.slice(idx);
  const nl = tail.indexOf("\n");
  const lineEnd = nl === -1 ? text.length : idx + nl;
  return text.slice(lineStart, lineEnd);
}

function maskDigits(d: string): string {
  const t = d.replace(/\D/g, "");
  if (t.length <= 3) return "***";
  return `${t.slice(0, 2)}…(${t.length})`;
}

function buildExcludedDigitSequences(datos?: DatosBancariosEsperadosConfig | null): Set<string> {
  const s = new Set<string>();
  if (!datos) return s;
  const c = normalizeBankAccountDigits(datos.numero_cuenta ?? "");
  if (c.length >= 6) s.add(c);
  const a = normalizeBankAccountDigits(datos.alias ?? "");
  if (a.length >= 6) s.add(a);
  const tit = normalizeBankAccountDigits(datos.titular ?? "");
  if (tit.length >= 6) s.add(tit);
  return s;
}

/**
 * Encuentra candidatos numéricos (miles con punto o cadena de dígitos).
 */
function enumerateNumericCandidates(fullText: string): Array<{
  raw: string;
  digits: string;
  value: number;
  start: number;
  end: number;
}> {
  const t = fullText || "";
  const out: Array<{ raw: string; digits: string; value: number; start: number; end: number }> = [];
  const re = /\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d{4,14}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const raw = m[0];
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 4) continue;
    const value = Number(digits);
    if (!Number.isFinite(value) || value < 0) continue;
    const start = m.index;
    const end = start + raw.length;
    out.push({ raw, digits, value, start, end });
  }
  return out;
}

function scoreCandidate(
  fullText: string,
  digits: string,
  value: number,
  start: number,
  end: number,
  opts: SelectReceiptMontoFromOcrOptions
): { score: number; flags: string[] } {
  const flags: string[] = [];
  let score = 0;

  const line = lineAtIndex(fullText, start);

  if (POS_LINE.test(line)) {
    score += 55;
    flags.push("pos_kw");
  }
  if (NEG_LINE.test(line)) {
    score -= 140;
    flags.push("neg_kw");
  }

  const cur = currencyNearFullText(fullText, start, end);
  if (cur) {
    score += 130;
    flags.push("currency");
  }

  const exp = opts.expectedMontoGs;
  const tol = Math.max(0, Math.round(Number(opts.toleranciaAbsolutaGs) || 0));
  if (exp != null && exp > 0) {
    const d = Math.abs(value - exp);
    if (d <= tol) {
      score += 220;
      flags.push("near_expected");
    } else {
      const rel = d / Math.max(exp, 1);
      const bonus = Math.max(0, 90 - Math.min(90, rel * 45));
      score += bonus;
      if (bonus > 5) flags.push("prox_expected");
    }
  }

  const len = digits.length;
  /** Montos típicos en Gs (sin ser cuenta larga) */
  if (len >= 4 && len <= 8 && !NEG_LINE.test(line)) {
    score += 38;
    flags.push("plausible_len");
  }
  if (len >= 9 && !cur && !POS_LINE.test(line)) {
    score -= 110;
    flags.push("long_no_cur");
  }
  if (len >= 11 && !cur) {
    score -= 40;
    flags.push("very_long");
  }

  return { score, flags };
}

const MIN_RELIABLE_SCORE = 12;

/**
 * Elige el monto OCR más plausible; puede devolver cadena vacía si no hay candidato confiable.
 */
export function selectReceiptMontoFromOcrText(
  fullText: string,
  opts: SelectReceiptMontoFromOcrOptions = {}
): { monto: string; audit: MontoOcrSelectionAudit } {
  const t = fullText || "";
  const excluded = buildExcludedDigitSequences(opts.datosBancariosEsperados ?? undefined);
  const discarded: string[] = [];

  const rawList = enumerateNumericCandidates(t);
  const filtered = rawList.filter((c) => {
    if (excluded.has(c.digits)) {
      discarded.push(maskDigits(c.digits));
      return false;
    }
    return true;
  });

  const working = filtered.length > 0 ? filtered : [];

  const audits: MontoOcrCandidateAudit[] = [];
  let best: { digits: string; score: number; flags: string[] } | null = null;

  for (const c of working) {
    const { score, flags } = scoreCandidate(t, c.digits, c.value, c.start, c.end, opts);
    audits.push({
      digits_masked: maskDigits(c.digits),
      score,
      flags: [...flags],
    });
    if (!best || score > best.score) {
      best = { digits: c.digits, score, flags };
    }
  }

  /** Si todos los candidatos eran cuenta/alias, no inventar monto */
  if (working.length === 0 && rawList.length > 0) {
    return {
      monto: "",
      audit: {
        chosen: null,
        chosen_reason: "all_candidates_matched_excluded_bank_digits",
        candidates: audits,
        discarded_bank_match: [...new Set(discarded)],
      },
    };
  }

  if (!best || working.length === 0) {
    return {
      monto: "",
      audit: {
        chosen: null,
        chosen_reason: "no_numeric_candidates",
        candidates: audits,
        discarded_bank_match: [...new Set(discarded)],
      },
    };
  }

  const hasStrongHint =
    best.flags.includes("currency") ||
    best.flags.includes("pos_kw") ||
    best.flags.includes("near_expected") ||
    best.flags.includes("prox_expected");

  if (best.score < MIN_RELIABLE_SCORE && !hasStrongHint) {
    return {
      monto: "",
      audit: {
        chosen: null,
        chosen_reason: `below_min_score(${best.score};need_hint)`,
        candidates: audits.sort((a, b) => b.score - a.score),
        discarded_bank_match: [...new Set(discarded)],
      },
    };
  }

  const reason =
    best.flags.length > 0
      ? `best_score=${best.score};${best.flags.join(",")}`
      : `best_score=${best.score}`;

  return {
    monto: best.digits,
    audit: {
      chosen: best.digits,
      chosen_reason: reason,
      candidates: audits.sort((a, b) => b.score - a.score),
      discarded_bank_match: [...new Set(discarded)],
    },
  };
}

export function compactMontoOcrAuditForMotivo(audit: MontoOcrSelectionAudit | null | undefined): string {
  if (!audit) return "";
  const top = audit.candidates.slice(0, 6).map((c) => `${c.digits_masked}:${Math.round(c.score)}`).join(";");
  const disc = audit.discarded_bank_match.slice(0, 4).join(",");
  const parts = [
    `pick=${audit.chosen ? maskDigits(audit.chosen) : "none"}`,
    `why=${audit.chosen_reason.replace(/\|/g, "/")}`,
    top ? `cand=${top}` : "",
    disc ? `excl=${disc}` : "",
  ].filter(Boolean);
  return parts.join("|").slice(0, 480);
}
