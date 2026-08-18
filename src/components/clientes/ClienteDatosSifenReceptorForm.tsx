"use client";

import type { Cliente } from "@/lib/clientes/types";

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm";
const labelClass = "block text-xs font-medium text-slate-500 mb-1";

/** Valores alineados a `tiNatRec` / naturaleza comercial en el DE (SET v150). */
const NATURALEZA_OPTS = [
  { value: "contribuyente_paraguayo", label: "Contribuyente paraguayo (RUC)" },
  { value: "no_contribuyente", label: "No contribuyente (Paraguay)" },
  { value: "extranjero", label: "Extranjero / operación con el exterior" },
] as const;

/** `tiTiOpe` SET: 1 B2B, 2 B2C, 3 B2G, 4 B2F */
const TIPO_OPERACION_OPTS = [
  { value: "1", label: "B2B" },
  { value: "2", label: "B2C" },
  { value: "3", label: "B2G" },
  { value: "4", label: "B2F (operación con el exterior)" },
] as const;

/** `tiTipDocRec` SET 1–6 y 9 */
const TIPO_DOC_OPTS = [
  { value: "1", label: "Cédula paraguaya" },
  { value: "2", label: "Pasaporte" },
  { value: "3", label: "Cédula extranjera" },
  { value: "4", label: "Carnet de residencia" },
  { value: "5", label: "Innominado" },
  { value: "6", label: "Tarjeta diplomática" },
  { value: "9", label: "Otro / identificación tributaria extranjera" },
] as const;

export type ClienteSifenReceptorFormSlice = Pick<
  Cliente,
  | "sifen_receptor_manual"
  | "sifen_receptor_naturaleza"
  | "sifen_ti_ope"
  | "sifen_tipo_doc_receptor"
  | "sifen_codigo_pais"
  | "sifen_num_id_de"
  | "sifen_direccion_de"
  | "sifen_num_casa_de"
  | "sifen_descripcion_tipo_doc"
>;

type Props = {
  value: ClienteSifenReceptorFormSlice;
  onChange: (patch: Partial<ClienteSifenReceptorFormSlice>) => void;
};

