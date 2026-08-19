"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAutoClearFlag } from "@/hooks/useAutoClearFlag";

type Modo = "sin_factura_fiscal" | "sifen" | "autoimpresor";
type Impresion = "pdf_a4" | "pdf_media_hoja" | "ticket_80mm" | "ticket_58mm";

interface FacturacionModo {
  modo: Modo;
  impresion_tipo_default: Impresion;
  imprimir_al_confirmar: boolean;
  preguntar_datos_al_confirmar: boolean;
  activo: boolean;
}

interface Autoimpresor {
  activo: boolean;
  ruc_emisor: string | null;
  razon_social_emisor: string | null;
  nombre_fantasia: string | null;
  direccion_matriz: string | null;
  telefono: string | null;
  timbrado_numero: string | null;
  timbrado_inicio_vigencia: string | null;
  timbrado_fin_vigencia: string | null;
  establecimiento_codigo: string | null;
  punto_expedicion_codigo: string | null;
  numero_actual: number | null;
  numero_inicial: number | null;
  numero_final: number | null;
  formato_impresion_default: Impresion;
  leyenda_papel_termico: string | null;
  observaciones: string | null;
}

const modoCards: Array<{ key: Modo; titulo: string; resumen: string }> = [
  { key: "sin_factura_fiscal", titulo: "Sin factura fiscal", resumen: "Solo registra ventas internas. Sin documento fiscal." },
  { key: "sifen", titulo: "Facturación electrónica SIFEN", resumen: "Emite Documentos Electrónicos a través del Set/SIFEN." },
  { key: "autoimpresor", titulo: "Autoimpresor / factura impresa", resumen: "Emite factura impresa con timbrado autorizado (PDF o ticket térmico)." },
];

const impresionLabels: Record<Impresion, string> = {
  pdf_a4: "PDF A4",
  pdf_media_hoja: "PDF media hoja",
  ticket_80mm: "Ticket térmico 80 mm",
  ticket_58mm: "Ticket térmico 58 mm",
};

const inputClass = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white";
const labelClass = "block text-xs font-medium text-slate-600 mb-1";

