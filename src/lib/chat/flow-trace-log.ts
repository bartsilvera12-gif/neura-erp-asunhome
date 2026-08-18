/**
 * Trazas estructuradas para diagnosticar mezcla de sesiones / datos de flujo en producción.
 * Buscar en logs: [flow-trace]
 *
 * FLOW_TRACE_VERBOSE=1 → incluye muestras de field_value en mapas (evitar en HIPAA sin filtrar).
 */
const PREFIX = "[flow-trace]" as const;

export function isFlowTraceVerbose(): boolean {
  return process.env.FLOW_TRACE_VERBOSE === "1" || process.env.FLOW_TRACE_VERBOSE === "true";
}

/** Claves que suelen explicar mezclas en sorteo (valores truncados si verbose). */
const TRACE_VALUE_KEYS =
  /^(sorteo_|cantidad|monto|opcion|promo|precio|nombre|apellido|cedula|ciudad|comprobante|numeros_|numero_orden|cupon)/i;

export function summarizeFlowDataForTrace(data: Record<string, string>): {
  keys: string[];
  samples?: Record<string, string>;
} {
  const keys = Object.keys(data).sort();
  if (!isFlowTraceVerbose()) {
    return { keys };
  }
  const samples: Record<string, string> = {};
  for (const k of keys) {
    if (TRACE_VALUE_KEYS.test(k)) {
      const v = (data[k] ?? "").trim();
      samples[k] = v.length > 120 ? `${v.slice(0, 120)}…` : v;
    }
  }
  return { keys, samples };
}

export function flowTrace(phase: string, payload: Record<string, unknown>): void {
  const line = {
    phase,
    ts: new Date().toISOString(),
    ...payload,
  };
  try {
    console.info(PREFIX, JSON.stringify(line));
  } catch {
    console.info(PREFIX, phase, payload);
  }
}
