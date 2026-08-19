"use client";

/**
 * ArqueoDenominaciones — planilla de conteo físico de efectivo por
 * denominación (monedas y billetes). Reutilizable en apertura y cierre de caja.
 *
 * - Solo la columna "Cantidad" es editable; "Valor" = denominación × cantidad
 *   se calcula automáticamente (solo lectura).
 * - Cantidad 0 permitida; negativas NO (se clampean a 0).
 * - Muestra el total contado en tiempo real.
 * - Las denominaciones base viven en @/lib/caja/denominaciones (no acá).
 */

import { DENOMINACIONES, type ArqueoItem, type TipoDenominacion } from "@/lib/caja/denominaciones";

function fmtGs(v: number) {
  return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`;
}

/** Estado del arqueo como mapa denominación → cantidad (lo que maneja el padre). */
export type ArqueoCantidades = Record<number, number>;

/** Convierte el mapa de cantidades al detalle ArqueoItem[] para enviar al backend. */
export function cantidadesAArqueo(cant: ArqueoCantidades): ArqueoItem[] {
  return DENOMINACIONES.map((d) => {
    const cantidad = Math.max(0, Math.floor(cant[d.valor] || 0));
    return { tipo: d.tipo, denominacion: d.valor, cantidad, valor: d.valor * cantidad };
  });
}

/** Total contado desde el mapa de cantidades. */
export function totalArqueo(cant: ArqueoCantidades): number {
  return cantidadesAArqueo(cant).reduce((s, it) => s + it.valor, 0);
}

/** Mapa vacío inicial (todas las denominaciones en 0). */
export function arqueoVacio(): ArqueoCantidades {
  const m: ArqueoCantidades = {};
  for (const d of DENOMINACIONES) m[d.valor] = 0;
  return m;
}

export default function ArqueoDenominaciones({
  value,
  onChange,
  disabled,
}: {
  value: ArqueoCantidades;
  onChange: (next: ArqueoCantidades) => void;
  disabled?: boolean;
}) {
  const total = totalArqueo(value);

  function setCantidad(denominacion: number, raw: string) {
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    onChange({ ...value, [denominacion]: n });
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PanelDenom titulo="Monedas" tipo="moneda" value={value} onSet={setCantidad} disabled={disabled} />
        <PanelDenom titulo="Billetes" tipo="billete" value={value} onSet={setCantidad} disabled={disabled} />
      </div>
      <div className="mt-3 flex items-center justify-between rounded-xl border-2 border-[#4FAEB2]/40 bg-[#E5F4F4] px-4 py-3">
        <span className="text-sm font-bold uppercase tracking-wide text-[#3F8E91]">Total contado</span>
        <span className="text-lg font-bold tabular-nums text-[#3F8E91]">{fmtGs(total)}</span>
      </div>
    </div>
  );
}

function PanelDenom({
  titulo,
  tipo,
  value,
  onSet,
  disabled,
}: {
  titulo: string;
  tipo: TipoDenominacion;
  value: ArqueoCantidades;
  onSet: (denominacion: number, raw: string) => void;
  disabled?: boolean;
}) {
  const filas = DENOMINACIONES.filter((d) => d.tipo === tipo);
  return (
    <div className="rounded-xl border-2 border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between bg-slate-100/80 px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">{titulo}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Cant. · Valor</span>
      </div>
      <div className="divide-y divide-slate-100">
        {filas.map((d) => {
          const cantidad = Math.max(0, Math.floor(value[d.valor] || 0));
          return (
            <div key={d.valor} className="flex items-center gap-2 px-3 py-2">
              <span className="w-24 shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-slate-700">{fmtGs(d.valor)}</span>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                disabled={disabled}
                value={cantidad === 0 ? "" : cantidad}
                placeholder="0"
                onChange={(e) => onSet(d.valor, e.target.value)}
                onFocus={(e) => e.target.select()}
                className="w-16 shrink-0 rounded-lg border-2 border-slate-200 px-2 py-1.5 text-center text-sm font-semibold tabular-nums outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 disabled:bg-slate-50 disabled:text-slate-400"
              />
              <span className="ml-auto whitespace-nowrap text-right text-sm tabular-nums font-semibold text-slate-800">
                {fmtGs(d.valor * cantidad)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
