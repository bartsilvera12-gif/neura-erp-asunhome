/**
 * Interpreta montos típicos en PYG / UI paraguaya: "50000", "50.000", "50,000", etc.
 * No reemplaza un motor contable; basta para cupos de flujo y chat_flow_data.
 */
export function parseMoneyPy(raw: string | undefined | null): number | null {
  let t = String(raw ?? "")
    .trim()
    .replace(/\s/g, "");
  if (!t) return null;
  t = t.replace(/[^\d.,-]/g, "");
  if (!t || t === "-") return null;

  const lastComma = t.lastIndexOf(",");
  const lastDot = t.lastIndexOf(".");
  let normalized: string;

  if (lastComma > lastDot) {
    // Estilo 1.234.567,89
    normalized = t.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    const afterLast = t.slice(lastDot + 1);
    // 50.000 (miles) vs 50.5 (decimal)
    if (/^\d{3}$/.test(afterLast) && !t.includes(",")) {
      const parts = t.split(".");
      if (
        parts.length === 2 &&
        /^\d+$/.test(parts[0]!) &&
        /^\d{3}$/.test(parts[1]!)
      ) {
        normalized = parts[0]! + parts[1]!;
      } else {
        normalized = t.replace(/\./g, "");
      }
    } else {
      normalized = t.replace(/,/g, "");
    }
  } else if (t.includes(".")) {
    const parts = t.split(".");
    if (
      parts.length === 2 &&
      /^\d+$/.test(parts[0]!) &&
      /^\d{1,2}$/.test(parts[1]!)
    ) {
      normalized = `${parts[0]}.${parts[1]}`;
    } else if (
      parts.length === 2 &&
      /^\d+$/.test(parts[0]!) &&
      /^\d{3}$/.test(parts[1]!)
    ) {
      normalized = parts[0]! + parts[1]!;
    } else {
      normalized = t.replace(/\./g, "");
    }
  } else {
    normalized = t.replace(",", ".");
  }

  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
