"use client";

import { useMemo } from "react";
import type { ObligacionCatalogoApi } from "@/lib/api/client";
import type { PerfilTributarioCliente } from "@/lib/clientes/types";
import MontoInput from "@/components/ui/MontoInput";

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm";
const labelClass = "block text-xs font-medium text-slate-500 mb-1";

export type TributarioFormState = {
  perfil_activo: boolean;
  dv: string;
  razon_social_fiscal: string;
  /** Vacío = no cambiar en servidor; usar `clear_clave` para borrar */
  clave_tributaria: string;
  clear_clave_tributaria: boolean;
  /** Día del 1 al 31 o "" = vacío. */
  dia_vencimiento_tributario: string;
  honorario_mensual: string;
  honorario_anual: string;
  notas_tributarias: string;
  obligacion_catalogo_ids: string[];
  obligacion_otro_detalle: string;
};

export function formStateFromPerfil(p: PerfilTributarioCliente | null | undefined): TributarioFormState {
  if (!p) return emptyTributarioForm();
  return {
    perfil_activo: p.perfil_activo,
    dv: p.dv ?? "",
    razon_social_fiscal: p.razon_social_fiscal ?? "",
    clave_tributaria: "",
    clear_clave_tributaria: false,
    dia_vencimiento_tributario:
      p.dia_vencimiento_tributario != null && p.dia_vencimiento_tributario !== 0
        ? String(p.dia_vencimiento_tributario)
        : "",
    honorario_mensual: p.honorario_mensual != null ? String(p.honorario_mensual) : "",
    honorario_anual: p.honorario_anual != null ? String(p.honorario_anual) : "",
    notas_tributarias: p.notas_tributarias ?? "",
    obligacion_catalogo_ids: p.obligaciones.map((o) => o.id),
    obligacion_otro_detalle: p.obligacion_otro_detalle ?? "",
  };
}

/** `null` si el día es vacío o un entero 1-31; error si el perfil está activo y el valor es inválido. */
export function getErrorDiaVencimientoTributario(f: TributarioFormState): string | null {
  if (!f.perfil_activo) return null;
  const s = f.dia_vencimiento_tributario.trim();
  if (s === "") return null;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 1 || n > 31) {
    return "Indicá un entero del 1 al 31, o dejá vacío el día de vencimiento tributario.";
  }
  return null;
}

export function emptyTributarioForm(): TributarioFormState {
  return {
    perfil_activo: false,
    dv: "",
    razon_social_fiscal: "",
    clave_tributaria: "",
    clear_clave_tributaria: false,
    dia_vencimiento_tributario: "",
    honorario_mensual: "",
    honorario_anual: "",
    notas_tributarias: "",
    obligacion_catalogo_ids: [],
    obligacion_otro_detalle: "",
  };
}

type Props = {
  catalog: ObligacionCatalogoApi[];
  value: TributarioFormState;
  onChange: (next: TributarioFormState) => void;
  /** Refuerzo: el RUC visible está en identificación (empresa). */
  tipoCliente: "empresa" | "persona";
  claveYaConfigurada?: boolean;
};

