"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { NotaCreditoGlobalDetailDTO, NotaCreditoEventoAuditoriaDTO } from "@/lib/nota-credito/types";

function labelTipoEvento(t: string) {
  const m: Record<string, string> = {
    creacion: "Creación",
    validacion: "Validación",
    rechazo_negocio: "Rechazo negocio",
    cambio_estado_erp: "Cambio estado ERP",
    preparacion_sifen: "Preparación SIFEN",
    error: "Error",
    observacion_operativa: "Observación",
    anulacion_borrador: "Anulación borrador",
    xml_generado: "XML generado",
    xml_firmado: "XML firmado",
    enviado_set: "Enviado a SET",
    respuesta_set: "Respuesta SET",
    aprobado: "Aprobado SET",
    rechazado: "Rechazado SET",
    impacto_saldo_aplicado: "Impacto en saldo",
    error_envio: "Error de envío",
  };
  return m[t] ?? t;
}

export default function NotaCreditoDetalleClient() {
  const params = useParams();
  const id = String(params?.id ?? "");
  const [data, setData] = useState<NotaCreditoGlobalDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/notas-credito/${id}`, { cache: "no-store" });
      const j = (await res.json()) as { success?: boolean; data?: NotaCreditoGlobalDetailDTO; error?: string };
      if (!res.ok || !j.success || !j.data) {
        setData(null);
        setErr(j.error ?? "No se pudo cargar");
        return;
      }
      setData(j.data);
    } catch {
      setData(null);
      setErr("Error de red");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center text-slate-500 text-sm">
        Cargando nota de crédito…
      </div>
    );
  }
  if (err || !data) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{err ?? "Sin datos"}</div>
        <Link href="/notas-credito" className="inline-block mt-4 text-[#0EA5E9] text-sm font-semibold hover:underline">
          ← Volver al listado
        </Link>
      </div>
    );
  }

  const nc = data.nota_credito;
  const ne = data.nota_credito_electronica;
  const moneda = String(nc.moneda_snapshot ?? "GS");

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/notas-credito" className="text-xs font-semibold text-[#0EA5E9] hover:underline">
            ← Notas de crédito
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Detalle de nota de crédito</h1>
          <p className="text-xs font-mono text-slate-500 mt-0.5">{String(nc.id)}</p>
        </div>
        <Link
          href={`/facturas/${data.factura.id}`}
          className="px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
        >
          Ir a factura
        </Link>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Datos generales</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-slate-400 text-xs">Cliente</dt>
            <dd className="font-medium">
              <Link href={`/clientes/${data.cliente.id}`} className="text-[#0EA5E9] hover:underline">
                {data.cliente.display}
              </Link>
              {data.cliente.ruc ? <span className="text-slate-500 text-xs ml-1">RUC {data.cliente.ruc}</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400 text-xs">Factura</dt>
            <dd className="font-mono text-xs">{data.factura.numero_factura ?? data.factura.id}</dd>
          </div>
          <div>
            <dt className="text-slate-400 text-xs">Monto NC</dt>
            <dd className="font-bold text-amber-900 tabular-nums">
              {moneda === "USD" ? "USD" : "Gs."} {Number(nc.monto).toLocaleString(moneda === "USD" ? "en-US" : "es-PY")}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400 text-xs">Estado ERP / SIFEN</dt>
            <dd className="space-x-2">
              <span className="font-semibold">{String(nc.estado_erp)}</span>
              <span className="text-slate-400">/</span>
              <span className="font-semibold">{ne?.estado_sifen != null ? String(ne.estado_sifen) : "—"}</span>
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-slate-400 text-xs">Motivo</dt>
            <dd className="text-slate-800 whitespace-pre-wrap">{String(nc.motivo ?? "")}</dd>
          </div>
          <div>
            <dt className="text-slate-400 text-xs">Creador</dt>
            <dd className="text-xs">
              {String(nc.created_by_nombre_snapshot ?? nc.created_by_email_snapshot ?? nc.created_by_user_id ?? "—")}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400 text-xs">CDC (NC)</dt>
            <dd className="font-mono text-[11px] break-all">{ne?.cdc != null ? String(ne.cdc) : "—"}</dd>
          </div>
        </dl>
      </section>

      {ne && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Documento electrónico (SIFEN)</h2>
          <dl className="grid grid-cols-1 gap-2 text-xs font-mono text-slate-600 break-all">
            <div>
              <dt className="text-slate-400 font-sans">xml_path</dt>
              <dd>{ne.xml_path != null ? String(ne.xml_path) : "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-400 font-sans">xml_firmado_path</dt>
              <dd>{ne.xml_firmado_path != null ? String(ne.xml_firmado_path) : "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-400 font-sans">kude_url</dt>
              <dd>{ne.kude_url != null ? String(ne.kude_url) : "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-400 font-sans">last_error</dt>
              <dd className="text-red-800">{ne.last_error != null ? String(ne.last_error) : "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-400 font-sans">sifen_aprobado_at</dt>
              <dd>{ne.sifen_aprobado_at != null ? String(ne.sifen_aprobado_at) : "—"}</dd>
            </div>
          </dl>
          <details className="text-xs">
            <summary className="cursor-pointer text-[#0EA5E9] font-semibold">Respuestas SET (JSON)</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-50 p-2 text-[10px]">
              {JSON.stringify(
                {
                  sifen_ultima_respuesta_recibe_lote: ne.sifen_ultima_respuesta_recibe_lote,
                  sifen_ultima_respuesta_consulta_lote: ne.sifen_ultima_respuesta_consulta_lote,
                  last_response_json: ne.last_response_json,
                },
                null,
                2
              )}
            </pre>
          </details>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Auditoría / eventos</h2>
        {data.eventos.length === 0 ? (
          <p className="text-sm text-slate-400">Sin eventos registrados.</p>
        ) : (
          <ul className="space-y-4">
            {data.eventos.map((ev: NotaCreditoEventoAuditoriaDTO) => (
              <li key={ev.id} className="border-l-4 border-sky-400 pl-4 py-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-bold text-slate-800">{labelTipoEvento(ev.tipo_evento)}</span>
                  <span className="text-xs text-slate-400">
                    {new Date(ev.created_at).toLocaleString("es-PY", { dateStyle: "short", timeStyle: "medium" })}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">Actor: {ev.actor_user_id ?? "—"}</p>
                <pre className="mt-2 max-h-48 overflow-auto rounded bg-slate-50 p-2 text-[10px] text-slate-700">
                  {JSON.stringify(ev.detalle_json, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
