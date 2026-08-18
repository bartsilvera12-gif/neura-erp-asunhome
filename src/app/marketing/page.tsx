"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getMetricasCumplimiento, updateTaskStatus } from "@/lib/marketing/storage";
import type { MarketingOpsClienteResumen } from "@/lib/marketing/ops-queries";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { MarketingTask } from "@/lib/marketing/types";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Megaphone,
  RefreshCw,
  Sparkles,
  Target,
  Users,
} from "lucide-react";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function esCumplida(t: MarketingTask): boolean {
  return t.estado === "aprobado" || t.estado === "publicado";
}

function estiloTarea(t: MarketingTask, hoyYmd: string): string {
  if (esCumplida(t)) return "bg-green-100 border-green-200 text-green-800";
  if (t.fecha_entrega < hoyYmd) return "bg-red-100 border-red-200 text-red-800";
  return "bg-amber-50 border-amber-200 text-amber-700";
}

function nombreClienteOps(c: MarketingOpsClienteResumen): string {
  return (c.empresa ?? c.nombre_contacto ?? c.nombre ?? "Cliente").trim() || "Cliente";
}

export default function MarketingOpsPage() {
  const mesActual = new Date().toISOString().slice(0, 7);
  const [mes, setMes] = useState(mesActual);
  const [tareas, setTareas] = useState<MarketingTask[]>([]);
  const [clientesOps, setClientesOps] = useState<MarketingOpsClienteResumen[]>([]);
  const [metricas, setMetricas] = useState({ total: 0, completadas: 0, porcentaje: 0 });
  const [hoyYmd, setHoyYmd] = useState(() => new Date().toISOString().slice(0, 10));
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [expandidoId, setExpandidoId] = useState<string | null>(null);

  const [modalTarea, setModalTarea] = useState<MarketingTask | null>(null);
  const [marcandoCumplida, setMarcandoCumplida] = useState(false);

  const [regenerarCliente, setRegenerarCliente] = useState<MarketingOpsClienteResumen | null>(null);
  const [regenerando, setRegenerando] = useState(false);

  const [syncPreview, setSyncPreview] = useState<{
    clientes_a_marcar_count: number;
    tareas_a_generar_count: number;
    clientes_a_marcar: { id: string; nombre: string }[];
  } | null>(null);
  const [syncEjecutando, setSyncEjecutando] = useState(false);
  const [syncMostrarPreview, setSyncMostrarPreview] = useState(false);
  const [ultimoSyncMsg, setUltimoSyncMsg] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/marketing/ops?mes=${encodeURIComponent(mes)}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setErrorCarga(typeof json.error === "string" ? json.error : "No se pudo cargar Marketing Ops");
        setTareas([]);
        setClientesOps([]);
        setMetricas({ total: 0, completadas: 0, porcentaje: 0 });
        return;
      }
      const d = json.data as {
        mes: string;
        hoy: string;
        clientes: MarketingOpsClienteResumen[];
        tareas: MarketingTask[];
        metricas: { total: number; completadas: number; porcentaje: number };
      };
      setTareas(Array.isArray(d.tareas) ? d.tareas : []);
      setClientesOps(Array.isArray(d.clientes) ? d.clientes : []);
      setMetricas(d.metricas ?? { total: 0, completadas: 0, porcentaje: 0 });
      if (typeof d.hoy === "string" && d.hoy.length >= 10) setHoyYmd(d.hoy.slice(0, 10));
    } catch {
      setErrorCarga("Error de red al cargar Marketing Ops");
      setTareas([]);
      setClientesOps([]);
      setMetricas({ total: 0, completadas: 0, porcentaje: 0 });
    } finally {
      setCargando(false);
    }
  }, [mes]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const [ano, mesNum] = mes.split("-").map(Number);

  const tareasPorCliente = useMemo(() => {
    const map = new Map<string, MarketingTask[]>();
    for (const t of tareas) {
      const list = map.get(t.cliente_id) ?? [];
      list.push(t);
      map.set(t.cliente_id, list);
    }
    return map;
  }, [tareas]);

  const grupoPorDiaPorCliente = useMemo(() => {
    const map = new Map<string, Map<string, MarketingTask[]>>();
    for (const [cid, list] of tareasPorCliente) {
      const porDia = new Map<string, MarketingTask[]>();
      for (const t of list) {
        const l = porDia.get(t.fecha_entrega) ?? [];
        l.push(t);
        porDia.set(t.fecha_entrega, l);
      }
      map.set(cid, porDia);
    }
    return map;
  }, [tareasPorCliente]);

  const diasDelMes = useMemo(() => {
    const ultimo = new Date(ano, mesNum, 0).getDate();
    const dias: string[] = [];
    for (let d = 1; d <= ultimo; d++) {
      dias.push(`${mes}-${String(d).padStart(2, "0")}`);
    }
    return dias;
  }, [mes, ano, mesNum]);

  const atrasadas = useMemo(
    () => tareas.filter((t) => t.fecha_entrega < hoyYmd && !esCumplida(t)),
    [tareas, hoyYmd]
  );
  const tareasHoy = useMemo(() => tareas.filter((t) => t.fecha_entrega === hoyYmd), [tareas, hoyYmd]);
  const finSemana = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  }, []);
  const semana = useMemo(
    () => tareas.filter((t) => t.fecha_entrega > hoyYmd && t.fecha_entrega <= finSemana),
    [tareas, hoyYmd, finSemana]
  );

  async function handlePreviewSync() {
    setUltimoSyncMsg(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/marketing/sync?preview=1&mes=${encodeURIComponent(mes)}`);
      const json = await res.json();
      if (res.status === 403) {
        setUltimoSyncMsg("Sincronizar requiere usuario administrador.");
        return;
      }
      if (res.ok && json.data) {
        setSyncPreview({
          clientes_a_marcar_count: json.data.resumen?.clientes_a_marcar_count ?? 0,
          tareas_a_generar_count: json.data.resumen?.tareas_a_generar_count ?? 0,
          clientes_a_marcar: json.data.clientes_a_marcar ?? [],
        });
        setSyncMostrarPreview(true);
      } else {
        setUltimoSyncMsg(typeof json.error === "string" ? json.error : "No se pudo obtener el preview");
      }
    } catch {
      setUltimoSyncMsg("Error de red en preview de sincronización");
    }
  }

  async function handleExecuteSync() {
    setSyncEjecutando(true);
    setUltimoSyncMsg(null);
    try {
      const res = await fetchWithSupabaseSession("/api/marketing/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes, confirmar: true }),
      });
      const json = await res.json();
      if (res.status === 403) {
        setUltimoSyncMsg("Sincronizar requiere usuario administrador.");
        return;
      }
      if (res.ok && json.success) {
        setSyncMostrarPreview(false);
        setSyncPreview(null);
        await cargar();
        const d = json.data as {
          tareas_eliminadas?: number;
          tareas_generadas?: number;
          clientes_actualizados?: number;
          errores?: string[];
          clientes_sincronizar_errores?: string[];
        };
        if (d) {
          const partes = [
            typeof d.clientes_actualizados === "number" && `Clientes tipificados: ${d.clientes_actualizados}`,
            typeof d.tareas_eliminadas === "number" && d.tareas_eliminadas > 0 && `Eliminadas: ${d.tareas_eliminadas}`,
            typeof d.tareas_generadas === "number" && `Generadas: ${d.tareas_generadas}`,
          ].filter(Boolean) as string[];
          setUltimoSyncMsg(partes.length ? partes.join(" · ") : "Sincronización completada.");
          const err = [...(d.clientes_sincronizar_errores ?? []), ...(d.errores ?? [])].filter(Boolean);
          if (err.length) {
            setUltimoSyncMsg((prev) => `${prev ?? "Listo."}\n\nAdvertencias:\n${err.slice(0, 8).join("\n")}${err.length > 8 ? "\n…" : ""}`);
          }
        }
      } else {
        setUltimoSyncMsg(typeof json.error === "string" ? json.error : "Error al sincronizar");
      }
    } catch {
      setUltimoSyncMsg("Error de red al sincronizar");
    } finally {
      setSyncEjecutando(false);
    }
  }

  async function handleMarcarCumplida(tarea: MarketingTask) {
    setMarcandoCumplida(true);
    const actualizada = await updateTaskStatus(tarea.id, "aprobado");
    setMarcandoCumplida(false);
    setModalTarea(null);
    if (actualizada) {
      setTareas((prev) => prev.map((t) => (t.id === tarea.id ? actualizada : t)));
      const met = await getMetricasCumplimiento(mes);
      setMetricas(met);
      await cargar();
    }
  }

  async function handleRegenerarTareas(cli: MarketingOpsClienteResumen) {
    setRegenerando(true);
    try {
      const res = await fetchWithSupabaseSession("/api/marketing/regenerar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes, cliente_id: cli.id, confirmar: true }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setRegenerarCliente(null);
        await cargar();
        setUltimoSyncMsg(`Tareas regeneradas para ${nombreClienteOps(cli)}.`);
      } else {
        setUltimoSyncMsg(typeof json.error === "string" ? json.error : "Error al regenerar tareas");
      }
    } catch {
      setUltimoSyncMsg("Error de red al regenerar tareas");
    } finally {
      setRegenerando(false);
    }
  }

  if (cargando && tareas.length === 0 && clientesOps.length === 0) {
    return (
      <div className="min-h-[50vh] space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="h-9 w-56 rounded-lg bg-slate-200/80 animate-pulse" />
          <div className="h-10 w-48 rounded-lg bg-slate-200/80 animate-pulse" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-slate-100 animate-pulse border border-slate-200/80" />
          ))}
        </div>
        <div className="h-40 rounded-xl bg-slate-100 animate-pulse border border-slate-200/80" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-slate-200/90 pb-5">
        <div className="flex gap-3">
          <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
            <Megaphone className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Marketing Ops</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Calendario y cumplimiento por cliente · schema de datos de la empresa
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white shadow-sm"
            aria-label="Mes operativo"
          >
            {Array.from({ length: 24 }, (_, i) => {
              const d = new Date();
              d.setMonth(d.getMonth() - 6 + i);
              const y = d.getFullYear();
              const m = String(d.getMonth() + 1).padStart(2, "0");
              const val = `${y}-${m}`;
              return (
                <option key={val} value={val}>
                  {MESES[d.getMonth()]} {y}
                </option>
              );
            })}
          </select>
          <button
            type="button"
            onClick={() => void cargar()}
            disabled={cargando}
            className="inline-flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
            Actualizar
          </button>
          <button
            type="button"
            onClick={() => void handlePreviewSync()}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-[#0EA5E9] hover:bg-[#0284C7] text-white shadow-sm"
          >
            <Sparkles className="h-4 w-4" />
            Sincronizar y regenerar mes
          </button>
        </div>
      </div>

      {errorCarga && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">No se pudo cargar el panel</p>
            <p className="text-red-700/90 mt-0.5">{errorCarga}</p>
          </div>
        </div>
      )}

      {ultimoSyncMsg && !syncMostrarPreview && (
        <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 whitespace-pre-wrap">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-sky-600 mt-0.5" />
          <div className="min-w-0">
            <p className="font-semibold text-sky-950">Última operación</p>
            <p className="text-sky-900/90 mt-0.5">{ultimoSyncMsg}</p>
            <button
              type="button"
              className="mt-2 text-xs font-medium text-sky-700 hover:underline"
              onClick={() => setUltimoSyncMsg(null)}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="rounded-xl border border-red-100 bg-gradient-to-br from-red-50 to-white p-4 shadow-sm">
          <p className="text-[11px] font-semibold text-red-600 uppercase tracking-wide">Atrasadas</p>
          <p className="text-2xl font-bold text-red-800 tabular-nums">{atrasadas.length}</p>
          <p className="text-[11px] text-red-600/80 mt-1">Vencidas y sin aprobar</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-gradient-to-br from-amber-50 to-white p-4 shadow-sm">
          <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">Hoy</p>
          <p className="text-2xl font-bold text-amber-900 tabular-nums">{tareasHoy.length}</p>
          <p className="text-[11px] text-amber-700/80 mt-1">Entregas con fecha {hoyYmd}</p>
        </div>
        <div className="rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-4 shadow-sm">
          <p className="text-[11px] font-semibold text-blue-700 uppercase tracking-wide">Esta semana</p>
          <p className="text-2xl font-bold text-blue-900 tabular-nums">{semana.length}</p>
          <p className="text-[11px] text-blue-700/80 mt-1">Próximos 7 días</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 shadow-sm">
          <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1">
            <Users className="h-3.5 w-3.5" /> Cartera marketing
          </p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{clientesOps.length}</p>
          <p className="text-[11px] text-slate-500 mt-1">Plan marketing activo o servicio marketing</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm col-span-2 lg:col-span-1">
          <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide flex items-center gap-1">
            <Target className="h-3.5 w-3.5" /> Cumplimiento {mes}
          </p>
          <p className="text-2xl font-bold text-emerald-900 tabular-nums">{metricas.porcentaje}%</p>
          <p className="text-[11px] text-emerald-700/80 mt-1">
            {metricas.completadas}/{metricas.total} tareas cerradas
          </p>
        </div>
      </div>

      {syncMostrarPreview && syncPreview && (
        <div
          className="fixed inset-0 bg-black/45 flex items-center justify-center z-50 p-4"
          onClick={() => setSyncMostrarPreview(false)}
          role="presentation"
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-100"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sync-dialog-title"
          >
            <h3 id="sync-dialog-title" className="text-lg font-bold text-slate-900 mb-2">
              Sincronizar y regenerar — {MESES[mesNum - 1]} {ano}
            </h3>
            <p className="text-sm text-slate-600 mb-3">
              Se eliminan las tareas <strong>automáticas</strong> del mes y se vuelven a generar según la plantilla de
              cada plan de marketing. Las tareas manuales no se tocan.
            </p>
            <ul className="text-sm text-slate-700 space-y-1 mb-4">
              <li>
                <strong>{syncPreview.clientes_a_marcar_count}</strong> clientes a tipificar como marketing
              </li>
              <li>
                ~<strong>{syncPreview.tareas_a_generar_count}</strong> tareas nuevas (estimado, slots libres)
              </li>
            </ul>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleExecuteSync()}
                disabled={syncEjecutando}
                className="inline-flex items-center justify-center gap-2 bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50 min-w-[120px]"
              >
                {syncEjecutando ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" /> Ejecutando…
                  </>
                ) : (
                  "Confirmar"
                )}
              </button>
              <button
                type="button"
                onClick={() => setSyncMostrarPreview(false)}
                className="border border-slate-200 px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {regenerarCliente && (
        <div
          className="fixed inset-0 bg-black/45 flex items-center justify-center z-50 p-4"
          onClick={() => setRegenerarCliente(null)}
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-100" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900 mb-2">Regenerar tareas del mes</h3>
            <p className="text-sm text-slate-600 mb-4">
              Se eliminarán las <strong>tareas automáticas</strong> de{" "}
              <strong>{nombreClienteOps(regenerarCliente)}</strong> en <strong>
                {MESES[mesNum - 1]} {ano}
              </strong>{" "}
              y se generarán nuevas según la plantilla actual del plan.
            </p>
            <p className="text-xs text-amber-700 mb-4 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              Las tareas manuales no se modifican.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => void handleRegenerarTareas(regenerarCliente)}
                disabled={regenerando}
                className="flex-1 bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {regenerando ? "Regenerando…" : "Confirmar"}
              </button>
              <button
                type="button"
                onClick={() => setRegenerarCliente(null)}
                disabled={regenerando}
                className="border border-slate-200 px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {modalTarea && (
        <div className="fixed inset-0 bg-black/45 flex items-center justify-center z-50 p-4" onClick={() => setModalTarea(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 border border-slate-100" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900 mb-2">¿Se cumplió esta tarea?</h3>
            <p className="text-sm text-slate-600 mb-4 capitalize">
              {modalTarea.tipo_contenido} — {modalTarea.fecha_entrega}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => void handleMarcarCumplida(modalTarea)}
                disabled={marcandoCumplida}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {marcandoCumplida ? "…" : "Sí, aprobada"}
              </button>
              <button
                type="button"
                onClick={() => setModalTarea(null)}
                className="flex-1 border border-slate-200 px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-slate-50"
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            Clientes — {MESES[mesNum - 1]} {ano}
          </h2>
          {cargando && (clientesOps.length > 0 || tareas.length > 0) && (
            <span className="text-xs text-slate-400 inline-flex items-center gap-1">
              <RefreshCw className="h-3 w-3 animate-spin" /> Actualizando…
            </span>
          )}
        </div>

        {clientesOps.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white border border-slate-200 text-slate-400 mb-3">
              <Users className="h-6 w-6" />
            </div>
            <p className="text-slate-800 font-semibold">No hay clientes en cartera marketing para este período</p>
            <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
              Debe existir al menos una <strong>suscripción activa</strong> a un plan con{" "}
              <strong>«Plan de marketing»</strong> y <strong>plantilla operativa</strong> con ítems, o un cliente con
              tipo de servicio <strong>marketing</strong>.
            </p>
            <p className="text-xs text-slate-400 mt-4">
              Si ya cumplís eso y no ves datos, ejecutá <strong>Sincronizar y regenerar mes</strong> (requiere admin) o
              revisá que el plan tenga <code className="text-[11px] bg-slate-100 px-1 rounded">es_plan_marketing</code>{" "}
              en la base.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="hidden md:grid grid-cols-[1.4fr_1fr_0.7fr_0.7fr_0.7fr_0.7fr_1fr_auto] gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 px-4 py-2 border-b border-slate-200">
              <span>Cliente</span>
              <span>Plan</span>
              <span className="text-center">Cupo mes</span>
              <span className="text-center">Hechas</span>
              <span className="text-center">Pend.</span>
              <span className="text-center">Atras.</span>
              <span>Próxima</span>
              <span />
            </div>
            {clientesOps.map((c) => {
              const expandido = expandidoId === c.id;
              const grupoPorDia = grupoPorDiaPorCliente.get(c.id) ?? new Map<string, MarketingTask[]>();
              const cupoMes = c.tareas_total;
              const pct = cupoMes > 0 ? Math.round((c.tareas_completadas / cupoMes) * 100) : 0;

              return (
                <div
                  key={c.id}
                  className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => setExpandidoId(expandido ? null : c.id)}
                    className="w-full text-left px-4 py-3 md:py-2 hover:bg-slate-50/90 transition-colors"
                  >
                    <div className="flex flex-col md:grid md:grid-cols-[1.4fr_1fr_0.7fr_0.7fr_0.7fr_0.7fr_1fr_auto] md:items-center gap-2 md:gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {expandido ? (
                          <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate">{nombreClienteOps(c)}</p>
                          <p className="text-[11px] text-slate-500 md:hidden">
                            {c.plan_marketing_nombre ?? "—"} · {pct}% cumplido
                          </p>
                        </div>
                      </div>
                      <div className="hidden md:block text-sm text-slate-600 truncate pl-6 md:pl-0">
                        {c.plan_marketing_nombre ?? (
                          <span className="text-slate-400 italic">Sin plan vinculado</span>
                        )}
                        {c.por_suscripcion_marketing && c.tipo_servicio_cliente !== "marketing" && (
                          <span className="ml-1 text-[10px] text-amber-700 font-medium">(sync pendiente)</span>
                        )}
                      </div>
                      <div className="hidden md:block text-center text-sm font-medium tabular-nums text-slate-800">
                        {cupoMes}
                      </div>
                      <div className="hidden md:block text-center text-sm font-medium tabular-nums text-emerald-700">
                        {c.tareas_completadas}
                      </div>
                      <div className="hidden md:block text-center text-sm font-medium tabular-nums text-amber-800">
                        {c.tareas_pendientes}
                      </div>
                      <div className="hidden md:block text-center text-sm font-medium tabular-nums text-red-700">
                        {c.tareas_atrasadas}
                      </div>
                      <div className="hidden md:flex items-center gap-1 text-sm text-slate-600">
                        <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span>{c.proxima_entrega ?? "—"}</span>
                      </div>
                      <div className="hidden md:flex justify-end">
                        <span
                          className={`text-xs font-semibold px-2 py-1 rounded-full ${
                            pct >= 100 ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {pct}%
                        </span>
                      </div>
                    </div>
                  </button>

                  {expandido && (
                    <div className="border-t border-slate-100 p-4 bg-slate-50/60">
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                        <div className="text-xs text-slate-600 space-y-1">
                          <p>
                            <span className="font-medium text-slate-800">Resumen:</span> {c.tareas_completadas}{" "}
                            completadas · {c.tareas_pendientes} pendientes · {c.tareas_atrasadas} atrasadas
                          </p>
                          {c.proxima_entrega && (
                            <p>
                              Próxima entrega: <strong>{c.proxima_entrega}</strong>
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRegenerarCliente(c);
                          }}
                          className="text-sm font-medium px-4 py-2 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-200/80"
                        >
                          Regenerar tareas de este cliente
                        </button>
                      </div>
                      <div className="overflow-x-auto rounded-lg border border-slate-200/80 bg-white">
                        <div className="grid grid-cols-7 min-w-[640px] gap-1 p-2" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
                          {["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((d) => (
                            <div key={d} className="text-center text-[10px] font-semibold text-slate-500 py-1">
                              {d}
                            </div>
                          ))}
                          {Array.from(
                            { length: diasDelMes.length ? new Date(ano, mesNum - 1, 1).getDay() : 0 },
                            (_, i) => <div key={`e-${i}`} className="min-h-[72px]" />
                          )}
                          {diasDelMes.map((fecha) => {
                            const tareasDia = grupoPorDia.get(fecha) ?? [];
                            const esHoy = fecha === hoyYmd;
                            return (
                              <div
                                key={fecha}
                                className={`min-h-[72px] p-1.5 rounded-lg border text-left ${
                                  esHoy ? "border-sky-400 bg-sky-50/90" : "border-slate-200 bg-white"
                                }`}
                              >
                                <span className="text-[10px] font-semibold text-slate-500">{fecha.slice(8)}</span>
                                <div className="mt-1 space-y-0.5">
                                  {tareasDia.map((t) => (
                                    <button
                                      key={t.id}
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setModalTarea(t);
                                      }}
                                      className={`block w-full text-left text-[10px] leading-tight truncate px-1 py-0.5 rounded border cursor-pointer hover:opacity-90 ${estiloTarea(t, hoyYmd)}`}
                                    >
                                      {t.tipo_contenido}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
