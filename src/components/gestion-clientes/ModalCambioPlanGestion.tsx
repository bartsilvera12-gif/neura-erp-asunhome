"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchWithSupabaseSession, isAbortError } from "@/lib/api/fetch-with-supabase-session";
import type { CambioPlanContexto, ModoCambioPlan } from "@/lib/facturacion/cambio-plan-cliente-types";

const fInputClass =
  "w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500 focus:outline-none bg-white";

function modoLabel(m: ModoCambioPlan) {
  switch (m) {
    case "inmediato":
      return "Aplicar ahora (suscripción)";
    case "proximo_mes":
      return "A partir del 1° del mes siguiente";
    case "actualizar_factura_pendiente":
      return "Recalcular factura del mes (sin DE aprobado SIFEN)";
    default:
      return m;
  }
}

function formatGs(n: number) {
  return n.toLocaleString("es-PY");
}

export function ModalCambioPlanGestion({
  clienteId,
  clienteNombre,
  onClose,
  onExito,
}: {
  clienteId: string;
  clienteNombre: string;
  onClose: () => void;
  onExito?: () => void | Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ctx, setCtx] = useState<CambioPlanContexto | null>(null);
  const [planId, setPlanId] = useState<string>("");
  const [modo, setModo] = useState<ModoCambioPlan>("proximo_mes");
  const [submitting, setSubmitting] = useState(false);
  const [errPost, setErrPost] = useState<string | null>(null);

  // cargar acepta un signal para que se pueda cancelar si el modal se cierra
  // antes de que termine el fetch. Sin esto: si el user cierra el modal mid-fetch,
  // los setState siguientes disparan "Can't perform a React state update on an
  // unmounted component" y dejan el componente colgado en memoria.
  const cargar = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession(
        `/api/clientes/${clienteId}/cambio-plan`,
        { signal },
      );
      if (signal?.aborted) return;
      const json = await res.json();
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(json?.error ?? "Error al cargar");
      const c = json.data as CambioPlanContexto;
      setCtx(c);
      if (c.planes.length > 0) {
        const pr = c.suscripcion?.plan_id;
        const pick = pr && c.planes.find((p) => p.id === pr) ? pr : c.planes[0].id;
        setPlanId(pick);
      }
      if (c.modos_permitidos.includes("proximo_mes")) setModo("proximo_mes");
      else if (c.modos_permitidos[0]) setModo(c.modos_permitidos[0]);
      else setModo("proximo_mes");
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

  const planElegido = ctx?.planes.find((p) => p.id === planId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!planId || !ctx?.modos_permitidos.includes(modo)) return;
    setSubmitting(true);
    setErrPost(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/clientes/${clienteId}/cambio-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId, modo }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "No se pudo confirmar el cambio");
      setCtx(json.data as CambioPlanContexto);
      if (onExito) await onExito();
      onClose();
    } catch (e) {
      setErrPost(e instanceof Error ? e.message : "Error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="shrink-0 border-b border-slate-200 px-5 py-4">
          <h3 className="text-lg font-bold text-slate-900">Cambio de plan</h3>
          <p className="text-sm text-slate-500">{clienteNombre}</p>
        </div>

        <form onSubmit={handleSubmit} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && <p className="text-sm text-slate-500">Cargando contexto…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}

          {!loading && !error && ctx && (
            <div className="space-y-4">
              {ctx.avisoBloqueo ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{ctx.avisoBloqueo}</div>
              ) : null}
              {ctx.aviso ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{ctx.aviso}</div> : null}

              {ctx.suscripcion ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-sm text-slate-800">
                  <p>
                    <span className="font-medium text-slate-600">Plan actual:</span> {ctx.suscripcion.plan_nombre} —{" "}
                    {ctx.suscripcion.moneda === "USD" ? "US$" : "Gs."}{" "}
                    {ctx.suscripcion.moneda === "GS" ? formatGs(ctx.suscripcion.precio) : ctx.suscripcion.precio}
                  </p>
                  {ctx.suscripcion.plan_pendiente_id && ctx.suscripcion.plan_pendiente_vigente_desde ? (
                    <p className="mt-1 text-amber-800">
                      <span className="font-medium">Cambio programado:</span> {ctx.suscripcion.plan_pendiente_nombre ?? "—"} desde el{" "}
                      {ctx.suscripcion.plan_pendiente_vigente_desde}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {ctx.tieneFacturaComercialPeriodo ? (
                <div className="rounded-lg border border-slate-200 p-3 text-sm">
                  <p className="font-medium text-slate-700">Factura del mes</p>
                  {ctx.factura_id_periodo ? (
                    <p className="text-slate-600">
                      Estado: <span className="font-semibold">{ctx.factura_estado}</span> · monto:{" "}
                      {ctx.factura_monto != null
                        ? ctx.factura_moneda === "USD" || (ctx.factura_moneda == null && ctx.suscripcion?.moneda === "USD")
                          ? `US$ ${ctx.factura_monto}`
                          : `Gs. ${formatGs(ctx.factura_monto)}`
                        : "—"}{" "}
                      · saldo:{" "}
                      {ctx.factura_saldo != null
                        ? ctx.factura_moneda === "USD" || (ctx.factura_moneda == null && ctx.suscripcion?.moneda === "USD")
                          ? `US$ ${ctx.factura_saldo}`
                          : `Gs. ${formatGs(ctx.factura_saldo)}`
                        : "—"}
                    </p>
                  ) : null}
                  {ctx.sifen.tiene_de ? (
                    <p className="mt-1 text-xs text-slate-600">
                      SIFEN: <span className="font-semibold">{ctx.sifen.estado || "—"}</span>
                      {ctx.sifen.aprobado ? " (aprobado; no se modifica el documento vía este flujo)" : ""}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">Sin registro SIFEN para esta factura.</p>
                  )}
                  {ctx.factura_id_periodo ? (
                    <Link
                      href={`/facturas/${ctx.factura_id_periodo}`}
                      className="mt-2 inline-block text-xs font-semibold text-sky-700 hover:underline"
                    >
                      Abrir factura (y DE / cancelación) →
                    </Link>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-slate-600">Sin factura de suscripción emitida en el mes calendario actual.</p>
              )}

              {ctx.suscripcion && (
                <>
                  <div>
                    <label className="mb-0.5 block text-[11px] font-medium text-slate-500" htmlFor="cambio-plan-sel">
                      Nuevo plan
                    </label>
                    <select
                      id="cambio-plan-sel"
                      value={planId}
                      onChange={(e) => setPlanId(e.target.value)}
                      className={fInputClass}
                    >
                      {ctx.planes.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nombre} — {p.moneda === "USD" ? "US$" : "Gs."} {p.moneda === "GS" ? formatGs(p.precio) : p.precio} / {p.moneda}
                        </option>
                      ))}
                    </select>
                  </div>
                  {planElegido ? (
                    <p className="text-sm text-slate-700">
                      <span className="text-slate-500">Precio (plan):</span>{" "}
                      <span className="font-semibold">
                        {planElegido.moneda === "USD" ? "US$ " : "Gs. "}
                        {planElegido.moneda === "GS" ? formatGs(planElegido.precio) : planElegido.precio} {planElegido.moneda}
                      </span>
                    </p>
                  ) : null}
                  <div>
                    <p className="mb-0.5 text-[11px] font-medium text-slate-500">Aplicar cambio</p>
                    <div className="space-y-2">
                      {(
                        (["inmediato", "proximo_mes", "actualizar_factura_pendiente"] as const) as ModoCambioPlan[]
                      ).map((m) => {
                        const ok = ctx.modos_permitidos.includes(m);
                        return (
                          <label
                            key={m}
                            className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                              !ok
                                ? "border-slate-100 bg-slate-50 text-slate-400"
                                : modo === m
                                  ? "border-sky-500 bg-sky-50/80"
                                  : "border-slate-200 hover:bg-slate-50"
                            }`}
                          >
                            <input
                              type="radio"
                              className="mt-0.5"
                              name="cambio-plan-modo"
                              checked={modo === m}
                              onChange={() => {
                                if (ok) setModo(m);
                              }}
                              disabled={!ok}
                            />
                            <span>
                              {modoLabel(m)}
                              {!ok ? " (no disponible con las reglas actuales)" : ""}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  {modo === "proximo_mes" && (
                    <p className="text-xs text-slate-500">
                      El nuevo plan aplica a partir de <span className="font-semibold">{ctx.vigenciaProximoMes}</span> (1° del mes
                      siguiente).
                    </p>
                  )}
                </>
              )}

              {errPost && <p className="text-sm text-red-600">{errPost}</p>}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={
                loading ||
                !ctx?.suscripcion ||
                !planId ||
                submitting ||
                !ctx.modos_permitidos.includes(modo) ||
                ctx.caso === "sin_suscripcion"
              }
              className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#3F8E91] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Aplicando…" : "Confirmar cambio"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