export default function FacturacionModoSection() {
  const [modo, setModo] = useState<FacturacionModo | null>(null);
  const [auto, setAuto] = useState<Autoimpresor | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingModo, setSavingModo] = useState(false);
  const [savingAuto, setSavingAuto] = useState(false);
  const [errModo, setErrModo] = useState<string | null>(null);
  const [errAuto, setErrAuto] = useState<string | null>(null);
  // Toast "Guardado" auto-limpiable a 1.5s. useAutoClearFlag cancela el timer en unmount.
  const [okModo, setOkModo] = useAutoClearFlag<string>(1500);
  const [okAuto, setOkAuto] = useAutoClearFlag<string>(1500);

  const cargar = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setErrModo(null); setErrAuto(null);
    try {
      const [m, a] = await Promise.all([
        fetch("/api/configuracion/facturacion-modo", {
          credentials: "include",
          cache: "no-store",
          signal,
        }).then((r) => r.json()),
        fetch("/api/configuracion/autoimpresor", {
          credentials: "include",
          cache: "no-store",
          signal,
        }).then((r) => r.json()),
      ]);
      if (signal?.aborted) return;
      if (m?.success) setModo(m.data.facturacion_modo as FacturacionModo);
      else setErrModo(m?.error ?? "Error al cargar modo");
      if (a?.success) setAuto(a.data.autoimpresor as Autoimpresor);
      else setErrAuto(a?.error ?? "Error al cargar autoimpresor");
    } catch (e) {
      // AbortError: el caller cambio de tab antes que termine la carga; no toques estado.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setErrModo(e instanceof Error ? e.message : "Error de red");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void cargar(ctrl.signal);
    return () => ctrl.abort();
  }, [cargar]);

  async function guardarModo(patch: Partial<FacturacionModo>) {
    if (!modo) return;
    setSavingModo(true); setErrModo(null); setOkModo(null);
    try {
      const r = await fetch("/api/configuracion/facturacion-modo", {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) { setErrModo(j?.error ?? "No se pudo guardar"); return; }
      setModo(j.data.facturacion_modo as FacturacionModo);
      setOkModo("Guardado ✓");
      // El reset a null lo hace useAutoClearFlag (1.5s, con cleanup en unmount).
    } catch (e) { setErrModo(e instanceof Error ? e.message : "Error de red"); }
    finally { setSavingModo(false); }
  }

  async function guardarAuto(patch: Partial<Autoimpresor>) {
    if (!auto) return;
    setSavingAuto(true); setErrAuto(null); setOkAuto(null);
    try {
      const r = await fetch("/api/configuracion/autoimpresor", {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) { setErrAuto(j?.error ?? "No se pudo guardar"); return; }
      setAuto(j.data.autoimpresor as Autoimpresor);
      setOkAuto("Guardado ✓");
      // Reset a null por useAutoClearFlag (1.5s, cleanup garantizado).
    } catch (e) { setErrAuto(e instanceof Error ? e.message : "Error de red"); }
    finally { setSavingAuto(false); }
  }

  if (loading || !modo || !auto) {
    return <div className="p-6 text-sm text-slate-400">Cargando configuración fiscal...</div>;
  }

  const esTicket = modo.impresion_tipo_default === "ticket_80mm" || modo.impresion_tipo_default === "ticket_58mm";

  return (
    <div className="space-y-6">
      {/* MODO */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-800">Modo de facturación</h3>
          {okModo && <span className="text-xs text-emerald-600">{okModo}</span>}
        </div>
        {errModo && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 mb-3">{errModo}</p>}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {modoCards.map((c) => {
            const sel = modo.modo === c.key;
            return (
              <button
                key={c.key}
                type="button"
                disabled={savingModo}
                onClick={() => guardarModo({ modo: c.key })}
                className={`text-left rounded-xl border p-4 transition-colors ${
                  sel ? "border-sky-400 bg-sky-50 ring-2 ring-sky-200" : "border-slate-200 hover:border-sky-200 hover:bg-slate-50"
                } disabled:opacity-50`}
              >
                <div className="flex items-center gap-2">
                  <span className={`h-3 w-3 rounded-full ${sel ? "bg-sky-500" : "bg-slate-300"}`} />
                  <span className="font-semibold text-sm text-slate-800">{c.titulo}</span>
                </div>
                <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">{c.resumen}</p>
              </button>
            );
          })}
        </div>

        {/* Detalle según modo */}
        <div className="mt-4">
          {modo.modo === "sin_factura_fiscal" && (
            <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
              Al confirmar una venta solo se registra internamente. No se emite documento fiscal.
            </div>
          )}
          {modo.modo === "sifen" && (
            <div className="text-xs text-slate-600 bg-sky-50 border border-sky-200 rounded-lg p-3 flex items-center justify-between gap-3">
              <span>Las ventas confirmadas se emiten como Documentos Electrónicos al SIFEN. La configuración de timbrado, certificado y branding KuDE se administra desde la pantalla SIFEN.</span>
              <Link href="/configuracion/facturacion-electronica" className="shrink-0 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-medium">
                Abrir configuración SIFEN →
              </Link>
            </div>
          )}
          {modo.modo === "autoimpresor" && (
            <div className="text-xs text-slate-600 bg-amber-50 border border-amber-200 rounded-lg p-3">
              Configurá abajo timbrado autorizado, establecimiento, punto de expedición y rango de numeración. Sin estos datos no se podrán emitir facturas impresas.
            </div>
          )}
        </div>

        {/* Tipo de impresión default */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Tipo de impresión por defecto</label>
            <select
              value={modo.impresion_tipo_default}
              onChange={(e) => guardarModo({ impresion_tipo_default: e.target.value as Impresion })}
              disabled={savingModo}
              className={inputClass}
            >
              {(Object.keys(impresionLabels) as Impresion[]).map((k) => (
                <option key={k} value={k}>{impresionLabels[k]}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-400">
              {esTicket
                ? "Ticket térmico: formato optimizado para impresoras 58/80 mm. La impresión usa la ventana del navegador."
                : "PDF: imprime usando el navegador. Apto para impresoras tradicionales."}
            </p>
          </div>
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={modo.preguntar_datos_al_confirmar}
                onChange={(e) => guardarModo({ preguntar_datos_al_confirmar: e.target.checked })}
                disabled={savingModo}
              />
              Pedir datos del comprador al confirmar venta
            </label>
          </div>
        </div>
      </div>

      {/* AUTOIMPRESOR (solo si modo=autoimpresor) */}
      {modo.modo === "autoimpresor" && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-800">Datos del autoimpresor / timbrado</h3>
            {okAuto && <span className="text-xs text-emerald-600">{okAuto}</span>}
          </div>
          {errAuto && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 mb-3">{errAuto}</p>}

          <AutoimpresorForm value={auto} onSave={guardarAuto} saving={savingAuto} />
        </div>
      )}
    </div>
  );
}

function AutoimpresorForm({
  value, onSave, saving,
}: { value: Autoimpresor; onSave: (p: Partial<Autoimpresor>) => Promise<void>; saving: boolean }) {
  const [f, setF] = useState<Autoimpresor>(value);
  useEffect(() => { setF(value); }, [value]);
  const set = <K extends keyof Autoimpresor>(k: K, v: Autoimpresor[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const esTicket = f.formato_impresion_default === "ticket_80mm" || f.formato_impresion_default === "ticket_58mm";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSave(f);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={f.activo} onChange={(e) => set("activo", e.target.checked)} />
        Autoimpresor activo
      </label>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="RUC emisor"><input className={inputClass} value={f.ruc_emisor ?? ""} onChange={(e) => set("ruc_emisor", e.target.value || null)} /></Field>
        <Field label="Razón social"><input className={`${inputClass} uppercase`} value={f.razon_social_emisor ?? ""} onChange={(e) => set("razon_social_emisor", e.target.value || null)} /></Field>
        <Field label="Nombre fantasía"><input className={`${inputClass} uppercase`} value={f.nombre_fantasia ?? ""} onChange={(e) => set("nombre_fantasia", e.target.value || null)} /></Field>
        <Field label="Dirección" className="md:col-span-2"><input className={`${inputClass} uppercase`} value={f.direccion_matriz ?? ""} onChange={(e) => set("direccion_matriz", e.target.value || null)} /></Field>
        <Field label="Teléfono"><input className={inputClass} value={f.telefono ?? ""} onChange={(e) => set("telefono", e.target.value || null)} /></Field>
      </div>

      <div className="border-t border-slate-100 pt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Timbrado N°"><input className={inputClass} value={f.timbrado_numero ?? ""} onChange={(e) => set("timbrado_numero", e.target.value || null)} /></Field>
        <Field label="Inicio vigencia"><input type="date" className={inputClass} value={f.timbrado_inicio_vigencia ?? ""} onChange={(e) => set("timbrado_inicio_vigencia", e.target.value || null)} /></Field>
        <Field label="Fin vigencia"><input type="date" className={inputClass} value={f.timbrado_fin_vigencia ?? ""} onChange={(e) => set("timbrado_fin_vigencia", e.target.value || null)} /></Field>
        <Field label="Establecimiento"><input className={inputClass} placeholder="001" value={f.establecimiento_codigo ?? ""} onChange={(e) => set("establecimiento_codigo", e.target.value || null)} /></Field>
        <Field label="Punto de expedición"><input className={inputClass} placeholder="001" value={f.punto_expedicion_codigo ?? ""} onChange={(e) => set("punto_expedicion_codigo", e.target.value || null)} /></Field>
        <div />
        <Field label="N° inicial"><input type="number" min={1} className={inputClass} value={f.numero_inicial ?? ""} onChange={(e) => set("numero_inicial", e.target.value ? parseInt(e.target.value, 10) : null)} /></Field>
        <Field label="N° actual"><input type="number" min={1} className={inputClass} value={f.numero_actual ?? ""} onChange={(e) => set("numero_actual", e.target.value ? parseInt(e.target.value, 10) : null)} /></Field>
        <Field label="N° final"><input type="number" min={1} className={inputClass} value={f.numero_final ?? ""} onChange={(e) => set("numero_final", e.target.value ? parseInt(e.target.value, 10) : null)} /></Field>
      </div>

      <div className="border-t border-slate-100 pt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Formato de impresión">
          <select className={inputClass} value={f.formato_impresion_default} onChange={(e) => set("formato_impresion_default", e.target.value as Impresion)}>
            {(Object.keys(impresionLabels) as Impresion[]).map((k) => (
              <option key={k} value={k}>{impresionLabels[k]}</option>
            ))}
          </select>
        </Field>
        {esTicket && (
          <Field label="Leyenda papel térmico (pie)">
            <input className={inputClass} placeholder="GRACIAS POR SU COMPRA" value={f.leyenda_papel_termico ?? ""} onChange={(e) => set("leyenda_papel_termico", e.target.value || null)} />
          </Field>
        )}
        <Field label="Observaciones" className="md:col-span-2">
          <textarea className={`${inputClass} min-h-[60px]`} value={f.observaciones ?? ""} onChange={(e) => set("observaciones", e.target.value || null)} />
        </Field>
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
          {saving ? "Guardando..." : "Guardar autoimpresor"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  );
}
