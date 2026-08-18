"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type {
  FacturaElectronicaDTO,
  SifenCancelacionPreviewDTO,
  SifenConsultaLoteUltimaPersistida,
} from "@/lib/sifen/types";
import { decodeXmlNumericEntities } from "@/lib/sifen/decode-xml-entities";
import { SifenEstadoBadge } from "./SifenEstadoBadge";
import { FacturaCorreccionFiscalNC } from "@/components/facturas/FacturaCorreccionFiscalNC";

type Resumen = {
  sifen_config_exists: boolean;
  sifen_config_activa: boolean;
  sifen_ambiente: string | null;
  sifen_plazo_cancelacion_horas: number;
  factura_electronica: FacturaElectronicaDTO | null;
  cancelacion: SifenCancelacionPreviewDTO | null;
};

/** Una línea operativa; en producción evita jerga de pipeline/XML. */
function subtituloSifenEjecutivo(resumen: Resumen, debugUi: boolean): string {
  if (!resumen.sifen_config_activa) return "Activá SIFEN en configuración para emitir el documento electrónico.";
  const fe = resumen.factura_electronica;
  if (!fe) return "Aún no hay documento electrónico.";
  if (debugUi) {
    switch (String(fe.estado_sifen)) {
      case "borrador":
        return "Siguiente: XML, firma y envío al SET.";
      case "generado":
        return "Siguiente: firma y envío al SET.";
      case "firmado":
        return "Listo para enviar el lote al SET.";
      case "enviado":
      case "en_proceso":
        return "SET procesando. Consultá el lote para ver el resultado.";
      case "aprobado":
        return "DE aprobado.";
      case "rechazado":
        return "SET rechazó el DE. Usá «Regenerar documento» para volver a generar el XML (nuevo CDC si corresponde), luego firmá y enviá.";
      case "error_envio":
        return fe.error?.trim()
          ? fe.error.trim().length > 140
            ? `${fe.error.trim().slice(0, 140)}…`
            : fe.error.trim()
          : "Falló el envío. Podés reintentar.";
      case "cancelado":
        return "Cancelado en el ERP.";
      default:
        return "Revisá el estado del documento.";
    }
  }
  switch (String(fe.estado_sifen)) {
    case "borrador":
      return "Pendiente: generar el documento electrónico.";
    case "generado":
      return "Pendiente: firmar y enviar.";
    case "firmado":
      return "Pendiente de envío al SET.";
    case "enviado":
    case "en_proceso":
      return "En proceso en el SET. Consultá el resultado del envío.";
    case "aprobado":
      return "Documento aprobado.";
    case "rechazado":
      return "El documento fue rechazado. Podés regenerar el XML y luego firmar y enviar de nuevo.";
    case "error_envio":
      return fe.error?.trim()
        ? fe.error.trim().length > 140
          ? `${fe.error.trim().slice(0, 140)}…`
          : fe.error.trim()
        : "Falló el envío. Podés reintentar.";
    case "cancelado":
      return "Documento anulado en el sistema.";
    default:
      return "Revisá el estado del documento.";
  }
}

function ResumenSifenCompacto({ resumen, debugUi }: { resumen: Resumen; debugUi: boolean }) {
  const fe = resumen.factura_electronica;
  const st = fe?.estado_sifen ?? null;
  return (
    <div className="flex flex-wrap items-center gap-3 min-w-0">
      <SifenEstadoBadge estadoSifen={st} mostrarPistaEnvioSet={false} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-600 leading-snug">{subtituloSifenEjecutivo(resumen, debugUi)}</p>
        {!resumen.sifen_config_activa ? (
          <a
            href="/configuracion/facturacion-electronica"
            className="text-xs font-semibold text-[#0EA5E9] hover:underline mt-1 inline-block"
          >
            Configuración SIFEN
          </a>
        ) : null}
      </div>
    </div>
  );
}

/** Alineado a POST …/sifen/xml: se puede regenerar en `enviado` para corregir DE rechazado o pendiente. */
const XML_BLOQUEADOS = new Set(["aprobado", "cancelado"]);
const FIRMAR_BLOQUEADOS = new Set(["aprobado", "enviado", "cancelado", "rechazado"]);