export function ClienteDatosSifenReceptorForm({ value, onChange }: Props) {
  const manual = Boolean(value.sifen_receptor_manual);
  const tipoDoc = value.sifen_tipo_doc_receptor != null ? String(value.sifen_tipo_doc_receptor) : "";
  const showDescTipo9 = manual && tipoDoc === "9";
  const tiOpeNum = value.sifen_ti_ope != null ? Number(value.sifen_ti_ope) : null;
  const codigoPaisUp = (value.sifen_codigo_pais ?? "").trim().toUpperCase();
  const nat = value.sifen_receptor_naturaleza ?? "";
  const warnB2FconPRY =
    manual && tiOpeNum === 4 && (codigoPaisUp === "" || codigoPaisUp === "PRY");
  const warnLocalConExtranjero =
    manual && tiOpeNum != null && tiOpeNum !== 4 && codigoPaisUp !== "" && codigoPaisUp !== "PRY";
  const warnNatExtranjeroSinB2F = manual && nat === "extranjero" && tiOpeNum != null && tiOpeNum !== 4;
  const warnNatLocalConB2F =
    manual && (nat === "contribuyente_paraguayo" || nat === "no_contribuyente") && tiOpeNum === 4;

  return (
    <details className="rounded-xl border border-slate-200 bg-slate-50/40 open:bg-white">
      <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wide select-none">
        Datos SIFEN del receptor (avanzado)
      </summary>
      <div className="px-4 pb-4 pt-0 space-y-4 border-t border-slate-100">
        <p className="text-[11px] text-slate-500 leading-snug pt-3">
          Solo aplica a facturación electrónica SIFEN. Si no activás esta opción, el sistema sigue usando la lógica
          automática actual (RUC / documento / bandera receptor extranjero).
        </p>
        <label className="flex items-center gap-2 text-sm text-slate-800 cursor-pointer">
          <input
            type="checkbox"
            checked={manual}
            onChange={(e) => onChange({ sifen_receptor_manual: e.target.checked })}
            className="rounded border-slate-300"
          />
          <span>Usar configuración explícita del receptor para el DE</span>
        </label>

        {manual ? (
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Naturaleza del receptor (SIFEN)</label>
              <select
                className={inputClass}
                value={value.sifen_receptor_naturaleza ?? ""}
                onChange={(e) =>
                  onChange({
                    sifen_receptor_naturaleza:
                      e.target.value === ""
                        ? null
                        : (e.target.value as NonNullable<Cliente["sifen_receptor_naturaleza"]>),
                  })
                }
              >
                <option value="">— Elegir —</option>
                {NATURALEZA_OPTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Tipo de operación (iTiOpe)</label>
              <select
                className={inputClass}
                value={value.sifen_ti_ope != null ? String(value.sifen_ti_ope) : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  onChange({ sifen_ti_ope: v === "" ? null : parseInt(v, 10) });
                }}
              >
                <option value="">— Elegir —</option>
                {TIPO_OPERACION_OPTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Tipo de documento del receptor (iTipIDRec)</label>
              <select
                className={inputClass}
                value={tipoDoc}
                onChange={(e) => {
                  const v = e.target.value;
                  onChange({ sifen_tipo_doc_receptor: v === "" ? null : parseInt(v, 10) });
                }}
              >
                <option value="">— Por defecto según naturaleza —</option>
                {TIPO_DOC_OPTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {showDescTipo9 ? (
              <div>
                <label className={labelClass}>Descripción tipo documento (9–41 caracteres, solo si tipo = Otro)</label>
                <input
                  type="text"
                  className={inputClass}
                  value={value.sifen_descripcion_tipo_doc ?? ""}
                  onChange={(e) => onChange({ sifen_descripcion_tipo_doc: e.target.value })}
                  placeholder="Ej. Identificación tributaria extranjera"
                  maxLength={41}
                />
              </div>
            ) : null}
            <div>
              <label className={labelClass}>Número de documento para el DE</label>
              <input
                type="text"
                className={inputClass}
                value={value.sifen_num_id_de ?? ""}
                onChange={(e) => onChange({ sifen_num_id_de: e.target.value })}
                placeholder="Si vacío, se usa documento o RUC del cliente"
              />
            </div>
            <div>
              <label className={labelClass}>Código país ISO3 (obligatorio si naturaleza = extranjero)</label>
              <input
                type="text"
                className={`${inputClass} uppercase`}
                value={value.sifen_codigo_pais ?? ""}
                onChange={(e) => onChange({ sifen_codigo_pais: e.target.value.toUpperCase() })}
                placeholder="Ej. PER"
                maxLength={3}
              />
            </div>
            <div>
              <label className={labelClass}>Dirección en el DE (gDatRec)</label>
              <input
                type="text"
                className={inputClass}
                value={value.sifen_direccion_de ?? ""}
                onChange={(e) => onChange({ sifen_direccion_de: e.target.value })}
                placeholder="Si vacío, se intenta con la dirección del cliente (si no coincide con el nombre)"
              />
            </div>
            {warnB2FconPRY || warnLocalConExtranjero || warnNatExtranjeroSinB2F || warnNatLocalConB2F ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 leading-snug">
                <div className="font-semibold mb-1">Combinación inválida para SIFEN</div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {warnB2FconPRY ? (
                    <li>Operación B2F requiere país ISO3 distinto de PRY (ej. PER, ARG, BRA).</li>
                  ) : null}
                  {warnLocalConExtranjero ? (
                    <li>Operaciones B2B/B2C/B2G requieren país PRY.</li>
                  ) : null}
                  {warnNatExtranjeroSinB2F ? (
                    <li>Naturaleza “extranjero” requiere operación B2F (4).</li>
                  ) : null}
                  {warnNatLocalConB2F ? (
                    <li>Para B2F use naturaleza “extranjero”; los receptores paraguayos van con B2B/B2C/B2G.</li>
                  ) : null}
                </ul>
              </div>
            ) : null}
            <div>
              <label className={labelClass}>Número de casa en el DE (dNumCasRec)</label>
              <input
                type="number"
                min={0}
                className={inputClass}
                value={value.sifen_num_casa_de != null ? String(value.sifen_num_casa_de) : ""}
                onChange={(e) => {
                  const t = e.target.value.trim();
                  onChange({ sifen_num_casa_de: t === "" ? null : Math.max(0, parseInt(t, 10) || 0) });
                }}
                placeholder="0 si no aplica domicilio con número"
              />
            </div>
          </div>
        ) : null}
      </div>
    </details>
  );
}
