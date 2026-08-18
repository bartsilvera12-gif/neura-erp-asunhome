/**
 * Reglas de cancelación lógica del DE (SIFEN) en ERP.
 * El plazo se calcula desde `sifen_aprobado_at`, no desde la fecha comercial de la factura.
 */

export type SifenCancelacionContext = {
  estadoSifen: string | null;
  sifenAprobadoAtIso: string | null;
  sifenCanceladoAtIso: string | null;
  plazoHoras: number;
  pagosCount: number;
  /** Instantánea de referencia (servidor); tests pueden fijarla. */
  nowMs: number;
};

export type SifenCancelacionPreview = {
  puede_cancelar: boolean;
  /** Fecha/hora límite inclusive del plazo (ISO UTC). */
  cancelable_hasta: string | null;
  motivo_bloqueo: string | null;
  requiere_nota_credito: boolean;
  tiene_pagos: boolean;
  plazo_horas: number;
};

function parseMs(iso: string | null): number | null {
  if (iso == null || String(iso).trim() === "") return null;
  const t = Date.parse(String(iso));
  return Number.isFinite(t) ? t : null;
}

/** Si la config no trae valor válido, coincide con default en BD (48). */
export function normalizePlazoCancelacionHoras(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 48;
  const h = Math.floor(n);
  if (h < 1) return 1;
  if (h > 8760) return 8760;
  return h;
}

export function buildSifenCancelacionPreview(ctx: SifenCancelacionContext): SifenCancelacionPreview {
  const estado = ctx.estadoSifen == null ? "" : String(ctx.estadoSifen).trim();
  const plazo_horas = normalizePlazoCancelacionHoras(ctx.plazoHoras);
  const tiene_pagos = ctx.pagosCount > 0;

  if (estado === "cancelado" || ctx.sifenCanceladoAtIso) {
    return {
      puede_cancelar: false,
      cancelable_hasta: null,
      motivo_bloqueo: "El documento electrónico ya fue cancelado en el ERP.",
      requiere_nota_credito: false,
      tiene_pagos,
      plazo_horas,
    };
  }

  if (estado !== "aprobado") {
    return {
      puede_cancelar: false,
      cancelable_hasta: null,
      motivo_bloqueo: "Solo se puede cancelar un DE en estado «aprobado» por SET.",
      requiere_nota_credito: false,
      tiene_pagos,
      plazo_horas,
    };
  }

  const aprobadoMs = parseMs(ctx.sifenAprobadoAtIso);
  if (aprobadoMs == null) {
    return {
      puede_cancelar: false,
      cancelable_hasta: null,
      motivo_bloqueo:
        "No hay marca de aprobación SET (sifen_aprobado_at). Ejecute «Consultar lote SET» para sincronizar el estado.",
      requiere_nota_credito: true,
      tiene_pagos,
      plazo_horas,
    };
  }

  const limiteMs = aprobadoMs + plazo_horas * 60 * 60 * 1000;
  const cancelable_hasta = new Date(limiteMs).toISOString();

  if (tiene_pagos) {
    return {
      puede_cancelar: false,
      cancelable_hasta,
      motivo_bloqueo: "La factura tiene pagos registrados; no aplica cancelación del DE en ventana corta.",
      requiere_nota_credito: true,
      tiene_pagos,
      plazo_horas,
    };
  }

  if (ctx.nowMs > limiteMs) {
    return {
      puede_cancelar: false,
      cancelable_hasta,
      motivo_bloqueo: "Venció el plazo de cancelación desde la aprobación SET.",
      requiere_nota_credito: true,
      tiene_pagos,
      plazo_horas,
    };
  }

  return {
    puede_cancelar: true,
    cancelable_hasta,
    motivo_bloqueo: null,
    requiere_nota_credito: false,
    tiene_pagos,
    plazo_horas,
  };
}
