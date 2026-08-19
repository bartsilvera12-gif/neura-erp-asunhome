"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchWithSupabaseSession, isAbortError } from "@/lib/api/fetch-with-supabase-session";
import type { ClienteHistorialRow } from "@/lib/auditoria/cliente-historial-servidor";

function formatFechaHora(iso: string) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("es-PY", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function labelModo(m: string | null) {
  switch (m) {
    case "inmediato":
      return "Aplicación inmediata (suscripción)";
    case "proximo_mes":
      return "A partir del 1° del mes siguiente";
    case "actualizar_factura_pendiente":
      return "Recálculo de factura del mes";
    default:
      return m ?? "—";
  }
}

function textoDetalle(f: ClienteHistorialRow) {
  const partes: string[] = [];
  if (f.plan_anterior_nombre || f.plan_nuevo_nombre) {
    partes.push(
      `De «${f.plan_anterior_nombre ?? "—"}» a «${f.plan_nuevo_nombre ?? "—"}»`
    );
  }
  if (f.modo) {
    partes.push(labelModo(f.modo));
  }
  if (f.plan_pendiente_vigente_desde) {
    partes.push(`Vigencia programada: ${f.plan_pendiente_vigente_desde}`);
  }
  if (f.factura_id) {
    partes.push(`Factura ajustada: ${f.factura_id.slice(0, 8)}…`);
  }
  const d = f.detalle as Record<string, unknown> | null;
  if (d?.factura_id_periodo) {
    partes.push(`Factura del período (referencia): ${String(d.factura_id_periodo).slice(0, 8)}…`);
  }
  if (d?.moneda_nueva != null && d?.precio_nuevo != null) {
    const mon = String(d.moneda_nueva);
    partes.push(
      `Importe nuevo plan: ${mon === "USD" ? "US$ " : "Gs. "}${Number(d.precio_nuevo).toLocaleString("es-PY")} ${mon}`
    );
  }
  return partes.join(" · ") || f.accion;
}

export function ModalHistorialClienteGestion({
  clienteId,
  clienteNombre,
  onClose,
}: {
  clienteId: string;
  clienteNombre: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filas, setFilas] = useState<ClienteHistorialRow[]>([]);

  // signal opcional: si el modal se cierra mid-fetch (user clickea fuera, navega
  // a otra pagina), abortamos para no hacer setState sobre componente desmontado.
  const cargar = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession(
        `/api/clientes/${clienteId}/historial`,
        { signal },
      );
      if (signal?.aborted) return;
      const json = await res.json();
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(json?.error ?? "Error al cargar");
      const out = (json.data?.filas as ClienteHistorialRow[] | undefined) ?? [];
      setFilas(out);
    } catch (e) {
      if (isAbortError(e)) return;
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [clienteId]);

  useEffect(() => {
    const ctrl = new AbortController();
    void cargar(ctrl.signal);
    return () => ctrl.abort();
  }, [cargar]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="shrink-0 border-b border-slate-200 px-5 py-4">
          <h3 className="text-lg font-bold text-slate-900">Historial del cliente</h3>
          <p className="text-sm text-slate-500">{clienteNombre}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && <p className="text-sm text-slate-500">Cargando…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}

          {!loading && !error && filas.length === 0 && (
            <p className="text-sm text-slate-500">No hay registros de historial aún. Los cambios de plan quedan trazados aquí.</p>
          )}

          {!loading && !error && filas.length > 0 && (
            <ul className="space-y-3">
              {filas.map((f) => (
                <li
                  key={f.id}
                  className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-sm text-slate-800"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-slate-500">
                    <span className="font-mono text-slate-400">{f.tipo}</span>
                    <span className="tabular-nums">{formatFechaHora(f.created_at)}</span>
                  </div>
                  <p className="mt-0.5 font-medium text-slate-900">{f.accion}</p>
                  <p className="mt-1 text-slate-700">{textoDetalle(f)}</p>
                  <p className="mt-1.5 text-xs text-slate-500">
                    Usuario: {f.creado_por_email || f.creado_por_auth_user_id || "—"}
                  </p>
                  {f.factura_id ? (
                    <Link
                      href={`/facturas/${f.factura_id}`}
                      className="mt-1 inline-block text-xs font-semibold text-sky-700 hover:underline"
                    >
                      Ver factura afectada →
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-100 px-5 py-3">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