/** Texto cuando consulta-lote no trae `gResProcLote` (0365 ≠ “sigue en cola”). */
function mensajeConsultaSinFilasPorCdc(uc: SifenConsultaLoteUltimaPersistida): string {
  const rawCod = (uc.dCodResLot ?? "").trim();
  const codSinCeros = rawCod.replace(/^0+/, "") || rawCod;
  const msg = (uc.dMsgResLot ?? "").toLowerCase();
  const loteCancelado =
    codSinCeros === "365" || /\b0365\b/.test(rawCod) || msg.includes("cancelad");
  if (loteCancelado) {
  return (
    "SET respondió que el lote está cancelado y no incluyó filas por CDC. " +
      "Eso es habitual cuando recibe-lote devolvió 0301 (todos los DE rechazados): el motivo del rechazo no se repite aquí por documento. " +
      "Revisá duplicidad de timbrado + establecimiento + punto de expedición + número de documento, el XML frente al XSD y el certificado usado al firmar."
  );
  }
  return (
    "Sin detalle por CDC en esta respuesta. Si el envío fue hace poco, el lote podría seguir en proceso: reintentá la consulta en unos minutos."
  );
}

async function readApiError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string };
    return j.error ?? `Error ${res.status}`;
  } catch {
    return `Error ${res.status}`;
  }
}

