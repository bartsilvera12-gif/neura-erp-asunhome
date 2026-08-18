/**
 * Normalización de teléfonos para campañas WhatsApp (E.164).
 * Heurística Paraguay: local tipo 0981… / 09… → +595981…
 */

export type PhoneNormalizeResult =
  | { ok: true; e164: string; digits: string }
  | { ok: false; error: string };

/** Solo dígitos internacionales sin + (p. ej. 595981123456). */
export function digitsInternational(e164: string): string {
  return e164.replace(/^\+/, "").replace(/\D/g, "");
}

export function normalizeCampaignPhone(raw: string): PhoneNormalizeResult {
  const t = raw.trim();
  if (!t) return { ok: false, error: "Vacío" };

  const d = t.replace(/\D/g, "");
  if (!d) return { ok: false, error: "Sin dígitos" };

  // Ya viene en formato internacional largo
  if (t.startsWith("+")) {
    const digits = d;
    if (digits.length < 8 || digits.length > 15) {
      return { ok: false, error: "Longitud internacional inválida" };
    }
    return { ok: true, e164: `+${digits}`, digits };
  }

  // Paraguay: 0 + móvil 9 dígitos (9xxxxxxxx)
  const pyMobile = d.match(/^0?(9\d{8})$/);
  if (pyMobile) {
    const national = pyMobile[1];
    const full = `595${national}`;
    return { ok: true, e164: `+${full}`, digits: full };
  }

  // Empieza con código país conocido sin +
  if (d.startsWith("595") && d.length >= 11) {
    return { ok: true, e164: `+${d}`, digits: d };
  }

  // Fallback: longitud razonable → asumir ya E.164 sin +
  if (d.length >= 10 && d.length <= 15) {
    return { ok: true, e164: `+${d}`, digits: d };
  }

  return { ok: false, error: "No se pudo normalizar el número" };
}
