"use client";

import { ChevronDown, Percent } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConfigFormCard,
  ConfigHelpText,
  ConfigMetricCard,
  ConfigSectionTitle,
  F_INPUT,
  F_LABEL,
} from "@/components/config/global-config-primitives";
import { GlobalConfigSubpageShell } from "@/components/config/GlobalConfigSubpageShell";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import {
  getUnknownErrorKeys,
  serializeUnknownError,
} from "@/lib/errors/serialize-unknown-error";

type EscalaRow = {
  id?: string;
  desde_monto: string;
  hasta_monto: string;
  porcentaje_comision: string;
  premio_fijo: string;
};

const BASE_OPTIONS = [
  { value: "pago_registrado", label: "Pago registrado" },
  { value: "factura_emitida", label: "Factura emitida" },
  { value: "factura_pagada", label: "Factura pagada" },
] as const;

const MODO_PERIODO_LABELS: Record<string, string> = {
  mensual_penultimo_dia_habil: "Mensual (penúltimo día hábil)",
};

const POLITICA_ENDPOINT = "/api/comisiones/politica";

const ESCALA_FILA_VACIA: EscalaRow = {
  desde_monto: "0",
  hasta_monto: "",
  porcentaje_comision: "0",
  premio_fijo: "",
};

function nuevoTraceCliente(): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return [...a].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 12);
}

function labelBaseCalculo(value: string): string {
  return BASE_OPTIONS.find((b) => b.value === value)?.label ?? value;
}

function labelModoPeriodo(raw: string): string {
  return MODO_PERIODO_LABELS[raw] ?? raw;
}

function resumenEscalas(rows: EscalaRow[]): string {
  if (rows.length === 0) return "Sin escalas";
  const pct = rows[0]?.porcentaje_comision?.trim() || "0";
  const desde = formatMontoPygResumen(rows[0]?.desde_monto ?? "");
  if (rows.length === 1) return `1 escala · Desde ${desde} · ${pct}%`;
  return `${rows.length} escalas · primera desde ${desde} · ${pct}%`;
}

function formatUltimaActualizacion(iso: unknown): string | null {
  if (typeof iso !== "string" || !iso.trim()) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString("es-PY", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return null;
  }
}