function formatLimiteCancelacion(iso: string | null): string {
  if (iso == null || !iso.trim()) return "—";
  try {
    return new Date(iso).toLocaleString("es-PY", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function FacturaElectronicaPanel({
  facturaId,
  clienteId,
  facturaComercial,
  resumen,
  loadingResumen,
  onResumenLoaded,
  onComercialUpdated,
}: {
  facturaId: string;
  /** Para atajo «cancelar y reemitir» (ficha cliente). */
  clienteId: string;
  /** Datos comerciales para NC (saldo = monto de la NC en v1). */
  facturaComercial: {
    monto: number;
    saldo: number;
    estado: string;
    moneda: string;
    cliente_display: string;
  };
  resumen: Resumen | null;
  loadingResumen: boolean;
  onResumenLoaded: (r: Resumen) => void;
  /** Tras anular la factura comercial (cancelación DE). */
  onComercialUpdated?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const debugUi =
    (typeof process !== "undefined" && process.env.NODE_ENV === "development") ||
    searchParams?.get("debug") === "1";
  const [action, setAction] = useState<
    | "borrador"
    | "xml"
    | "firmar"
    | "enviar"
    | "consulta-lote"
    | "cancelar-de"
    | "pipeline"
    | null
  >(null);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [cancelModal, setCancelModal] = useState<"cancelar" | "reemitir" | null>(null);
  const [motivoCancel, setMotivoCancel] = useState("");

  const refresh = useCallback(async (): Promise<Resumen | null> => {
    const res = await fetchWithSupabaseSession(`/api/facturas/${facturaId}/sifen/resumen`, {
      cache: "no-store",
    });
    const j = (await res.json()) as { success?: boolean; data?: Resumen };
    if (res.ok && j.success && j.data) {
      const merged: Resumen = {
        ...j.data,
        sifen_plazo_cancelacion_horas: j.data.sifen_plazo_cancelacion_horas ?? j.data.cancelacion?.plazo_horas ?? 48,
        cancelacion: j.data.cancelacion ?? null,
      };
      onResumenLoaded(merged);
      return merged;
    }
    return null;
  }, [facturaId, onResumenLoaded]);

  const ejecutarCancelacion = async (reemitirTrasOk: boolean) => {
    setFlash(null);
    const m = motivoCancel.trim();
    if (m.length < 5) {
      setFlash({ kind: "err", text: "Indicá un motivo de al menos 5 caracteres." });
      return;
    }
    setAction("cancelar-de");
    try {
      const res = await fetchWithSupabaseSession(`/api/facturas/${facturaId}/sifen/cancelar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: m }),
      });
      const j = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !j.success) {
        setFlash({ kind: "err", text: j.error ?? `Error ${res.status}` });
        return;
      }
      setFlash({ kind: "ok", text: "Documento electrónico cancelado en el ERP. La factura comercial quedó anulada." });
      setCancelModal(null);
      setMotivoCancel("");
      await refresh();
      await onComercialUpdated?.();
      if (reemitirTrasOk && clienteId.trim()) {
        router.push(`/clientes/${encodeURIComponent(clienteId.trim())}`);
      }
    } catch (e) {
      setFlash({ kind: "err", text: e instanceof Error ? e.message : "Error de red" });
    } finally {
      setAction(null);
    }
  };

  const run = async (kind: "borrador" | "xml" | "firmar") => {
    setFlash(null);
    setAction(kind);
    try {
      const path =
        kind === "borrador"
          ? `/api/facturas/${facturaId}/sifen/borrador`
          : kind === "xml"
            ? `/api/facturas/${facturaId}/sifen/xml`
            : `/api/facturas/${facturaId}/sifen/firmar`;
      const res = await fetchWithSupabaseSession(path, { method: "POST" });
      if (!res.ok) {
        setFlash({ kind: "err", text: await readApiError(res) });
        return;
      }
      setFlash({
        kind: "ok",
        text:
          kind === "borrador"
            ? "Borrador electrónico listo."
            : kind === "xml"
              ? "XML generado correctamente."
              : "XML firmado correctamente.",
      });
      await refresh();
    } catch (e) {
      setFlash({ kind: "err", text: e instanceof Error ? e.message : "Error de red" });
    } finally {
      setAction(null);
    }
  };

  /** Solo POST XML local (sin firma ni SET). Tras `rechazado`, el API puede reservar nueva revisión de CDC. */
  const regenerarDocumentoRechazado = async () => {
    setFlash(null);
    setAction("xml");
    try {
      const res = await fetchWithSupabaseSession(`/api/facturas/${facturaId}/sifen/xml`, { method: "POST" });
      if (!res.ok) {
        setFlash({ kind: "err", text: await readApiError(res) });
        return;
      }
      setFlash({
        kind: "ok",
        text:
          "XML regenerado en el servidor. Si el documento estaba rechazado, puede haberse asignado un nuevo CDC: revisá el resumen y continuá con firmar y enviar cuando corresponda. Este paso no envía datos al SET.",
      });
      await refresh();
    } catch (e) {
      setFlash({ kind: "err", text: e instanceof Error ? e.message : "Error de red" });
    } finally {
      setAction(null);
    }
  };

  const etiquetaAmbienteSet =
    resumen?.sifen_ambiente === "produccion" ? "producción" : "pruebas (TEST)";

  const runEnviar = async (opts?: { accionUi?: "enviar" | "none" }) => {
    const accionUi = opts?.accionUi ?? "enviar";
    setFlash(null);
    if (accionUi === "enviar") setAction("enviar");
    try {
      const res = await fetchWithSupabaseSession(`/api/facturas/${facturaId}/sifen/enviar`, { method: "POST" });
      const j = (await res.json()) as {
        success?: boolean;
        data?: {
          factura_electronica?: FacturaElectronicaDTO;
          recibe_lote?: {
            loteRecibido?: boolean;
            loteNoEncolado?: boolean;
            dCodRes?: string | null;
            dProtConsLote?: string | null;
            httpStatus?: number;
          };
        };
        error?: string;
      };
      if (!res.ok || !j.success) {
        setFlash({ kind: "err", text: j.error ?? `Error ${res.status}` });
        return;
      }

      const feResp = j.data?.factura_electronica;
      const rec = j.data?.recibe_lote;
      const cod = String(rec?.dCodRes ?? "").trim();
      const codSinCerosIni = cod.replace(/^0+/, "") || "";
      const codigoEs0300 = cod === "0300" || codSinCerosIni === "300";
      const prot =
        rec?.dProtConsLote == null ? "" : String(rec.dProtConsLote).trim();
      const http2xx =
        rec?.httpStatus != null && rec.httpStatus >= 200 && rec.httpStatus < 300;

      /** Solo éxito real: no mostrar verde si la API guardó error_envio / rechazo de lote. */
      const loteAceptado =
        feResp?.estado_sifen === "enviado" ||
        rec?.loteRecibido === true ||
        codigoEs0300 ||
        (http2xx && prot.length > 0 && rec?.loteNoEncolado !== true);

      if (!loteAceptado) {
        if (resumen != null && feResp) {
          onResumenLoaded({ ...resumen, factura_electronica: feResp });
        }
        setFlash({
          kind: "err",
          text:
            feResp?.error?.trim() ??
            "El SET no aceptó el envío. Revisá el detalle abajo o reintentá.",
        });
        await refresh();
        return;
      }

      if (resumen != null && feResp) {
        onResumenLoaded({ ...resumen, factura_electronica: feResp });
      }
      setFlash({
        kind: "ok",
        text: `Lote enviado correctamente a SET (${etiquetaAmbienteSet})`,
      });

      const loaded = await refresh();
      if (
        feResp &&
        feResp.estado_sifen === "enviado" &&
        loaded?.factura_electronica?.estado_sifen === "error_envio" &&
        loaded.factura_electronica.id === feResp.id
      ) {
        onResumenLoaded({ ...loaded, factura_electronica: feResp });
      }
    } catch (e) {
      setFlash({ kind: "err", text: e instanceof Error ? e.message : "Error de red" });
    } finally {
      if (accionUi === "enviar") setAction(null);
    }
  };

  const runConsultaLote = async () => {
    setFlash(null);
    setAction("consulta-lote");
    try {
      const res = await fetchWithSupabaseSession(`/api/facturas/${facturaId}/sifen/consulta-lote`, {
        method: "POST",
      });
      const j = (await res.json()) as {
        success?: boolean;
        data?: {
          consulta_lote?: {
            dCodResLot?: string | null;
            dMsgResLot?: string | null;
            resumenInferido?: string | null;
            estadoActualizado?: boolean;
          };
        };
        error?: string;
      };
      if (!res.ok || !j.success) {
        setFlash({ kind: "err", text: j.error ?? `Error ${res.status}` });
        return;
      }
      const c = j.data?.consulta_lote;
      const msg =
        c?.resumenInferido?.trim() ||
        (c?.dCodResLot != null
          ? `${c.dCodResLot}${c.dMsgResLot != null ? ` — ${c.dMsgResLot}` : ""}`
          : null) ||
        "Consulta lote completada.";
      setFlash({ kind: "ok", text: msg });
      await refresh();
    } catch (e) {
      setFlash({ kind: "err", text: e instanceof Error ? e.message : "Error de red" });
    } finally {
      setAction(null);
    }
  };

  /** Borrador → XML → firma → envío en una sola acción (mismos endpoints). */
  const ejecutarGenerarYEnviar = async () => {
    setFlash(null);
    setAction("pipeline");
    const post = async (path: string) => {
      const res = await fetchWithSupabaseSession(path, { method: "POST" });
      if (!res.ok) {
        setFlash({ kind: "err", text: await readApiError(res) });
        return false;
      }
      return true;
    };
    try {
      let cur = await refresh();
      if (!cur?.sifen_config_activa) {
        setFlash({ kind: "err", text: "SIFEN no está activo para esta empresa." });
        return;
      }

      if (!cur.factura_electronica) {
        if (!(await post(`/api/facturas/${facturaId}/sifen/borrador`))) return;
        cur = (await refresh()) ?? cur;
      }

      let feLocal = cur.factura_electronica;
      let st = feLocal?.estado_sifen != null ? String(feLocal.estado_sifen) : "";

      if (st === "aprobado" || st === "cancelado") {
        setFlash({ kind: "ok", text: "Documento ya finalizado." });
        return;
      }
      if (st === "rechazado") {
        setFlash({
          kind: "err",
          text:
            debugUi
              ? "SET rechazó este DE. Revisá el detalle abajo o usá pasos avanzados."
              : "El SET rechazó este documento. Revisá el mensaje de error abajo.",
        });
        return;
      }
      if (st === "enviado" || st === "en_proceso") {
        setFlash({ kind: "ok", text: "Ya consta envío a SET. Usá «Consultar lote»." });
        return;
      }

      if (st === "borrador") {
        if (!(await post(`/api/facturas/${facturaId}/sifen/xml`))) return;
        cur = (await refresh()) ?? cur;
        feLocal = cur.factura_electronica;
        st = feLocal ? String(feLocal.estado_sifen) : "";
      }

      if (st === "generado") {
        if (!(await post(`/api/facturas/${facturaId}/sifen/firmar`))) return;
        cur = (await refresh()) ?? cur;
        feLocal = cur.factura_electronica;
        st = feLocal ? String(feLocal.estado_sifen) : "";
      }

      if (st === "error_envio") {
        const signed = Boolean(feLocal?.xml_firmado_path?.trim());
        if (!signed && feLocal?.xml_path?.trim()) {
          if (!(await post(`/api/facturas/${facturaId}/sifen/firmar`))) return;
          cur = (await refresh()) ?? cur;
          feLocal = cur.factura_electronica;
          st = feLocal ? String(feLocal.estado_sifen) : "";
        }
      }

      if (st === "firmado" || (st === "error_envio" && feLocal?.xml_firmado_path?.trim())) {
        await runEnviar({ accionUi: "none" });
        await refresh();
        return;
      }

      setFlash({
        kind: "err",
        text: debugUi
          ? "No se pudo completar el envío automático. Revisá «Pasos avanzados» o el estado del DE."
          : "No se pudo completar el envío automático. Revisá el estado del documento.",
      });
      await refresh();
    } catch (e) {
      setFlash({ kind: "err", text: e instanceof Error ? e.message : "Error de red" });
    } finally {
      setAction(null);
    }
  };

  const fe = resumen?.factura_electronica ?? null;
  const estado = fe?.estado_sifen ?? null;

  const puedeBorrador = Boolean(resumen?.sifen_config_activa) && !fe;
  const puedeGenerarXml =
    Boolean(resumen?.sifen_config_activa) && fe != null && !XML_BLOQUEADOS.has(String(estado));
  const puedeFirmar =
    Boolean(resumen?.sifen_config_activa) &&
    fe != null &&
    Boolean(fe.xml_path?.trim()) &&
    !FIRMAR_BLOQUEADOS.has(String(estado)) &&
    estado !== "firmado";

  const puedeConsultarLote =
    Boolean(resumen?.sifen_config_activa) && Boolean(fe?.sifen_d_prot_cons_lote?.trim());

  const ultimaConsulta = fe?.sifen_ultima_respuesta_consulta_lote ?? null;

  /** El campo `error` solo aplica a fallos de envío/rechazo; no mostrar texto viejo si ya está enviado/aprobado/etc. */
  const mostrarErrorPersistido =
    Boolean(fe?.error?.trim()) && (estado === "error_envio" || estado === "rechazado");

  const deAprobado = Boolean(fe && String(estado) === "aprobado");

  const stStr = estado != null ? String(estado) : "";
  const primaryConsultarLote =
    Boolean(resumen?.sifen_config_activa) &&
    puedeConsultarLote &&
    (stStr === "enviado" || stStr === "en_proceso");
  const primaryGenerarYEnviar =
    Boolean(resumen?.sifen_config_activa) &&
    !primaryConsultarLote &&
    (!fe || ["borrador", "generado", "firmado", "error_envio"].includes(stStr));
  const busy = action !== null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 sm:p-6 w-full min-w-0">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-stretch">
        <div className="flex-1 min-w-0 space-y-5">
          <div>
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Factura electrónica (SIFEN)
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Ambiente SET: <span className="font-medium text-slate-700">{etiquetaAmbienteSet}</span>
            </p>
          </div>

          {loadingResumen && <p className="text-sm text-slate-400">Cargando…</p>}

          {!loadingResumen && resumen && <ResumenSifenCompacto resumen={resumen} debugUi={debugUi} />}

          {!loadingResumen && resumen && (
            <>
              {flash && (
                <div
                  className={`rounded-lg text-sm px-3 py-2 ${
                    flash.kind === "ok"
                      ? "bg-slate-50 border border-slate-200 text-slate-800"
                      : "bg-red-50 border border-red-200 text-red-900"
                  }`}
                >
                  {decodeXmlNumericEntities(flash.text)}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                {stStr === "rechazado" && puedeGenerarXml ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void regenerarDocumentoRechazado()}
                    className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 text-sm font-semibold shadow-sm disabled:opacity-45 disabled:cursor-not-allowed hover:bg-slate-50"
                  >
                    {action === "xml" ? "Regenerando…" : "Regenerar documento"}
                  </button>
                ) : null}
                {primaryConsultarLote ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void runConsultaLote()}
                    className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold shadow-sm disabled:opacity-45 disabled:cursor-not-allowed hover:bg-slate-800"
                  >
                    {action === "consulta-lote" ? "Consultando…" : "Consultar lote"}
                  </button>
                ) : null}
                {primaryGenerarYEnviar ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void ejecutarGenerarYEnviar()}
                    className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold shadow-sm disabled:opacity-45 disabled:cursor-not-allowed hover:bg-slate-800"
                  >
                    {action === "pipeline"
                      ? "Procesando…"
                      : stStr === "firmado" || (stStr === "error_envio" && fe?.xml_firmado_path?.trim())
                        ? "Enviar a SET"
                        : "Generar y enviar"}
                  </button>
                ) : null}
                {!primaryConsultarLote && puedeConsultarLote && stStr !== "enviado" && stStr !== "en_proceso" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void runConsultaLote()}
                    className="text-sm font-medium text-slate-600 hover:text-slate-900 underline-offset-2 hover:underline disabled:opacity-40"
                  >
                    {action === "consulta-lote" ? "Consultando…" : "Consultar lote"}
                  </button>
                ) : null}
              </div>

              {debugUi ? (
                <details className="group rounded-lg border border-dashed border-amber-200 bg-amber-50/30">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-amber-900 select-none list-none flex items-center gap-2 [&::-webkit-details-marker]:hidden">
                    <span className="text-amber-600 transition-transform group-open:rotate-90 inline-block">▸</span>
                    Debug: pasos SIFEN sueltos
                  </summary>
                  <div className="px-3 pb-3 pt-0 flex flex-wrap gap-2 border-t border-amber-100/80">
                    <button
                      type="button"
                      disabled={!puedeBorrador || busy}
                      onClick={() => run("borrador")}
                      className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md border border-slate-200 bg-white text-slate-800 disabled:opacity-40 hover:bg-slate-50"
                    >
                      {action === "borrador" ? "…" : "Borrador"}
                    </button>
                    <button
                      type="button"
                      disabled={!puedeGenerarXml || busy}
                      onClick={() => run("xml")}
                      className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md border border-slate-200 bg-white text-slate-800 disabled:opacity-40 hover:bg-slate-50"
                    >
                      {action === "xml" ? "…" : "XML"}
                    </button>
                    <button
                      type="button"
                      disabled={!puedeFirmar || busy}
                      onClick={() => run("firmar")}
                      className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md border border-slate-200 bg-white text-slate-800 disabled:opacity-40 hover:bg-slate-50"
                    >
                      {action === "firmar" ? "…" : "Firmar"}
                    </button>
                    <button
                      type="button"
                      disabled={
                        busy ||
                        (stStr !== "firmado" &&
                          !(stStr === "error_envio" && Boolean(fe?.xml_firmado_path?.trim())))
                      }
                      onClick={() => void runEnviar()}
                      className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md border border-slate-200 bg-white text-slate-800 disabled:opacity-40 hover:bg-slate-50"
                    >
                      {action === "enviar" ? "…" : "Solo enviar"}
                    </button>
                  </div>
                </details>
              ) : null}

              <div className="space-y-3 text-sm">
            {fe && resumen.cancelacion && estado === "aprobado" && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {resumen.cancelacion.puede_cancelar ? (
                  <span
                    className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200"
                    title={`Plazo configurado: ${resumen.sifen_plazo_cancelacion_horas ?? resumen.cancelacion.plazo_horas} h desde aprobación SET`}
                  >
                    Cancelable hasta {formatLimiteCancelacion(resumen.cancelacion.cancelable_hasta)}
                  </span>
                ) : resumen.cancelacion.requiere_nota_credito ? (
                  <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-amber-50 text-amber-900 ring-1 ring-amber-200">
                    Requiere Nota de Crédito
                  </span>
                ) : (
                  resumen.cancelacion.motivo_bloqueo && (
                    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium bg-slate-100 text-slate-700 ring-1 ring-slate-200">
                      {resumen.cancelacion.motivo_bloqueo}
                    </span>
                  )
                )}
              </div>
            )}
            {fe && estado === "cancelado" && fe.sifen_cancelado_at && (
              <p className="text-xs text-slate-600 pt-1">
                <span className="font-semibold text-slate-700">Cancelado en ERP:</span>{" "}
                {formatLimiteCancelacion(fe.sifen_cancelado_at)}
                {fe.sifen_cancelacion_motivo?.trim() ? (
                  <>
                    {" "}
                    — <span className="text-slate-500">Motivo:</span> {fe.sifen_cancelacion_motivo.trim()}
                  </>
                ) : null}
              </p>
            )}
            {fe && estado === "aprobado" && resumen.cancelacion && (
              <div className="flex flex-wrap gap-2 pt-2">
                {resumen.cancelacion.puede_cancelar ? (
                  <>
                    <button
                      type="button"
                      disabled={action !== null}
                      onClick={() => {
                        setMotivoCancel("");
                        setCancelModal("cancelar");
                      }}
                      className="px-3 py-2 text-xs font-semibold rounded-lg bg-rose-700 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-rose-800"
                    >
                      Cancelar factura (DE)
                    </button>
                    <button
                      type="button"
                      disabled={action !== null}
                      onClick={() => {
                        setMotivoCancel("");
                        setCancelModal("reemitir");
                      }}
                      className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
                    >
                      Cancelar y reemitir
                    </button>
                  </>
                ) : null}
              </div>
            )}
            {fe && (
              <>
                {!debugUi && (fe.cdc || fe.sifen_d_prot_cons_lote?.trim()) ? (
                  <details className="rounded-lg border border-slate-100 text-xs text-slate-600">
                    <summary className="cursor-pointer px-2 py-1.5 font-medium text-slate-700 select-none">
                      Referencias (DE)
                    </summary>
                    <div className="px-2 pb-2 pt-0 space-y-1.5">
                      <p className="text-[10px] text-slate-500 break-all">
                        <span className="font-medium text-slate-600">ID:</span> {fe.id}
                      </p>
                      {fe.cdc ? (
                        <p className="text-[10px] text-slate-500 break-all">
                          <span className="font-medium text-slate-600">CDC:</span> {fe.cdc}
                        </p>
                      ) : null}
                      {fe.sifen_d_prot_cons_lote?.trim() ? (
                        <p className="text-[10px] text-slate-500 break-all">
                          <span className="font-medium text-slate-600">Protocolo lote:</span>{" "}
                          {fe.sifen_d_prot_cons_lote}
                        </p>
                      ) : null}
                    </div>
                  </details>
                ) : null}
                {debugUi && fe ? (
                  <>
                    <p className="text-slate-600 text-xs">
                      <span className="text-slate-400">ID DE:</span>{" "}
                      <code className="bg-slate-100 px-1 rounded break-all">{fe.id}</code>
                    </p>
                    {fe.cdc ? (
                      <p className="text-slate-600 text-xs break-all">
                        <span className="text-slate-400">CDC:</span>{" "}
                        <code className="bg-slate-100 px-1 rounded break-all">{fe.cdc}</code>
                      </p>
                    ) : null}
                    <details className="rounded-lg border border-slate-200 bg-slate-50/50 text-xs">
                      <summary className="cursor-pointer px-3 py-2 font-semibold text-slate-600 select-none">
                        Rutas XML (storage)
                      </summary>
                      <div className="px-3 pb-3 pt-0 space-y-2 text-slate-600 break-all">
                        <p>
                          <span className="text-slate-400">xml_path:</span>{" "}
                          <code className="text-[11px]">{fe.xml_path ?? "—"}</code>
                        </p>
                        <p>
                          <span className="text-slate-400">xml_firmado_path:</span>{" "}
                          <code className="text-[11px]">{fe.xml_firmado_path ?? "—"}</code>
                        </p>
                      </div>
                    </details>
                    {ultimaConsulta ? (
                      <details className="rounded-lg border border-sky-200 bg-sky-50/50 text-xs open:shadow-sm">
                        <summary className="cursor-pointer px-3 py-2 font-semibold text-sky-950 select-none">
                          Respuesta consulta lote ({etiquetaAmbienteSet})
                        </summary>
                        <div className="px-3 pb-3 pt-0 space-y-2 max-h-[min(420px,55vh)] overflow-y-auto">
                          <p className="text-slate-700">
                            <span className="text-slate-500">dCodResLot:</span>{" "}
                            <code className="bg-white/80 px-1 rounded">
                              {ultimaConsulta.dCodResLot ?? "—"}
                            </code>
                          </p>
                          <p className="text-slate-700 break-words">
                            <span className="text-slate-500">dMsgResLot:</span>{" "}
                            {ultimaConsulta.dMsgResLot ?? "—"}
                          </p>
                          {ultimaConsulta.detallePorCdc.length > 0 && (
                            <ul className="list-disc pl-4 space-y-2 text-slate-800">
                              {ultimaConsulta.detallePorCdc.map((d) => (
                                <li key={d.cdc}>
                                  <span className="text-slate-500">CDC:</span>{" "}
                                  <code className="bg-white/80 px-1 rounded break-all">{d.cdc}</code>
                                  <br />
                                  <span className="text-slate-500">dEstRes:</span> {d.dEstRes}
                                  {d.dProtAut != null && d.dProtAut !== "" && (
                                    <>
                                      <br />
                                      <span className="text-slate-500">dProtAut:</span> {d.dProtAut}
                                    </>
                                  )}
                                  {d.grupoRes.length > 0 && (
                                    <ul className="list-circle pl-4 mt-1 space-y-0.5">
                                      {d.grupoRes.map((g, i) => (
                                        <li key={`${d.cdc}-${g.dCodRes}-${i}`}>
                                          <code>{g.dCodRes}</code> — {decodeXmlNumericEntities(g.dMsgRes)}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                          {ultimaConsulta.loteSinDetalleCdc && !ultimaConsulta.soapFault && (
                            <p className="text-amber-900 leading-snug">
                              {mensajeConsultaSinFilasPorCdc(ultimaConsulta)}
                            </p>
                          )}
                          {ultimaConsulta.soapFault && ultimaConsulta.faultString && (
                            <p className="text-red-700">Fault: {ultimaConsulta.faultString}</p>
                          )}
                        </div>
                      </details>
                    ) : null}
                  </>
                ) : null}
                {mostrarErrorPersistido && (
                  <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm px-3 py-2 whitespace-pre-wrap break-words">
                    <span className="font-semibold">Error: </span>
                    {decodeXmlNumericEntities(fe.error ?? "")}
                  </div>
                )}
              </>
            )}
            </div>

              {debugUi ? (
                <details className="rounded-lg border border-dashed border-slate-200 text-xs text-slate-500">
                  <summary className="cursor-pointer px-2 py-1.5 font-medium text-slate-600 select-none">
                    Debug: payload / documento (API)
                  </summary>
                  <p className="px-2 pb-2 pt-0 flex flex-wrap gap-x-3 gap-y-1">
                    <a
                      className="text-[#0EA5E9] font-medium hover:underline"
                      href={`/api/facturas/${facturaId}/sifen/payload`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      JSON
                    </a>
                    <a
                      className="text-[#0EA5E9] font-medium hover:underline"
                      href={`/api/facturas/${facturaId}/sifen/documento`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Documento
                    </a>
                  </p>
                </details>
              ) : null}
            </>
          )}

        </div>

        <FacturaCorreccionFiscalNC
          facturaId={facturaId}
          clienteId={clienteId}
          clienteDisplay={facturaComercial.cliente_display}
          monto={facturaComercial.monto}
          saldo={facturaComercial.saldo}
          estado={facturaComercial.estado}
          moneda={facturaComercial.moneda}
          puedeCancelarDe={Boolean(resumen?.cancelacion?.puede_cancelar)}
          deAprobado={deAprobado}
          onAfterNcMutation={onComercialUpdated}
          embedded
          debugUi={debugUi}
        />
      </div>

      {cancelModal != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sifen-cancel-title"
        >
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-4 border border-slate-200">
            <h4 id="sifen-cancel-title" className="text-sm font-bold text-slate-900">
              {cancelModal === "reemitir"
                ? "Cancelar documento y continuar en cliente"
                : "Cancelar documento electrónico (ERP)"}
            </h4>
            <p className="text-xs text-slate-600 leading-relaxed">
              Se registrará la cancelación lógica del DE, la factura comercial pasará a{" "}
              <span className="font-semibold">Anulado</span> y quedará trazabilidad. No se elimina ningún registro.
              {cancelModal === "reemitir" ? " Luego podés emitir una nueva factura desde la ficha del cliente." : ""}
            </p>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Motivo (obligatorio)
              <textarea
                value={motivoCancel}
                onChange={(e) => setMotivoCancel(e.target.value)}
                rows={3}
                className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]"
                placeholder="Ej.: error en datos del cliente acordado verbalmente"
              />
            </label>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={action !== null}
                onClick={() => {
                  setCancelModal(null);
                  setMotivoCancel("");
                }}
                className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cerrar
              </button>
              <button
                type="button"
                disabled={action !== null}
                onClick={() => void ejecutarCancelacion(cancelModal === "reemitir")}
                className="px-3 py-2 text-xs font-semibold rounded-lg bg-rose-700 text-white hover:bg-rose-800 disabled:opacity-50"
              >
                {action === "cancelar-de" ? "Procesando…" : "Confirmar cancelación"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
