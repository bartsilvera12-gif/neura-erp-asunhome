"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { NotaCreditoListItemDTO, SifenPrevueloFacturaNcDTO } from "@/lib/nota-credito/types";

const MSG_BLOQUEO_TIMBRADO_ORIGEN =
  "No se puede generar la NC porque el timbrado de la factura origen es inválido o inconsistente.";

type NcApiGet = {
  success?: boolean;
  data?: {
    items: NotaCreditoListItemDTO[];
    puede_crear: boolean;
    motivo_bloqueo_creacion: string | null;
    sifen_prevuelo_factura?: SifenPrevueloFacturaNcDTO;
  };
  error?: string;
};

function labelEstadoErp(e: string) {
  const m: Record<string, string> = {
    borrador: "Borrador",
    pendiente_envio_sifen: "Pendiente envío SIFEN",
    aprobada: "Aprobada",
    rechazada: "Rechazada",
    error: "Error",
    anulada_borrador: "Anulada (borrador)",
  };
  return m[e] ?? e;
}

function labelEstadoSifen(e: string | null) {
  if (e == null || e === "") return "—";
  const m: Record<string, string> = {
    sin_envio: "Sin envío",
    borrador: "Borrador DE",
    generado: "XML generado",
    firmado: "Firmado",
    enviado: "Enviado a SET",
    en_proceso: "En proceso (SET)",
    aprobado: "Aprobado (SET)",
    rechazado: "Rechazado (SET)",
    error_envio: "Error de envío",
    cancelado: "Cancelado",
  };
  return m[e] ?? e;
}

const NC_SIFEN_BASE = (ncId: string) => `/api/notas-credito/${ncId}/sifen`;

