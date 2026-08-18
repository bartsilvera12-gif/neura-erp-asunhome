import "server-only";

export type HistorialRow = {
  entered_at: string;
  exited_at: string | null;
  duration_seconds: number | null;
  tipo_sla_snapshot: string | null;
  estado_nuevo_id: string;
};

export type SlaTotales = {
  segundos_totales_proyecto: number;
  segundos_interno: number;
  segundos_cliente: number;
  segundos_pausado: number;
  segundos_abierto_actual: number;
  tipo_abierto: string | null;
};

export function computeSlaTotales(
  rows: HistorialRow[],
  nowMs: number = Date.now()
): SlaTotales {
  let interno = 0;
  let cliente = 0;
  let pausado = 0;
  let abierto = 0;
  let tipoAbierto: string | null = null;
  let total = 0;

  for (const r of rows) {
    const tipo = (r.tipo_sla_snapshot ?? "interno").trim();
    let sec = r.duration_seconds ?? 0;
    if (r.exited_at == null && r.entered_at) {
      const entered = Date.parse(r.entered_at);
      if (Number.isFinite(entered)) {
        sec = Math.floor((nowMs - entered) / 1000);
        abierto = sec;
        tipoAbierto = tipo;
      }
    }
    total += sec;

    if (tipo === "final") continue;
    if (tipo === "interno") interno += sec;
    else if (tipo === "cliente") cliente += sec;
    else if (tipo === "pausado") pausado += sec;
  }

  return {
    segundos_totales_proyecto: total,
    segundos_interno: interno,
    segundos_cliente: cliente,
    segundos_pausado: pausado,
    segundos_abierto_actual: abierto,
    tipo_abierto: tipoAbierto,
  };
}
