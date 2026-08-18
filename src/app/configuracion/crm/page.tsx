"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfigFormCard, ConfigSectionTitle } from "@/components/config/global-config-primitives";
import { GlobalConfigSubpageShell } from "@/components/config/GlobalConfigSubpageShell";
import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import {
  createEtapa,
  deleteEtapa,
  getEtapasParaConfig,
  getEtapaClasses,
  updateEtapa,
  type EtapaCrm,
} from "@/lib/crm/etapas";
import type { ClienteTipoServicioRow } from "@/lib/clientes/tipo-servicio-catalogo";

/** Mensaje de error de respuestas JSON `{ success, error }` o texto. */
async function leerErrorApiClientes(r: Response): Promise<string> {
  const t = await r.text().catch(() => "");
  try {
    const j = JSON.parse(t) as { error?: string };
    if (j && typeof j.error === "string" && j.error.trim()) return j.error.trim();
  } catch {
    /* no JSON */
  }
  return t.trim() || `Error ${r.status}`;
}

const FUENTE_ETAPAS_CONFIG =
  "GET /api/crm/etapas?config=1 → tabla crm_etapas (misma capa de datos que el Funnel; el dashboard no define etapas)";

export default function ConfiguracionCrmPipelinePage() {
  const [rolCargado, setRolCargado] = useState(false);
  const [puedeConfig, setPuedeConfig] = useState(false);
  const [rolDetectado, setRolDetectado] = useState<string | null>(null);
  const [empresaIdCtx, setEmpresaIdCtx] = useState<string | null>(null);
  const [etapasCrm, setEtapasCrm] = useState<EtapaCrm[]>([]);
  const [nuevaEtapa, setNuevaEtapa] = useState({ nombre: "", codigo: "", color: "gray", orden: 0 });
  const [editandoEtapa, setEditandoEtapa] = useState<string | null>(null);
  const [tiposServ, setTiposServ] = useState<ClienteTipoServicioRow[]>([]);
  const [cargandoTipos, setCargandoTipos] = useState(false);
  const [nuevoTipoNombre, setNuevoTipoNombre] = useState("");
  /** Borrador al editar nombre/orden/activo (mismo `id` que el catálogo). */
  const [borradorTipo, setBorradorTipo] = useState<{
    id: string;
    nombre: string;
    orden: string;
    activo: boolean;
  } | null>(null);
  const [busyTipoServ, setBusyTipoServ] = useState(false);
  const [mensajeTipos, setMensajeTipos] = useState<{ ok?: string; err?: string }>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/auth/empresa-context", { cache: "no-store" });
        const j = (await res.json()) as {
          success?: boolean;
          data?: { es_admin?: boolean; rol?: string | null; empresa_id?: string | null };
        };
        if (cancelled) return;
        if (res.ok && j.success && j.data) {
          setPuedeConfig(Boolean(j.data.es_admin));
          setRolDetectado(j.data.rol != null && j.data.rol !== "" ? String(j.data.rol) : null);
          setEmpresaIdCtx(j.data.empresa_id != null && j.data.empresa_id !== "" ? String(j.data.empresa_id) : null);
        } else {
          setPuedeConfig(false);
        }
      } catch {
        if (!cancelled) setPuedeConfig(false);
      } finally {
        if (!cancelled) setRolCargado(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadEtapas = useCallback(() => {
    void getEtapasParaConfig().then(setEtapasCrm);
  }, []);

  useEffect(() => {
    loadEtapas();
  }, [loadEtapas]);

  const loadTipos = useCallback(async (): Promise<ClienteTipoServicioRow[] | null> => {
    if (!rolCargado) return null;
    setCargandoTipos(true);
    try {
      if (puedeConfig) {
        const r = await apiFetch("/api/cliente-tipos-servicio?all=1&with_usos=1");
        if (!r.ok) {
          setTiposServ([]);
          setMensajeTipos({ err: `No se pudo cargar el catálogo: ${await leerErrorApiClientes(r)}` });
          return null;
        }
        const j = (await r.json()) as { success?: boolean; data?: ClienteTipoServicioRow[] };
        if (j?.success && Array.isArray(j.data)) {
          const sorted = [...j.data].sort((a, b) => a.orden - b.orden);
          setTiposServ(sorted);
          return sorted;
        }
        setTiposServ([]);
        return [];
      }
      const r = await apiFetch("/api/cliente-tipos-servicio?form=1");
      if (r.ok) {
        const j = (await r.json()) as { success?: boolean; data?: ClienteTipoServicioRow[] };
        if (j?.success && Array.isArray(j.data)) {
          const sorted = [...j.data].sort((a, b) => a.orden - b.orden);
          setTiposServ(sorted);
          return sorted;
        }
        setTiposServ([]);
        return [];
      }
      setTiposServ([]);
      return null;
    } catch (e) {
      console.error("[config crm] tipos servicio", e);
      setTiposServ([]);
      setMensajeTipos({ err: "No se pudo cargar el catálogo. Reintentá o revisá la sesión." });
      return null;
    } finally {
      setCargandoTipos(false);
    }
  }, [puedeConfig, rolCargado]);

  useEffect(() => {
    void loadTipos();
  }, [loadTipos]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !rolCargado) return;
    console.debug("[config-crm] diagnóstico", {
      rol_detectado: rolDetectado,
      es_admin: puedeConfig,
      empresa_id: empresaIdCtx,
      fuente_etapas: FUENTE_ETAPAS_CONFIG,
      n_etapas: etapasCrm.length,
      n_tipos_servicio: tiposServ.length,
    });
  }, [rolCargado, rolDetectado, puedeConfig, empresaIdCtx, etapasCrm.length, tiposServ.length]);

  const reordenarTipo = (rowId: string, direction: "up" | "down") => {
    if (!puedeConfig || busyTipoServ) return;
    const s = [...tiposServ].sort((a, b) => a.orden - b.orden);
    const i = s.findIndex((x) => x.id === rowId);
    if (i < 0) return;
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= s.length) return;
    const a = s[i]!;
    const b = s[j]!;
    const ao = a.orden;
    const bo = b.orden;
    void (async () => {
      setBusyTipoServ(true);
      setMensajeTipos({ err: undefined, ok: undefined });
      const r1 = await apiFetch(`/api/cliente-tipos-servicio/${a.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orden: bo }),
      });
      if (!r1.ok) {
        setMensajeTipos({ err: await leerErrorApiClientes(r1) });
        setBusyTipoServ(false);
        return;
      }
      const r2 = await apiFetch(`/api/cliente-tipos-servicio/${b.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orden: ao }),
      });
      if (!r2.ok) {
        setMensajeTipos({ err: await leerErrorApiClientes(r2) });
        setBusyTipoServ(false);
        return;
      }
      await loadTipos();
      setMensajeTipos({ ok: "Orden actualizado correctamente." });
      if (process.env.NODE_ENV === "development") {
        console.debug("[config-crm][tipo-servicio] reordenar OK", { a: a.id, b: b.id, ao, bo });
      }
      setBusyTipoServ(false);
    })();
  };

  const toggleActivoTipo = (t: ClienteTipoServicioRow, activo: boolean) => {
    if (!puedeConfig || busyTipoServ) return;
    void (async () => {
      setBusyTipoServ(true);
      setMensajeTipos({ err: undefined, ok: undefined });
      const id = t.id;
      const payload: { activo: boolean } = { activo };
      if (process.env.NODE_ENV === "development") {
        console.debug("[config-crm][tipo-servicio] toggleActivo", { id, payload });
      }
      const r = await apiFetch(`/api/cliente-tipos-servicio/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const resText = await r.clone().text();
      if (process.env.NODE_ENV === "development") {
        console.debug("[config-crm][tipo-servicio] toggleActivo resp", { id, status: r.status, body: resText });
      }
      if (!r.ok) {
        setMensajeTipos({ err: await leerErrorApiClientes(r) });
        setBusyTipoServ(false);
        return;
      }
      await loadTipos();
      setMensajeTipos({ ok: activo ? "Tipo activado correctamente." : "Tipo desactivado correctamente." });
      setBusyTipoServ(false);
    })();
  };

  return (
    <GlobalConfigSubpageShell
      title="Configuración CRM"
      description="Etapas del pipeline comercial y, por separado, los segmentos / tipos de servicio de la base de clientes."
    >
      <div className="space-y-5">
        {/* ── Funnel: siempre se ve el listado; edición con rol admin ── */}
        <ConfigFormCard>
          <ConfigSectionTitle>Estados del pipeline CRM</ConfigSectionTitle>
          <p className="mb-3 text-xs leading-relaxed text-slate-500">
            Columnas del embudo comercial. Si no tenés rol de administrador, la lista se muestra solo para referencia; no
            podés modificar.
          </p>
          {rolCargado && !puedeConfig && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
              <strong>Modo solo lectura</strong> para el pipeline. Para crear o editar etapas hace falta un rol de
              administración en el catálogo (misma regla que Facturación).{" "}
              <span className="block pt-1 text-amber-950/90">
                Rol detectado en catálogo: <span className="font-mono">{rolDetectado ?? "—"}</span>
              </span>
            </div>
          )}
          {!rolCargado && (
            <p className="mb-3 text-sm text-slate-400" role="status">
              Cargando permisos…
            </p>
          )}

          <p className="mb-4 text-xs leading-relaxed text-slate-400">
            Definí las etapas (columnas) del pipeline. Cada empresa tiene sus propias etapas.
          </p>
          <div className="space-y-4">
            {etapasCrm.length === 0 && rolCargado && (
              <p className="text-sm text-slate-500">Aún no hay etapas definidas. {puedeConfig && "Podés crear la primera abajo."}</p>
            )}
            {etapasCrm.map((e) => (
              <div key={e.id} className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
                <span className={`h-3 w-3 shrink-0 rounded-full ${getEtapaClasses(e.color).dot}`} />
                <div className="min-w-0 flex-1">
                  {puedeConfig && editandoEtapa === e.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        defaultValue={e.nombre}
                        id={`edit-nombre-${e.id}`}
                        className="w-32 rounded border px-2 py-1 text-sm"
                      />
                      <select id={`edit-color-${e.id}`} defaultValue={e.color} className="rounded border px-2 py-1 text-sm">
                        {["gray", "blue", "amber", "green", "red", "violet", "cyan", "pink"].map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        id={`edit-orden-${e.id}`}
                        defaultValue={e.orden}
                        className="w-16 rounded border px-2 py-1 text-sm"
                      />
                      <label className="flex items-center gap-1 text-xs">
                        <input type="checkbox" id={`edit-activo-${e.id}`} defaultChecked={e.activo} />
                        Activo
                      </label>
                      <button
                        type="button"
                        onClick={async () => {
                          const nombre = (document.getElementById(`edit-nombre-${e.id}`) as HTMLInputElement)?.value?.trim();
                          const color = (document.getElementById(`edit-color-${e.id}`) as HTMLSelectElement)?.value;
                          const orden = parseInt(
                            (document.getElementById(`edit-orden-${e.id}`) as HTMLInputElement)?.value ?? "0",
                            10
                          );
                          const activo = (document.getElementById(`edit-activo-${e.id}`) as HTMLInputElement)?.checked ?? true;
                          if (nombre) await updateEtapa(e.id, { nombre, color, orden, activo });
                          setEditandoEtapa(null);
                          loadEtapas();
                        }}
                        className="text-xs font-medium text-green-600 hover:text-green-800"
                      >
                        Guardar
                      </button>
                      <button type="button" onClick={() => setEditandoEtapa(null)} className="text-xs text-slate-500">
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="font-medium text-slate-800">{e.nombre}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        ({e.codigo}) · orden {e.orden}
                      </span>
                      {!e.activo && <span className="ml-1 text-xs text-amber-600">· Inactivo</span>}
                    </>
                  )}
                </div>
                {puedeConfig && editandoEtapa !== e.id && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => setEditandoEtapa(e.id)}
                      className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-white hover:text-slate-800"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (confirm("¿Eliminar esta etapa? Los prospectos en esta etapa quedarán sin etapa asignada.")) {
                          await deleteEtapa(e.id);
                          loadEtapas();
                        }
                      }}
                      className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 hover:text-red-800"
                    >
                      Eliminar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {puedeConfig && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <h5 className="mb-2 text-xs font-semibold text-slate-600">Crear nueva etapa</h5>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="mb-0.5 block text-[10px] text-slate-500">Nombre</label>
                  <input
                    type="text"
                    value={nuevaEtapa.nombre}
                    onChange={(ev) =>
                      setNuevaEtapa((prev) => ({
                        ...prev,
                        nombre: ev.target.value,
                        codigo: ev.target.value.replace(/\s+/g, "_").toUpperCase(),
                      }))
                    }
                    placeholder="Ej: Calificación"
                    className="w-32 rounded border px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] text-slate-500">Color</label>
                  <select
                    value={nuevaEtapa.color}
                    onChange={(ev) => setNuevaEtapa((prev) => ({ ...prev, color: ev.target.value }))}
                    className="rounded border px-2 py-1.5 text-sm"
                  >
                    {["gray", "blue", "amber", "green", "red", "violet", "cyan", "pink"].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] text-slate-500">Orden</label>
                  <input
                    type="number"
                    value={nuevaEtapa.orden || ""}
                    onChange={(ev) => setNuevaEtapa((prev) => ({ ...prev, orden: parseInt(ev.target.value, 10) || 0 }))}
                    className="w-16 rounded border px-2 py-1.5 text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (!nuevaEtapa.nombre.trim()) return;
                    const codigo = nuevaEtapa.codigo || nuevaEtapa.nombre.replace(/\s+/g, "_").toUpperCase();
                    const orden = nuevaEtapa.orden ?? (Math.max(0, ...etapasCrm.map((x) => x.orden), 0) + 1);
                    await createEtapa({ nombre: nuevaEtapa.nombre.trim(), codigo, color: nuevaEtapa.color, orden });
                    setNuevaEtapa({ nombre: "", codigo: "", color: "gray", orden: 0 });
                    loadEtapas();
                  }}
                  className="rounded bg-[#0EA5E9] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0284C7]"
                >
                  Crear etapa
                </button>
              </div>
            </div>
          )}
        </ConfigFormCard>

        {/* ── Tipos de servicio: card aparte, controles con rol admin ── */}
        <ConfigFormCard>
          <ConfigSectionTitle>Tipos de servicio / segmentos de cliente</ConfigSectionTitle>
          <p className="mb-3 text-xs leading-relaxed text-slate-500">
            Clasificá clientes para reportes, mora, cobranzas y análisis. Los nombres son editables; los códigos (slugs) de
            sistema no se reemplazan.
          </p>
          {rolCargado && !puedeConfig && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
              <strong>Modo solo lectura</strong> para los segmentos. Podés ver los nombres y el orden, pero no modificarlos
              sin rol de administración.{" "}
              <span className="block pt-1 text-amber-950/90">
                Rol detectado en catálogo: <span className="font-mono">{rolDetectado ?? "—"}</span>
              </span>
            </div>
          )}
          {puedeConfig && mensajeTipos.ok && (
            <p className="mb-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-800">{mensajeTipos.ok}</p>
          )}
          {mensajeTipos.err && (
            <p className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800" role="alert">
              {mensajeTipos.err}
            </p>
          )}

          {cargandoTipos ? (
            <p className="text-sm text-slate-400" role="status">
              Cargando segmentos…
            </p>
          ) : (
            <div className="space-y-2">
              {[...tiposServ].sort((a, b) => a.orden - b.orden).map((t, idx, arr) => {
                const editOpen = Boolean(puedeConfig && borradorTipo && borradorTipo.id === t.id);
                const usos = t.usos ?? 0;
                return (
                <div key={t.id} className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50/50 p-3">
                  {puedeConfig && (
                    <div className="flex flex-col gap-0.5 pt-0.5" aria-label="Cambiar orden">
                      <button
                        type="button"
                        disabled={idx === 0 || busyTipoServ}
                        onClick={() => reordenarTipo(t.id, "up")}
                        className="rounded border border-slate-200 px-1 text-xs leading-none text-slate-500 disabled:opacity-30"
                        aria-label="Subir"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={idx === arr.length - 1 || busyTipoServ}
                        onClick={() => reordenarTipo(t.id, "down")}
                        className="rounded border border-slate-200 px-1 text-xs leading-none text-slate-500 disabled:opacity-30"
                        aria-label="Bajar"
                      >
                        ↓
                      </button>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    {editOpen && borradorTipo ? (
                      <div className="flex flex-col gap-2">
                        <p className="text-[10px] text-slate-500">
                          <span className="font-mono">slug: {t.slug}</span>{" "}
                          {t.es_sistema ? "· fijo; solo nombre visible y orden" : "· no editable; se fija al crear"}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            value={borradorTipo.nombre}
                            onChange={(e) => setBorradorTipo((d) => (d ? { ...d, nombre: e.target.value } : d))}
                            className="w-48 min-w-0 rounded border px-2 py-1 text-sm"
                            aria-label="Nombre visible"
                          />
                          <input
                            value={borradorTipo.orden}
                            onChange={(e) => setBorradorTipo((d) => (d ? { ...d, orden: e.target.value } : d))}
                            type="text"
                            inputMode="numeric"
                            className="w-16 rounded border px-2 py-1 text-sm"
                            aria-label="Orden"
                          />
                          <label className="flex items-center gap-1 text-xs">
                            <input
                              type="checkbox"
                              checked={borradorTipo.activo}
                              onChange={(e) => setBorradorTipo((d) => (d ? { ...d, activo: e.target.checked } : d))}
                            />
                            Activo
                          </label>
                          <button
                            type="button"
                            disabled={busyTipoServ}
                            className="text-xs font-medium text-green-600 disabled:opacity-50"
                            onClick={async () => {
                              if (!borradorTipo.nombre.trim()) {
                                setMensajeTipos({ err: "El nombre es obligatorio." });
                                return;
                              }
                              setMensajeTipos({ err: undefined, ok: undefined });
                              setBusyTipoServ(true);
                              const ordStr = borradorTipo.orden.trim();
                              const ordParsed = parseInt(ordStr, 10);
                              const body: { nombre: string; activo: boolean; orden?: number } = {
                                nombre: borradorTipo.nombre.trim(),
                                activo: borradorTipo.activo,
                              };
                              if (ordStr !== "" && !Number.isNaN(ordParsed) && Number.isFinite(ordParsed)) {
                                body.orden = Math.trunc(ordParsed);
                              }
                              const id = t.id;
                              if (process.env.NODE_ENV === "development") {
                                console.debug("[config-crm][tipo-servicio] PUT", { id, payload: body });
                              }
                              const r = await apiFetch(`/api/cliente-tipos-servicio/${id}`, {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(body),
                              });
                              if (!r.ok) {
                                const errTxt = await leerErrorApiClientes(r);
                                if (process.env.NODE_ENV === "development") {
                                  console.debug("[config-crm][tipo-servicio] PUT error", { id, status: r.status, errTxt, payload: body });
                                }
                                setMensajeTipos({ err: errTxt });
                                setBusyTipoServ(false);
                                return;
                              }
                              let fila: ClienteTipoServicioRow;
                              try {
                                const jr = (await r.json()) as {
                                  success?: boolean;
                                  data?: ClienteTipoServicioRow;
                                  error?: string;
                                };
                                if (!jr?.success || !jr.data) {
                                  setMensajeTipos({
                                    err: jr?.error?.trim() || "Respuesta inválida (sin fila) de la API.",
                                  });
                                  setBusyTipoServ(false);
                                  return;
                                }
                                fila = jr.data;
                                if (process.env.NODE_ENV === "development") {
                                  console.debug("[config-crm][tipo-servicio] PUT cuerpo", { id, payload: body, fila });
                                }
                              } catch {
                                setMensajeTipos({ err: "No se pudo leer la respuesta JSON de la API." });
                                setBusyTipoServ(false);
                                return;
                              }
                              if (fila.nombre.trim() !== body.nombre.trim() || fila.activo !== body.activo) {
                                setMensajeTipos({
                                  err: "La API indicó éxito pero el registro devuelto no coincide con el nombre o estado enviado.",
                                });
                                setBusyTipoServ(false);
                                return;
                              }
                              if (body.orden !== undefined && fila.orden !== body.orden) {
                                setMensajeTipos({
                                  err: "La API indicó éxito pero el registro devuelto no coincide con el orden enviado.",
                                });
                                setBusyTipoServ(false);
                                return;
                              }
                              setBorradorTipo(null);
                              const reloaded = await loadTipos();
                              if (reloaded === null) {
                                setMensajeTipos({ err: "No se pudo recargar el catálogo." });
                                setBusyTipoServ(false);
                                return;
                              }
                              const f = reloaded.find((x) => x.id === id);
                              if (!f) {
                                setMensajeTipos({ err: "Tras guardar, el registro no aparece en el listado." });
                                setBusyTipoServ(false);
                                return;
                              }
                              const diverge: string[] = [];
                              if (f.nombre.trim() !== body.nombre.trim()) diverge.push("nombre");
                              if (f.activo !== body.activo) diverge.push("activo");
                              if (body.orden !== undefined && f.orden !== body.orden) diverge.push("orden");
                              if (diverge.length) {
                                setMensajeTipos({
                                  err: `La API respondió OK pero, al recargar el listado, no coincide: ${diverge.join(
                                    ", "
                                  )}. Reintentá; si continúa, el cambio no quedó persistido.`,
                                });
                              } else {
                                setMensajeTipos({ ok: "Tipo actualizado correctamente." });
                              }
                              setBusyTipoServ(false);
                            }}
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            className="text-xs text-slate-500"
                            disabled={busyTipoServ}
                            onClick={() => {
                              setBorradorTipo(null);
                              setMensajeTipos({ err: undefined, ok: undefined });
                            }}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-slate-800">{t.nombre}</p>
                        <p className="text-xs text-slate-500">
                          <span className="font-mono">{t.slug}</span>
                          {t.es_sistema ? " · [sistema]" : " · [personalizado]"}
                          {" · "}
                          orden {t.orden}
                          {typeof t.usos === "number" ? ` · ${t.usos} cliente(s)` : null}
                          {!t.activo && <span className="ml-1 text-amber-600">· inactivo</span>}
                        </p>
                        {puedeConfig && (t.usos ?? 0) > 0 && t.es_sistema && (
                          <p className="mt-1 text-[10px] text-slate-500">
                            Con clientes: podés <strong>desactivar</strong> el segmento; no se puede eliminar el slug de
                            sistema.
                          </p>
                        )}
                        {puedeConfig && (t.usos ?? 0) > 0 && !t.es_sistema && (
                          <p className="mt-1 text-[10px] text-amber-800/90">
                            No se puede eliminar porque tiene {usos} cliente(s) vinculado(s). Podés desactivarlo o reasignar
                            esos clientes a otro segmento.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                  {puedeConfig && !editOpen && (
                    <div className="flex min-w-0 max-w-[11rem] flex-col gap-1 text-right sm:max-w-none sm:flex-row sm:items-center sm:justify-end sm:gap-1.5">
                      <button
                        type="button"
                        className="whitespace-nowrap text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50"
                        disabled={busyTipoServ}
                        onClick={() => {
                          setMensajeTipos({ err: undefined, ok: undefined });
                          setBorradorTipo({ id: t.id, nombre: t.nombre, orden: String(t.orden), activo: t.activo });
                        }}
                      >
                        Editar
                      </button>
                      {t.activo ? (
                        <button
                          type="button"
                          className="whitespace-nowrap text-xs text-amber-700 hover:underline disabled:opacity-50"
                          disabled={busyTipoServ}
                          onClick={() => toggleActivoTipo(t, false)}
                        >
                          Desactivar
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="whitespace-nowrap text-xs text-emerald-700 hover:underline disabled:opacity-50"
                          disabled={busyTipoServ}
                          onClick={() => toggleActivoTipo(t, true)}
                        >
                          Activar
                        </button>
                      )}
                      {!t.es_sistema && usos === 0 && (
                        <button
                          type="button"
                          className="whitespace-nowrap text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                          disabled={busyTipoServ}
                          onClick={async () => {
                            if (!window.confirm("¿Eliminar permanentemente este segmento? (sin clientes vinculados)")) {
                              return;
                            }
                            setMensajeTipos({ err: undefined, ok: undefined });
                            setBusyTipoServ(true);
                            if (process.env.NODE_ENV === "development") {
                              console.debug("[config-crm][tipo-servicio] DELETE", { id: t.id });
                            }
                            const r = await apiFetch(`/api/cliente-tipos-servicio/${t.id}`, { method: "DELETE" });
                            const raw = await r.clone().text();
                            if (process.env.NODE_ENV === "development") {
                              let parsed: unknown = raw;
                              try { parsed = JSON.parse(raw) as unknown; } catch { /* */ }
                              console.debug("[config-crm][tipo-servicio] DELETE resp", { id: t.id, status: r.status, cuerpo: parsed });
                            }
                            if (!r.ok) {
                              setMensajeTipos({ err: await leerErrorApiClientes(r) });
                              setBusyTipoServ(false);
                              return;
                            }
                            await loadTipos();
                            setMensajeTipos({ ok: "Segmento eliminado correctamente." });
                            setBusyTipoServ(false);
                          }}
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  )}
                </div>
                );
              })}

              {puedeConfig && (
                <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
                  <div>
                    <span className="mb-0.5 block text-[10px] text-slate-500">Nuevo segmento (nombre en pantalla)</span>
                    <input
                      value={nuevoTipoNombre}
                      onChange={(e) => setNuevoTipoNombre(e.target.value)}
                      placeholder="Ej. Consultoría contable"
                      className="w-56 rounded border px-2 py-1.5 text-sm"
                      disabled={busyTipoServ}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busyTipoServ}
                    className="rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50"
                    onClick={async () => {
                      if (!nuevoTipoNombre.trim()) return;
                      setMensajeTipos({ err: undefined, ok: undefined });
                      setBusyTipoServ(true);
                      const nombre = nuevoTipoNombre.trim();
                      if (process.env.NODE_ENV === "development") {
                        console.debug("[config-crm][tipo-servicio] POST", { payload: { nombre } });
                      }
                      const r = await apiFetch("/api/cliente-tipos-servicio", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ nombre }),
                      });
                      const raw = await r.clone().text();
                      if (process.env.NODE_ENV === "development") {
                        let parsed: unknown = raw;
                        try { parsed = JSON.parse(raw) as unknown; } catch { /* */ }
                        console.debug("[config-crm][tipo-servicio] POST respuesta", { status: r.status, cuerpo: parsed });
                        if (!r.ok) {
                          console.debug("[config-crm][tipo-servicio] POST error", { status: r.status, raw });
                        }
                      }
                      if (!r.ok) {
                        setMensajeTipos({ err: await leerErrorApiClientes(r) });
                        setBusyTipoServ(false);
                        return;
                      }
                      setNuevoTipoNombre("");
                      await loadTipos();
                      setMensajeTipos({
                        ok: "Segmento creado correctamente. Debería aparecer en Clientes → Nuevo al recargar la página de alta.",
                      });
                      setBusyTipoServ(false);
                    }}
                  >
                    Agregar tipo
                  </button>
                </div>
              )}
            </div>
          )}
        </ConfigFormCard>
      </div>
    </GlobalConfigSubpageShell>
  );
}