function mensajeErrorPlano(html: string | null | undefined): string {
  if (html == null) return "";
  return String(html)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number.parseInt(String(n), 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Siguiente paso SIFEN **real**: POST sin sufijo `-test`. El ambiente SET (producción vs pruebas)
 * lo resuelve el servidor según `empresa_sifen_config.ambiente`.
 */
function nextNcSifenPasoReal(
  nc: NotaCreditoListItemDTO,
  opts: { deAprobado: boolean; puedeCancelarDe: boolean; bloqueoTimbradoOrigen: boolean }
): {
  url: string;
  label: string;
} | null {
  if (!opts.deAprobado || opts.puedeCancelarDe) return null;
  if (nc.estado_erp === "anulada_borrador" || nc.estado_erp === "aprobada" || nc.estado_erp === "rechazada") {
    return null;
  }
  const st = nc.estado_sifen ?? "sin_envio";
  if (st === "aprobado") return null;
  const base = NC_SIFEN_BASE(nc.id);
  if (st === "enviado" || st === "en_proceso") {
    return { url: `${base}/consulta-lote`, label: "Consultar estado del envío" };
  }
  if (opts.bloqueoTimbradoOrigen) return null;
  if (st === "rechazado") {
    return { url: `${base}/procesar`, label: "Corregir y reenviar" };
  }
  if (st === "firmado") {
    return { url: `${base}/enviar`, label: "Enviar al SET" };
  }
  if (["sin_envio", "generado", "error_envio", "borrador"].includes(st)) {
    return {
      url: `${base}/procesar`,
      label: "Procesar envío",
    };
  }
  return null;
}

/** Solo si el servidor tiene `ALLOW_TEST_MODE` y la empresa está en producción: fuerza SOAP contra SET TEST. */
function nextNcSifenPasoTestOverride(
  nc: NotaCreditoListItemDTO,
  opts: { deAprobado: boolean; puedeCancelarDe: boolean; bloqueoTimbradoOrigen: boolean }
): {
  url: string;
  label: string;
} | null {
  if (!opts.deAprobado || opts.puedeCancelarDe) return null;
  if (nc.estado_erp === "anulada_borrador" || nc.estado_erp === "aprobada" || nc.estado_erp === "rechazada") {
    return null;
  }
  const st = nc.estado_sifen ?? "sin_envio";
  if (st === "aprobado") return null;
  const base = NC_SIFEN_BASE(nc.id);
  if (st === "enviado" || st === "en_proceso") {
    return { url: `${base}/consulta-lote-test`, label: "Consultar lote (SET TEST — override)" };
  }
  if (opts.bloqueoTimbradoOrigen) return null;
  if (st === "rechazado") {
    return { url: `${base}/procesar-test`, label: "Corregir y reenviar (SET TEST)" };
  }
  if (st === "firmado") {
    return { url: `${base}/enviar-test`, label: "Enviar lote (SET TEST — override)" };
  }
  if (["sin_envio", "generado", "error_envio", "borrador"].includes(st)) {
    return { url: `${base}/procesar-test`, label: "Procesar (SET TEST — override)" };
  }
  return null;
}

function formatGs(n: number, moneda: string) {
  return moneda === "USD" ? n.toLocaleString("en-US") : n.toLocaleString("es-PY");
}

export function FacturaCorreccionFiscalNC({
  facturaId,
  clienteId,
  clienteDisplay,
  monto,
  saldo,
  estado,
  moneda,
  puedeCancelarDe,
  deAprobado,
  onAfterNcMutation,
  embedded = false,
  debugUi = false,
}: {
  facturaId: string;
  clienteId: string;
  clienteDisplay: string;
  monto: number;
  saldo: number;
  estado: string;
  moneda: string;
  puedeCancelarDe: boolean;
  deAprobado: boolean;
  onAfterNcMutation?: () => void | Promise<void>;
  /** Sin caja doble: para panel unificado junto a SIFEN. */
  embedded?: boolean;
  /** Rutas XML, SET test, payload técnico, etc. */
  debugUi?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<NotaCreditoListItemDTO[]>([]);
  const [puedeCrear, setPuedeCrear] = useState(false);
  const [bloqueo, setBloqueo] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [obs, setObs] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [sifenNcId, setSifenNcId] = useState<string | null>(null);
  /** Config SIFEN empresa + flag servidor (solo para herramientas *-test opcionales). */
  const [sifenCfg, setSifenCfg] = useState<{
    empresaAmbiente: "produccion" | "test";
    allowTestOverride: boolean;
  } | null>(null);
  const [sifenPrevueloFactura, setSifenPrevueloFactura] = useState<SifenPrevueloFacturaNcDTO | null>(null);

  const monedaLabel = moneda === "USD" ? "USD" : "Gs.";

  const reload = useCallback(async () => {
    setLoading(true);
    setFlash(null);
    try {
      const resNc = await fetchWithSupabaseSession(`/api/facturas/${facturaId}/notas-credito`, {
        cache: "no-store",
      });
      if (debugUi) {
        const resCfg = await fetchWithSupabaseSession(`/api/config/allow-test-mode`, { cache: "no-store" });
        if (resCfg.ok) {
          const jc = (await resCfg.json()) as {
            success?: boolean;
            data?: { allowSifenTestOverride?: boolean; empresa_sifen_ambiente?: string };
          };
          if (jc.success && jc.data) {
            const amb =
              jc.data.empresa_sifen_ambiente === "produccion" ? "produccion" : "test";
            setSifenCfg({
              empresaAmbiente: amb,
              allowTestOverride: !!jc.data.allowSifenTestOverride,
            });
          } else {
            setSifenCfg({ empresaAmbiente: "test", allowTestOverride: false });
          }
        } else {
          setSifenCfg({ empresaAmbiente: "test", allowTestOverride: false });
        }
      } else {
        setSifenCfg(null);
      }
      const res = resNc;
      const j = (await res.json()) as NcApiGet;
      if (!res.ok || !j.success || !j.data) {
        setItems([]);
        setPuedeCrear(false);
        setBloqueo(j.error ?? "No se pudo cargar notas de crédito");
        setSifenPrevueloFactura(null);
        return;
      }
      setItems(j.data.items);
      setPuedeCrear(j.data.puede_crear);
      setBloqueo(j.data.motivo_bloqueo_creacion ?? null);
      setSifenPrevueloFactura(j.data.sifen_prevuelo_factura ?? null);
    } catch {
      setItems([]);
      setPuedeCrear(false);
      setBloqueo("Error de red");
      setSifenPrevueloFactura(null);
    } finally {
      setLoading(false);
    }
  }, [facturaId, debugUi]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleCrear() {
    setFlash(null);
    const m = motivo.trim();
    if (m.length < 5) {
      setFlash({ kind: "err", text: "El motivo debe tener al menos 5 caracteres." });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetchWithSupabaseSession(`/api/facturas/${facturaId}/notas-credito`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          motivo: m,
          observacion_interna: obs.trim() || null,
        }),
      });
      const j = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !j.success) {
        setFlash({ kind: "err", text: j.error ?? `Error ${res.status}` });
        return;
      }
      setModalOpen(false);
      setMotivo("");
      setObs("");
      setFlash({ kind: "ok", text: "Nota de crédito creada en borrador. Usá el paso SIFEN del historial cuando corresponda." });
      await reload();
      await onAfterNcMutation?.();
    } catch (e) {
      setFlash({ kind: "err", text: e instanceof Error ? e.message : "Error de red" });
    } finally {
      setSubmitting(false);
    }
  }

  async function ejecutarPasoSifen(nc: NotaCreditoListItemDTO, step: { url: string; label: string }) {
    setSifenNcId(nc.id);
    setFlash(null);
    try {
      const res = await fetchWithSupabaseSession(step.url, { method: "POST" });
      const j = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !j.success) {
        setFlash({ kind: "err", text: j.error ?? `Error ${res.status}` });
        return;
      }
      setFlash({ kind: "ok", text: `${step.label}: OK.` });
      await reload();
      await onAfterNcMutation?.();
    } catch (e) {
      setFlash({ kind: "err", text: e instanceof Error ? e.message : "Error de red" });
    } finally {
      setSifenNcId(null);
    }
  }

  async function anularBorrador(nc: NotaCreditoListItemDTO) {
    if (!confirm("¿Anular esta nota de crédito en borrador? Podrás crear otra después.")) return;
    setFlash(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/facturas/${facturaId}/notas-credito/${nc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "anular_borrador" }),
      });
      const j = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !j.success) {
        setFlash({ kind: "err", text: j.error ?? `Error ${res.status}` });
        return;
      }
      setFlash({ kind: "ok", text: "Borrador anulado." });
      await reload();
      await onAfterNcMutation?.();
    } catch (e) {
      setFlash({ kind: "err", text: e instanceof Error ? e.message : "Error de red" });
    }
  }

  const ambienteLabel =
    sifenCfg?.empresaAmbiente === "produccion" ? "Producción (SET real)" : "Pruebas (SET test)";
  const mostrarHerramientasTestOverride =
    Boolean(sifenCfg?.allowTestOverride && sifenCfg.empresaAmbiente === "produccion");

  const bloqueoTimbradoOrigen = Boolean(sifenPrevueloFactura && !sifenPrevueloFactura.ok);
  const sifenPasoOpts = { deAprobado, puedeCancelarDe, bloqueoTimbradoOrigen };

  const ncRechazoMasReciente = items.find((x) => x.estado_sifen === "rechazado");
  const pasoReenviarBanner =
    ncRechazoMasReciente && nextNcSifenPasoReal(ncRechazoMasReciente, sifenPasoOpts);

  /** Solo si hay NC en juego o el gate permite crear una (evita ruido por solo pre-vuelo/timbrado). */
  const correccionOperativa = items.length > 0 || puedeCrear;

  if (loading) {
    return null;
  }
  if (!correccionOperativa) {
    return null;
  }

  const shell = embedded
    ? "space-y-4 w-full min-w-0 lg:max-w-[26rem]"
    : "rounded-xl border border-slate-200 bg-white shadow-sm p-5 sm:p-6 space-y-4 w-full min-w-0";

  return (
    <div className={shell}>
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Nota de crédito</h3>
            {debugUi ? (
              <p className="text-[11px] text-slate-500 mt-1">
                Ambiente: <span className="font-semibold text-slate-700">{ambienteLabel}</span>
              </p>
            ) : null}
          </div>
          {debugUi ? (
            <Link
              href="/notas-credito"
              className="text-[11px] font-semibold text-[#0EA5E9] hover:underline shrink-0"
            >
              Módulo NC
            </Link>
          ) : null}
        </div>
      </div>

      {mostrarHerramientasTestOverride && debugUi && (
        <details className="rounded-lg border border-dashed border-slate-300 bg-slate-50/80 px-3 py-2 text-[11px] text-slate-700">
          <summary className="cursor-pointer font-semibold text-slate-600 select-none">
            Herramientas desarrollo (SET TEST con override)
          </summary>
          <p className="mt-2 text-slate-600 leading-snug">
            El servidor tiene <span className="font-mono">ALLOW_TEST_MODE</span>. Los enlaces bajo{" "}
            <span className="font-mono">*-test</span> envían el SOAP a SET de pruebas aunque la empresa esté en
            producción. No uses esto en operación real salvo diagnóstico.
          </p>
        </details>
      )}

      {!puedeCancelarDe && deAprobado && estado !== "Anulado" && bloqueoTimbradoOrigen && (
        <div
          className="rounded-lg border-2 border-amber-700 bg-amber-50 px-3 py-3 text-sm text-amber-950 shadow-sm"
          role="alert"
        >
          <p className="font-bold">{MSG_BLOQUEO_TIMBRADO_ORIGEN}</p>
          {sifenPrevueloFactura?.mensaje ? (
            <p className="mt-2 text-xs text-amber-900/90 font-mono whitespace-pre-wrap break-words">
              {sifenPrevueloFactura.mensaje}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-amber-900/80">
            Corregí la configuración SIFEN o el documento electrónico de la factura origen; no se reintentará el envío
            hasta que el sistema valide coherencia con el XML firmado.
          </p>
        </div>
      )}

      {!puedeCancelarDe && deAprobado && estado !== "Anulado" && puedeCrear ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => {
              setMotivo("");
              setObs("");
              setFlash(null);
              setModalOpen(true);
            }}
            className="px-4 py-2.5 text-xs font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 shadow-sm"
          >
            Emitir nota de crédito
          </button>
        </div>
      ) : null}

      {ncRechazoMasReciente && deAprobado && !puedeCancelarDe && (
        <div
          className="rounded-lg border-2 border-red-600 bg-red-50 p-4 space-y-3 shadow-sm"
          role="alert"
        >
          <p className="text-base font-bold text-red-800">Nota de crédito rechazada por SET</p>
          <p className="text-sm text-red-950 leading-relaxed">
            {mensajeErrorPlano(ncRechazoMasReciente.last_error) ||
              "La SET devolvió un rechazo. Revisá el detalle técnico en la NC correspondiente."}
          </p>
          {bloqueoTimbradoOrigen ? (
            <p className="text-sm font-semibold text-red-900">{MSG_BLOQUEO_TIMBRADO_ORIGEN}</p>
          ) : null}
          {pasoReenviarBanner ? (
            <button
              type="button"
              disabled={sifenNcId === ncRechazoMasReciente.id}
              onClick={() => void ejecutarPasoSifen(ncRechazoMasReciente, pasoReenviarBanner)}
              className="inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-red-700 text-white text-sm font-semibold hover:bg-red-800 disabled:opacity-50 shadow-sm"
            >
              {sifenNcId === ncRechazoMasReciente.id ? "Procesando…" : "Corregir y reenviar"}
            </button>
          ) : null}
        </div>
      )}

      {flash && (
        <div
          className={`rounded-lg text-sm px-3 py-2 ${
            flash.kind === "ok"
              ? "bg-emerald-50 border border-emerald-200 text-emerald-900"
              : "bg-red-50 border border-red-200 text-red-900"
          }`}
        >
          {flash.kind === "err" ? mensajeErrorPlano(flash.text) || flash.text : flash.text}
        </div>
      )}

      {items.length > 0 && (
        <section className="border-t border-slate-100 pt-4 space-y-4 min-w-0" aria-label="Notas de crédito">
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Notas de crédito</h4>
          <ul className="space-y-4 list-none p-0 m-0">
            {items.map((nc) => {
              const pasoReal = nextNcSifenPasoReal(nc, sifenPasoOpts);
              const pasoTestOv =
                debugUi && mostrarHerramientasTestOverride && nextNcSifenPasoTestOverride(nc, sifenPasoOpts);
              const errPlano = mensajeErrorPlano(nc.last_error);
              const jsonSet =
                nc.sifen_respuestas_set != null ? JSON.stringify(nc.sifen_respuestas_set, null, 2) : null;
              return (
                <li
                  key={nc.id}
                  className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden min-w-0"
                >
                  <div className="px-3 sm:px-4 py-3 border-b border-slate-100 bg-slate-50/80 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Nota de crédito</p>
                        <p className="text-xs text-slate-800">
                          <span className="text-slate-500">Creada</span>{" "}
                          {new Date(nc.created_at).toLocaleString("es-PY", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}{" "}
                          · {monedaLabel} {formatGs(nc.monto, moneda)}
                        </p>
                        <p className="text-[11px] text-slate-600">
                          <span className="font-semibold text-slate-700">ERP:</span> {labelEstadoErp(nc.estado_erp)} ·{" "}
                          <span className="font-semibold text-slate-700">SIFEN:</span>{" "}
                          {labelEstadoSifen(nc.estado_sifen)}
                        </p>
                        {nc.motivo ? (
                          <p className="text-[11px] text-slate-600 line-clamp-2" title={nc.motivo}>
                            <span className="font-semibold text-slate-700">Motivo:</span> {nc.motivo}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0 w-full sm:w-auto sm:min-w-[11rem]">
                        {pasoReal ? (
                          <button
                            type="button"
                            disabled={sifenNcId === nc.id}
                            onClick={() => void ejecutarPasoSifen(nc, pasoReal)}
                            className="w-full sm:w-auto text-center px-3 py-2 rounded-lg bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700 disabled:opacity-50"
                          >
                            {sifenNcId === nc.id ? "…" : pasoReal.label}
                          </button>
                        ) : null}
                        {pasoTestOv ? (
                          <button
                            type="button"
                            disabled={sifenNcId === nc.id}
                            onClick={() => void ejecutarPasoSifen(nc, pasoTestOv)}
                            className="w-full sm:w-auto text-center px-2 py-1.5 rounded-md border border-dashed border-slate-400 text-slate-600 text-[10px] font-medium hover:bg-slate-50 disabled:opacity-50"
                          >
                            {pasoTestOv.label}
                          </button>
                        ) : null}
                        {nc.estado_erp === "borrador" ? (
                          <button
                            type="button"
                            onClick={() => void anularBorrador(nc)}
                            className="text-amber-800 font-semibold hover:underline text-[11px] text-left"
                          >
                            Anular borrador
                          </button>
                        ) : null}
                        {!pasoReal && !pasoTestOv && nc.estado_erp !== "borrador" ? (
                          <span className="text-slate-400 text-[11px]">Sin acción SIFEN disponible</span>
                        ) : null}
                      </div>
                    </div>
                    {nc.estado_sifen === "rechazado" && errPlano ? (
                      <p className="text-sm text-red-900 font-medium leading-snug border-t border-red-100 pt-2 mt-1">
                        {errPlano}
                      </p>
                    ) : null}
                  </div>
                  {!debugUi ? (
                    nc.cdc ? (
                      <div className="px-3 sm:px-4 py-2 border-b border-slate-50">
                        <p className="text-[10px] text-slate-500">
                          CDC <span className="font-mono text-slate-700 break-all">{nc.cdc}</span>
                        </p>
                      </div>
                    ) : null
                  ) : (
                    <>
                      <div className="px-3 sm:px-4 py-2 space-y-1.5 text-[11px] text-slate-600 border-b border-slate-50">
                        <p>
                          <span className="font-semibold text-slate-500">CDC NC:</span>{" "}
                          <span className="font-mono break-all text-slate-800">{nc.cdc ?? "—"}</span>
                        </p>
                        {nc.cdc_factura_origen ? (
                          <p>
                            <span className="font-semibold text-slate-500">CDC factura origen:</span>{" "}
                            <span className="font-mono break-all text-slate-800">{nc.cdc_factura_origen}</span>
                          </p>
                        ) : null}
                        <p>
                          <span className="font-semibold text-slate-500">Usuario:</span>{" "}
                          {nc.created_by_nombre_snapshot ?? nc.created_by_email_snapshot ?? "—"}
                        </p>
                      </div>
                      <div className="px-3 sm:px-4 py-2.5 space-y-2 text-[11px] border-b border-slate-100 bg-slate-50/40">
                        <p className="font-semibold text-slate-600 uppercase tracking-wide text-[10px]">
                          Rutas storage SIFEN (NC)
                        </p>
                        <div className="space-y-1">
                          <p className="text-slate-500">
                            <span className="font-semibold text-slate-600">XML generado</span>{" "}
                            <span className="text-slate-400">(xml_path)</span>
                          </p>
                          <p
                            className="font-mono text-[10px] text-slate-800 break-all select-all rounded border border-slate-200 bg-white px-2 py-1.5"
                            title={nc.xml_path ?? undefined}
                          >
                            {nc.xml_path ?? "—"}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-slate-500">
                            <span className="font-semibold text-slate-600">XML firmado</span>{" "}
                            <span className="text-slate-400">(xml_firmado_path)</span>
                          </p>
                          <p
                            className="font-mono text-[10px] text-slate-800 break-all select-all rounded border border-slate-200 bg-white px-2 py-1.5"
                            title={nc.xml_firmado_path ?? undefined}
                          >
                            {nc.xml_firmado_path ?? "—"}
                          </p>
                        </div>
                      </div>
                      <details className="px-3 sm:px-4 py-2 bg-white text-[11px] group">
                        <summary className="cursor-pointer font-semibold text-slate-600 select-none list-none flex items-center gap-2 [&::-webkit-details-marker]:hidden">
                          <span className="text-slate-400 group-open:rotate-90 transition-transform inline-block">▸</span>
                          SIFEN (detalle técnico y respuestas SET)
                        </summary>
                        <p className="mt-2 text-slate-500 leading-snug">
                          Flujo estándar: <span className="font-mono text-slate-700">POST …/sifen/procesar</span>{" "}
                          (generar XML, firmar, recibe-lote), luego <span className="font-mono">enviar</span> /{" "}
                          <span className="font-mono">consulta-lote</span> según estado.
                        </p>
                        {jsonSet ? (
                          <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-slate-900 text-slate-100 p-3 text-[10px] leading-relaxed whitespace-pre-wrap break-words border border-slate-700">
                            {jsonSet}
                          </pre>
                        ) : (
                          <p className="mt-2 text-slate-400 italic">No hay JSON de respuesta SET guardado para esta NC.</p>
                        )}
                      </details>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {modalOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="nc-modal-title"
        >
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-5 space-y-3 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <h4 id="nc-modal-title" className="text-sm font-bold text-slate-900">
              Crear nota de crédito (borrador)
            </h4>
            <dl className="grid grid-cols-2 gap-2 text-xs text-slate-700">
              <div className="col-span-2">
                <dt className="text-slate-400">Cliente</dt>
                <dd className="font-medium">
                  <Link href={`/clientes/${clienteId}`} className="text-[#0EA5E9] hover:underline">
                    {clienteDisplay || "Cliente"}
                  </Link>
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Factura</dt>
                <dd className="font-mono text-[11px]">{facturaId.slice(0, 8)}…</dd>
              </div>
              <div>
                <dt className="text-slate-400">Monto factura</dt>
                <dd className="tabular-nums font-semibold">
                  {monedaLabel} {formatGs(monto, moneda)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Pagos registrados (suma)</dt>
                <dd className="tabular-nums font-medium">
                  {monedaLabel} {formatGs(Math.max(0, monto - saldo), moneda)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Saldo pendiente (= NC)</dt>
                <dd className="tabular-nums font-bold text-amber-900">
                  {monedaLabel} {formatGs(saldo, moneda)}
                </dd>
              </div>
              <div className="col-span-2 text-[11px] text-slate-500">
                Luego usá en el historial <span className="font-semibold">Procesar envío SIFEN</span> (flujo real según
                ambiente de la empresa).
              </div>
            </dl>
            <label className="block text-xs font-semibold text-slate-600">
              Motivo (obligatorio)
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={3}
                className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]"
                placeholder="Ej.: corrección acordada con el cliente por error de facturación"
              />
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              Observación interna (opcional)
              <textarea
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                rows={2}
                className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]"
              />
            </label>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setModalOpen(false)}
                className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Cerrar
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleCrear()}
                className="px-3 py-2 text-xs font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {submitting ? "Guardando…" : "Confirmar creación"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