function parseMontoPyg(raw: string, opts?: { nullable?: boolean; label?: string }): number | null {
  const label = opts?.label ?? "Monto";
  const value = (raw ?? "").trim();
  if (!value) return opts?.nullable ? null : 0;

  const cleaned = value
    .replace(/\u00a0/g, "")
    .replace(/₲/g, "")
    .replace(/(?:PYG|GS)\.?/gi, "")
    .replace(/\s+/g, "");

  if (!/^-?[0-9.,]+$/.test(cleaned)) {
    throw new Error(`${label}: ingresá solo números y separadores de miles.`);
  }

  const negative = cleaned.startsWith("-");
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  const hasDot = unsigned.includes(".");
  const hasComma = unsigned.includes(",");
  let normalized = unsigned;

  if (hasDot && hasComma) {
    const lastDot = unsigned.lastIndexOf(".");
    const lastComma = unsigned.lastIndexOf(",");
    const decimalSep = lastDot > lastComma ? "." : ",";
    const thousandsSep = decimalSep === "." ? "," : ".";
    normalized = unsigned.split(thousandsSep).join("").replace(decimalSep, ".");
  } else if (hasDot || hasComma) {
    const sep = hasDot ? "." : ",";
    const parts = unsigned.split(sep);
    if (parts.length > 2) {
      normalized = parts.join("");
    } else {
      const [entero = "", decimal = ""] = parts;
      const looksLikeThousands = decimal.length === 3 && entero.length >= 1 && entero.length <= 3;
      normalized = looksLikeThousands ? `${entero}${decimal}` : `${entero}.${decimal}`;
    }
  }

  const n = Number(`${negative ? "-" : ""}${normalized}`);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${label}: monto inválido.`);
  }
  return n;
}

function formatMontoPygNumber(n: number): string {
  return new Intl.NumberFormat("es-PY", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatMontoPygInput(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return formatMontoPygNumber(n);
}

function formatMontoPygEditable(raw: string): string {
  if (!raw.trim()) return "";
  try {
    const n = parseMontoPyg(raw, { nullable: true });
    return n == null ? "" : formatMontoPygNumber(n);
  } catch {
    return raw;
  }
}

function formatMontoPygResumen(raw: string): string {
  try {
    const n = parseMontoPyg(raw, { nullable: true });
    return n == null ? "—" : `₲ ${formatMontoPygNumber(n)}`;
  } catch {
    return raw.trim() ? `₲ ${raw.trim()}` : "—";
  }
}

function montoPareceMuyBajo(raw: string): boolean {
  try {
    const n = parseMontoPyg(raw, { nullable: true });
    return n != null && n > 0 && n < 1000;
  } catch {
    return false;
  }
}

type PoliticaApiData = {
  politica: Record<string, unknown> | null;
  escalas: Record<string, unknown>[];
  puedeEditar?: boolean;
  canEdit?: boolean;
  rol?: string | null;
};

export default function ConfiguracionComisionesPage() {
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [puedeEditar, setPuedeEditar] = useState(false);
  /** Hay fila persistida en BD (GET devolvió politica con id). */
  const [hayPoliticaGuardada, setHayPoliticaGuardada] = useState(false);
  const [ultimaActualizacionIso, setUltimaActualizacionIso] = useState<string | null>(null);
  const [editExpanded, setEditExpanded] = useState(true);

  const [nombre, setNombre] = useState("Política principal");
  const [activo, setActivo] = useState(true);
  const [baseCalculo, setBaseCalculo] = useState<string>("pago_registrado");
  const [timezone, setTimezone] = useState("America/Asuncion");
  const [modoPeriodo, setModoPeriodo] = useState("mensual_penultimo_dia_habil");
  const [escalas, setEscalas] = useState<EscalaRow[]>([ESCALA_FILA_VACIA]);

  const primeraCargaRef = useRef(false);

  const aplicarDatosApi = useCallback((data: PoliticaApiData | undefined, opts?: { inicializarExpanded?: boolean }) => {
    if (!data) return;
    const puedeFlag = data.puedeEditar ?? data.canEdit;
    if (puedeFlag !== undefined) {
      setPuedeEditar(Boolean(puedeFlag));
    }

    const pol = data.politica;
    const esc = data.escalas ?? [];
    const tieneId =
      pol &&
      typeof pol === "object" &&
      "id" in pol &&
      typeof (pol as { id: unknown }).id === "string" &&
      String((pol as { id: string }).id).length > 0;

    setHayPoliticaGuardada(Boolean(tieneId));

    if (pol && typeof pol === "object") {
      setNombre(typeof pol.nombre === "string" ? pol.nombre : "Política principal");
      setActivo(pol.activo !== false);
      setBaseCalculo(typeof pol.base_calculo === "string" ? pol.base_calculo : "pago_registrado");
      setTimezone(typeof pol.timezone === "string" ? pol.timezone : "America/Asuncion");
      setModoPeriodo(
        typeof pol.modo_periodo === "string" ? pol.modo_periodo : "mensual_penultimo_dia_habil"
      );
      const ua = (pol as { updated_at?: unknown }).updated_at;
      setUltimaActualizacionIso(typeof ua === "string" ? ua : null);
    } else {
      setUltimaActualizacionIso(null);
    }

    if (esc.length > 0) {
      setEscalas(
        esc.map((r) => ({
          id: typeof r.id === "string" ? r.id : undefined,
          desde_monto: formatMontoPygInput(r.desde_monto ?? "0"),
          hasta_monto: r.hasta_monto != null ? formatMontoPygInput(r.hasta_monto) : "",
          porcentaje_comision: String(r.porcentaje_comision ?? "0"),
          premio_fijo: r.premio_fijo != null ? formatMontoPygInput(r.premio_fijo) : "",
        }))
      );
    } else if (!tieneId) {
      setEscalas([{ ...ESCALA_FILA_VACIA }]);
    }

    if (opts?.inicializarExpanded === true && !primeraCargaRef.current) {
      primeraCargaRef.current = true;
      setEditExpanded(!tieneId);
    }
  }, []);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    const traceCliente = nuevoTraceCliente();
    try {
      const res = await fetchWithSupabaseSession(POLITICA_ENDPOINT, {
        cache: "no-store",
        headers: { "X-Client-Trace-Id": traceCliente },
      });

      const rawText = await res.text();
      let parsed: unknown = null;
      try {
        parsed = rawText.trim() ? JSON.parse(rawText) : null;
      } catch {
        parsed = null;
      }
      const json =
        parsed && typeof parsed === "object"
          ? (parsed as {
              success?: boolean;
              traceId?: string;
              data?: PoliticaApiData;
              error?: string;
            })
          : null;

      const traceServidor = typeof json?.traceId === "string" ? json.traceId : null;
      const traceMostrar = traceServidor ?? traceCliente;

      if (!res.ok) {
        const apiErr =
          typeof json?.error === "string"
            ? json.error
            : rawText.replace(/\s+/g, " ").trim().slice(0, 320) || "(cuerpo vacío o no JSON)";
        setError(
          `Error al cargar ${POLITICA_ENDPOINT} — ${res.status} ${res.statusText} — ${apiErr} — trace ${traceMostrar}`
        );
        return;
      }

      if (json?.success !== true) {
        const detalle =
          typeof json?.error === "string"
            ? json.error
            : rawText.replace(/\s+/g, " ").trim().slice(0, 280) || "success !== true sin mensaje";
        setError(
          `Respuesta inválida ${POLITICA_ENDPOINT} — ${res.status} — ${detalle} — trace ${traceMostrar}`
        );
        return;
      }

      aplicarDatosApi(json.data, { inicializarExpanded: true });
    } catch (e) {
      const serialized = serializeUnknownError(e);
      console.warn("[configuracion/comisiones] cargar excepción", {
        traceId: traceCliente,
        endpoint: POLITICA_ENDPOINT,
        error: serialized,
        errorKeys: getUnknownErrorKeys(e),
      });
      setError(`Excepción al cargar ${POLITICA_ENDPOINT} — ${serialized} — trace ${traceCliente}`);
    } finally {
      setLoading(false);
    }
  }, [aplicarDatosApi]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function handleGuardar() {
    if (!puedeEditar) return;
    setGuardando(true);
    setError(null);
    setSuccess(false);
    try {
      const escalasPayload = escalas.map((row, idx) => ({
        desde_monto: parseMontoPyg(row.desde_monto, { label: `Escala ${idx + 1} desde` }) ?? 0,
        hasta_monto: parseMontoPyg(row.hasta_monto, { nullable: true, label: `Escala ${idx + 1} hasta` }),
        porcentaje_comision: parseFloat(row.porcentaje_comision.replace(",", ".")) || 0,
        premio_fijo: parseMontoPyg(row.premio_fijo, { nullable: true, label: `Escala ${idx + 1} premio fijo` }),
      }));
      const res = await fetchWithSupabaseSession("/api/comisiones/politica", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nombre.trim(),
          activo,
          base_calculo: baseCalculo,
          timezone: timezone.trim() || "America/Asuncion",
          modo_periodo: modoPeriodo.trim() || "mensual_penultimo_dia_habil",
          escalas: escalasPayload,
        }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: PoliticaApiData;
      };
      if (!res.ok || json.success !== true) {
        throw new Error(json.error ?? `Error ${res.status}`);
      }
      if (json.data) {
        aplicarDatosApi(json.data);
      }
      setHayPoliticaGuardada(true);
      setEditExpanded(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 6000);
    } catch (e) {
      const serialized = serializeUnknownError(e);
      console.warn("[configuracion/comisiones] guardar excepción", {
        endpoint: "/api/comisiones/politica",
        error: serialized,
        errorKeys: getUnknownErrorKeys(e),
      });
      setError(serialized || "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  const badgeActivo = (
    <span
      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
        hayPoliticaGuardada
          ? activo
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : "border-slate-200 bg-slate-100 text-slate-600"
          : "border-amber-200 bg-amber-50 text-amber-900"
      }`}
    >
      {!hayPoliticaGuardada ? "Sin guardar" : activo ? "ACTIVA" : "INACTIVA"}
    </span>
  );

  const ultimaTxt = formatUltimaActualizacion(ultimaActualizacionIso);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-slate-400">
        Cargando política de comisiones…
      </div>
    );
  }

  return (
    <GlobalConfigSubpageShell
      title="Comisiones"
      description="Política comercial y escalas por montos. El motor de cálculo se habilitará en una etapa posterior."
    >
      {success && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          Política guardada correctamente.
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {!puedeEditar && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Solo administradores de la empresa pueden editar esta configuración. Podés revisar los valores actuales en el
          resumen y expandiendo la edición.
        </div>
      )}

      {/* Una política por empresa (uq_comision_politicas_empresa). Varias políticas requerirían evolución de esquema. */}
      <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-slate-300">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700">
              <Percent className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-slate-900">{nombre || "Política comercial"}</h2>
              <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Política · empresa actual
              </p>
            </div>
          </div>
          {badgeActivo}
        </div>

        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Define cómo se calcularán las comisiones comerciales de esta empresa.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ConfigMetricCard label="Base de cálculo" value={labelBaseCalculo(baseCalculo)} />
          <ConfigMetricCard label="Escalas" value={resumenEscalas(escalas)} />
          <ConfigMetricCard label="Zona horaria" value={timezone || "—"} />
          <ConfigMetricCard label="Modo de período" value={labelModoPeriodo(modoPeriodo)} sub={modoPeriodo} />
          <ConfigMetricCard
            label="Última actualización"
            value={ultimaTxt ?? "—"}
            sub={!hayPoliticaGuardada ? "Guardá la política para fijar versión en servidor." : undefined}
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={() => setEditExpanded((e) => !e)}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            {editExpanded ? "Ocultar edición" : "Editar configuración"}
            <ChevronDown
              className={`h-4 w-4 shrink-0 transition-transform ${editExpanded ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
          <span className="text-xs text-slate-400">
            {editExpanded ? "Clic para contraer el formulario." : "Clic para expandir y editar campos."}
          </span>
        </div>
      </section>

      {editExpanded && (
        <div className="space-y-5">
          <ConfigFormCard>
            <ConfigSectionTitle>Política</ConfigSectionTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={F_LABEL}>Nombre</label>
                <input
                  type="text"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  disabled={!puedeEditar}
                  className={F_INPUT}
                />
              </div>
              <div>
                <label className={F_LABEL}>Estado</label>
                <select
                  value={activo ? "1" : "0"}
                  onChange={(e) => setActivo(e.target.value === "1")}
                  disabled={!puedeEditar}
                  className={F_INPUT}
                >
                  <option value="1">Activa</option>
                  <option value="0">Inactiva</option>
                </select>
              </div>
              <div>
                <label className={F_LABEL}>Base de cálculo (futuro)</label>
                <select
                  value={baseCalculo}
                  onChange={(e) => setBaseCalculo(e.target.value)}
                  disabled={!puedeEditar}
                  className={F_INPUT}
                >
                  {BASE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <ConfigHelpText>
                  Define la fuente cuando el motor calcule comisiones (habilitación próxima).
                </ConfigHelpText>
              </div>
              <div>
                <label className={F_LABEL}>Zona horaria</label>
                <input
                  type="text"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  disabled={!puedeEditar}
                  className={F_INPUT}
                />
              </div>
              <div>
                <label className={F_LABEL}>Modo de período</label>
                <input
                  type="text"
                  value={modoPeriodo}
                  onChange={(e) => setModoPeriodo(e.target.value)}
                  disabled={!puedeEditar}
                  className={F_INPUT}
                />
                <ConfigHelpText>Valor por defecto del ERP: mensual (penúltimo día hábil).</ConfigHelpText>
              </div>
            </div>
          </ConfigFormCard>

          <ConfigFormCard>
            <ConfigSectionTitle>Escalas</ConfigSectionTitle>
            <p className="mb-3 text-sm text-slate-600">
              Rangos de monto en guaraníes y porcentaje de comisión. Ejemplo: 50.000.000. Dejá «Hasta» vacío para
              indicar sin techo en ese tramo.
            </p>
            <div className="space-y-3">
              {escalas.map((row, idx) => (
                <div
                  key={idx}
                  className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50/80 p-3 sm:grid-cols-12 sm:items-end"
                >
                  <div className="sm:col-span-3">
                    <label className={F_LABEL}>Desde · monto en guaraníes</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="50.000.000"
                      value={row.desde_monto}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEscalas((prev) => prev.map((x, i) => (i === idx ? { ...x, desde_monto: v } : x)));
                      }}
                      onBlur={() =>
                        setEscalas((prev) =>
                          prev.map((x, i) =>
                            i === idx ? { ...x, desde_monto: formatMontoPygEditable(x.desde_monto) } : x
                          )
                        )
                      }
                      disabled={!puedeEditar}
                      className={F_INPUT}
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className={F_LABEL}>Hasta · opcional</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Sin techo"
                      value={row.hasta_monto}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEscalas((prev) => prev.map((x, i) => (i === idx ? { ...x, hasta_monto: v } : x)));
                      }}
                      onBlur={() =>
                        setEscalas((prev) =>
                          prev.map((x, i) =>
                            i === idx ? { ...x, hasta_monto: formatMontoPygEditable(x.hasta_monto) } : x
                          )
                        )
                      }
                      disabled={!puedeEditar}
                      className={F_INPUT}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={F_LABEL}>% comisión</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={row.porcentaje_comision}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEscalas((prev) => prev.map((x, i) => (i === idx ? { ...x, porcentaje_comision: v } : x)));
                      }}
                      disabled={!puedeEditar}
                      className={F_INPUT}
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className={F_LABEL}>Premio fijo · opcional</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="500.000"
                      value={row.premio_fijo}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEscalas((prev) => prev.map((x, i) => (i === idx ? { ...x, premio_fijo: v } : x)));
                      }}
                      onBlur={() =>
                        setEscalas((prev) =>
                          prev.map((x, i) =>
                            i === idx ? { ...x, premio_fijo: formatMontoPygEditable(x.premio_fijo) } : x
                          )
                        )
                      }
                      disabled={!puedeEditar}
                      className={F_INPUT}
                    />
                  </div>
                  <div className="flex justify-end pb-1 sm:col-span-1">
                    {puedeEditar && escalas.length > 1 && (
                      <button
                        type="button"
                        className="text-xs font-medium text-red-600 hover:underline"
                        onClick={() => setEscalas((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                  <div className="sm:col-span-12">
                    <p className="text-xs text-slate-500">
                      Desde {formatMontoPygResumen(row.desde_monto)}
                      {row.hasta_monto.trim() ? ` · Hasta ${formatMontoPygResumen(row.hasta_monto)}` : " · Sin techo"}
                      {row.premio_fijo.trim() ? ` · Premio fijo ${formatMontoPygResumen(row.premio_fijo)}` : ""}
                    </p>
                    {[row.desde_monto, row.hasta_monto, row.premio_fijo].some(montoPareceMuyBajo) && (
                      <p className="mt-1 text-xs text-amber-700">
                        Este monto parece muy bajo. Si querías millones, escribí por ejemplo 50.000.000.
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {puedeEditar && (
              <button
                type="button"
                className="mt-3 text-sm font-medium text-sky-700 hover:underline"
                onClick={() =>
                  setEscalas((prev) => [
                    ...prev,
                    { desde_monto: "0", hasta_monto: "", porcentaje_comision: "0", premio_fijo: "" },
                  ])
                }
              >
                + Agregar escala
              </button>
            )}
          </ConfigFormCard>

          {puedeEditar && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void handleGuardar()}
                disabled={guardando}
                className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-sky-700 disabled:opacity-60"
              >
                {guardando ? "Guardando…" : "Guardar política"}
              </button>
            </div>
          )}
        </div>
      )}
    </GlobalConfigSubpageShell>
  );
}