export function ClientePerfilTributarioForm({
  catalog,
  value,
  onChange,
  tipoCliente,
  claveYaConfigurada,
}: Props) {
  const otroMeta = useMemo(() => catalog.find((c) => c.slug === "otro"), [catalog]);
  const muestraOtroDetalle =
    otroMeta && value.obligacion_catalogo_ids.includes(otroMeta.id);

  function toggleObl(id: string, checked: boolean) {
    const set = new Set(value.obligacion_catalogo_ids);
    if (checked) set.add(id);
    else set.delete(id);
    onChange({ ...value, obligacion_catalogo_ids: [...set] });
  }

  return (
    <div className="rounded-xl border border-indigo-100 bg-gradient-to-b from-indigo-50/40 to-white p-5 space-y-5 shadow-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-900/70">Perfil tributario</p>
          <p className="text-sm text-slate-600 mt-1">
            Opcional. Datos para cumplimiento y honorarios profesionales; no sustituye la identificación comercial del cliente.
          </p>
        </div>
        <label className="flex items-center gap-3 cursor-pointer select-none shrink-0 mt-2 sm:mt-0">
          <span className="text-sm font-medium text-slate-700">Este cliente tiene perfil tributario</span>
          <button
            type="button"
            role="switch"
            aria-checked={value.perfil_activo}
            onClick={() => onChange({ ...value, perfil_activo: !value.perfil_activo })}
            className={`relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors ${
              value.perfil_activo ? "bg-indigo-600" : "bg-slate-300"
            }`}
          >
            <span
              className={`inline-block h-6 w-6 translate-y-0.5 rounded-full bg-white shadow transition-transform ${
                value.perfil_activo ? "translate-x-5" : "translate-x-1"
              }`}
            />
          </button>
        </label>
      </div>

      {value.perfil_activo && (
        <>
          {tipoCliente === "empresa" && (
            <p className="text-xs text-slate-500 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
              El <strong>RUC</strong> principal del cliente se registra en <strong>Datos de identificación</strong> arriba;
              aquí podés complementar <strong>dígito verificador</strong> y <strong>razón social fiscal</strong> si difieren del nombre comercial.
            </p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>DV (opcional)</label>
              <input
                type="text"
                value={value.dv}
                onChange={(e) => onChange({ ...value, dv: e.target.value })}
                className={inputClass}
                placeholder="Si aplica, separado del RUC"
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelClass}>Razón social fiscal (opcional)</label>
              <input
                type="text"
                value={value.razon_social_fiscal}
                onChange={(e) => onChange({ ...value, razon_social_fiscal: e.target.value })}
                className={`${inputClass} uppercase`}
                placeholder="Si difiere de la razón social comercial"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Clave / contraseña tributaria</label>
              <input
                type="password"
                value={value.clave_tributaria}
                onChange={(e) => onChange({ ...value, clave_tributaria: e.target.value, clear_clave_tributaria: false })}
                className={inputClass}
                placeholder={claveYaConfigurada ? "••••••••  (vacío = no cambiar)" : "Se guarda cifrada en el servidor"}
                autoComplete="new-password"
              />
              {claveYaConfigurada && (
                <label className="flex items-center gap-2 mt-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={value.clear_clave_tributaria}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        clear_clave_tributaria: e.target.checked,
                        clave_tributaria: e.target.checked ? "" : value.clave_tributaria,
                      })
                    }
                  />
                  Eliminar clave almacenada
                </label>
              )}
            </div>
            <div>
              <label className={labelClass}>Día de vencimiento tributario</label>
              <input
                type="number"
                min={1}
                max={31}
                value={value.dia_vencimiento_tributario}
                onChange={(e) => onChange({ ...value, dia_vencimiento_tributario: e.target.value.replace(/[^0-9]/g, "") })}
                className={inputClass}
                placeholder="Ej. 7"
                autoComplete="off"
              />
              <p className="mt-1 text-[11px] text-slate-500">Día del mes en que vence habitualmente la obligación tributaria.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Honorario mensual (Gs.)</label>
              <MontoInput
                value={value.honorario_mensual}
                onChange={(n) => onChange({ ...value, honorario_mensual: String(n) })}
                className={inputClass}
                decimals={false}
              />
            </div>
            <div>
              <label className={labelClass}>Honorario anual (Gs.)</label>
              <MontoInput
                value={value.honorario_anual}
                onChange={(n) => onChange({ ...value, honorario_anual: String(n) })}
                className={inputClass}
                decimals={false}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Obligaciones</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
              {catalog.map((c) => (
                <label key={c.id} className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 rounded border-slate-300"
                    checked={value.obligacion_catalogo_ids.includes(c.id)}
                    onChange={(e) => toggleObl(c.id, e.target.checked)}
                  />
                  <span>{c.nombre}</span>
                </label>
              ))}
            </div>
          </div>

          {muestraOtroDetalle && (
            <div>
              <label className={labelClass}>Detalle para &quot;Otro&quot;</label>
              <input
                type="text"
                value={value.obligacion_otro_detalle}
                onChange={(e) => onChange({ ...value, obligacion_otro_detalle: e.target.value })}
                className={inputClass}
                placeholder="Especificá la obligación u otra referencia"
              />
            </div>
          )}

          <div>
            <label className={labelClass}>Notas internas tributarias</label>
            <textarea
              value={value.notas_tributarias}
              onChange={(e) => onChange({ ...value, notas_tributarias: e.target.value })}
              className={`${inputClass} min-h-[72px]`}
              rows={3}
              placeholder="Solo equipo interno; no se exponen en listados."
            />
          </div>
        </>
      )}
    </div>
  );
}

/** Construye el cuerpo PUT para `/api/clientes/:id/perfil-tributario`. */
export function buildPerfilTributarioPutBody(f: TributarioFormState): Record<string, unknown> {
  const honorM = f.honorario_mensual.trim() ? parseFloat(f.honorario_mensual) : null;
  const honorA = f.honorario_anual.trim() ? parseFloat(f.honorario_anual) : null;
  const diaS = f.dia_vencimiento_tributario.trim();
  const diaN = diaS === "" ? null : parseInt(diaS, 10);

  const body: Record<string, unknown> = {
    perfil_activo: f.perfil_activo,
    dv: f.dv.trim() || null,
    razon_social_fiscal: f.razon_social_fiscal.trim() || null,
    dia_vencimiento_tributario: Number.isFinite(diaN) ? diaN : null,
    honorario_mensual: Number.isFinite(honorM) ? honorM : null,
    honorario_anual: Number.isFinite(honorA) ? honorA : null,
    notas_tributarias: f.notas_tributarias.trim() || null,
    obligacion_catalogo_ids: f.obligacion_catalogo_ids,
    obligacion_otro_detalle: f.obligacion_otro_detalle.trim() || null,
  };

  if (f.clear_clave_tributaria) {
    body.clave_tributaria = null;
  } else if (f.clave_tributaria.trim()) {
    body.clave_tributaria = f.clave_tributaria.trim();
  }

  return body;
}
