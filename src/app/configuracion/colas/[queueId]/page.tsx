"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ChatChannelRow } from "@/lib/chat/actions";
import type {
  ChatQueueAdminRow,
  QueueAgentRow,
  QueueClosureTaxonomyInput,
  UsuarioPickRow,
} from "@/lib/chat/queue-admin-repo";
import {
  DEFAULT_QUEUE_ROUTING_CONFIG,
  parseQueueRoutingConfig,
  serializeQueueRoutingConfig,
  type QueueRoutingConfig,
} from "@/lib/chat/queue-routing-config";
import {
  apiAddQueueAgent,
  apiDeleteQueue,
  apiQueueEditorBootstrap,
  apiRemoveQueueAgent,
  apiSaveClosureTaxonomy,
  apiSaveQueue,
  apiSetQueueChannelLinks,
  apiUpdateQueueAgent,
} from "../queue-admin-api";
import { queueEditorRouteId } from "../queue-route-params";
import { getMisModulos } from "@/lib/empresas/actions";

function hasOmnichannel(slugs: string[]) {
  return slugs.includes("conversaciones") || slugs.includes("omnicanal");
}

const STRATS: { value: string; label: string; hint: string }[] = [
  {
    value: "round_robin",
    label: "Circular",
    hint: "Recorre agentes en orden y vuelve a empezar (1, 2, 3…).",
  },
  {
    value: "least_load",
    label: "Menor carga",
    hint: "Asigna al agente con menos chats activos en este momento.",
  },
  {
    value: "manual_pull",
    label: "Manual",
    hint: "No autoasigna conversaciones nuevas; queda para toma manual.",
  },
];

export default function EditarColaPage() {
  const router = useRouter();
  const params = useParams();
  const queueId = queueEditorRouteId(params?.queueId as string | string[] | undefined);

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [queue, setQueue] = useState<ChatQueueAdminRow | null>(null);
  const [channels, setChannels] = useState<ChatChannelRow[]>([]);
  const [linked, setLinked] = useState<string[]>([]);
  const [agents, setAgents] = useState<QueueAgentRow[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioPickRow[]>([]);
  const [pickUser, setPickUser] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [bootstrapWarnings, setBootstrapWarnings] = useState<string[]>([]);

  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [legacyChannelType, setLegacyChannelType] = useState<string>("");
  const [strategy, setStrategy] = useState("least_load");
  const [priority, setPriority] = useState(0);
  const [routing, setRouting] = useState<QueueRoutingConfig>(DEFAULT_QUEUE_ROUTING_CONFIG);
  /** Estados y subestados de cierre (modal «Finalizar» del asesor); se guardan aparte de la cola. */
  const [closureDraft, setClosureDraft] = useState<{ label: string; substates: { label: string }[] }[]>([]);
  const [closureSaving, setClosureSaving] = useState(false);

  const load = useCallback(async () => {
    if (!queueId) return;
    setLoading(true);
    setError(null);
    setBootstrapWarnings([]);
    try {
      const boot = await apiQueueEditorBootstrap(queueId);
      const q = boot.queue;
      setQueue(q);
      setBootstrapWarnings(Array.isArray(boot.bootstrapWarnings) ? boot.bootstrapWarnings : []);
      setChannels(boot.channels as ChatChannelRow[]);
      setLinked(boot.linked.map((l) => l.channel_id));
      setAgents(boot.agents);
      setUsuarios(boot.usuarios);
      if (q) {
        setNombre(q.nombre);
        setDescripcion(q.descripcion ?? "");
        setIsActive(q.is_active);
        setLegacyChannelType(q.channel_type ?? "");
        setStrategy(q.distribution_strategy ?? "least_load");
        setPriority(q.priority ?? 0);
        setRouting(parseQueueRoutingConfig(q.routing_config));
      }
      setClosureDraft(
        (boot.closure_taxonomy ?? []).map((s) => ({
          label: s.label,
          substates: (s.substates ?? []).map((sub) => ({ label: sub.label })),
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [queueId]);

  useEffect(() => {
    getMisModulos()
      .then((mods) => setAllowed(hasOmnichannel(mods.map((m) => m.slug))))
      .catch(() => setAllowed(false));
  }, []);

  useEffect(() => {
    if (allowed && queueId) void load();
  }, [allowed, queueId, load]);

  async function handleSaveQueue() {
    if (!queueId) return;
    setSaving(true);
    setError(null);
    try {
      await apiSaveQueue(queueId, {
        nombre,
        descripcion: descripcion || null,
        is_active: isActive,
        channel_type: linked.length > 0 ? null : legacyChannelType.trim() || null,
        distribution_strategy: strategy,
        priority,
        routing_config: serializeQueueRoutingConfig(routing),
      });
      await apiSetQueueChannelLinks(queueId, linked);
      router.push("/configuracion/colas?cola_guardada=1");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveClosureTaxonomy() {
    if (!queueId) return;
    setClosureSaving(true);
    setError(null);
    try {
      const states: QueueClosureTaxonomyInput[] = closureDraft
        .map((s, i) => ({
          label: s.label.trim(),
          sort_order: i,
          substates: s.substates
            .map((sub, j) => ({ label: sub.label.trim(), sort_order: j }))
            .filter((sub) => sub.label.length > 0),
        }))
        .filter((s) => s.label.length > 0);
      await apiSaveClosureTaxonomy(queueId, states);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar estados de cierre");
    } finally {
      setClosureSaving(false);
    }
  }

  async function handleAddAgent() {
    if (!pickUser) return;
    setError(null);
    try {
      await apiAddQueueAgent(queueId, pickUser);
      setPickUser("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }

  async function handleDeleteQueue() {
    if (!confirm("¿Eliminar esta cola? Los agentes asociados se eliminarán.")) return;
    try {
      await apiDeleteQueue(queueId);
      router.push("/configuracion/colas");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al eliminar");
    }
  }

  if (allowed === null || loading) {
    return <div className="py-24 text-center text-sm text-slate-400">Cargando…</div>;
  }

  if (!allowed) {
    return (
      <div className="max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Sin acceso. <Link href="/configuracion">Volver</Link>
      </div>
    );
  }

  if (error && !queue) {
    return (
      <div className="max-w-xl space-y-4">
        <p className="text-slate-800 font-medium">No se pudo cargar la cola</p>
        <p className="text-sm text-red-700 rounded-xl border border-red-200 bg-red-50 px-4 py-3">{error}</p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl bg-[#0EA5E9] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0284C7]"
          >
            Reintentar
          </button>
          <Link href="/configuracion/colas" className="text-sm font-semibold text-[#0EA5E9] hover:underline inline-flex items-center">
            Volver al listado
          </Link>
        </div>
      </div>
    );
  }

  if (!queue) {
    return (
      <div className="max-w-xl space-y-4">
        <p className="text-slate-700">Cola no encontrada.</p>
        <Link href="/configuracion/colas" className="text-sm font-semibold text-[#0EA5E9] hover:underline">
          Volver
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-3xl pb-12">
      <nav className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/configuracion/colas" className="hover:text-slate-800">
          Colas
        </Link>
        <span>/</span>
        <span className="text-slate-800 font-medium truncate">{nombre}</span>
      </nav>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {bootstrapWarnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 space-y-2">
          {bootstrapWarnings.map((w, i) => (
            <p key={i} className={i === 0 ? "font-medium" : ""}>
              {w}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Editar cola</h1>
        <button
          type="button"
          onClick={() => void handleDeleteQueue()}
          className="text-sm font-semibold text-red-600 hover:underline"
        >
          Eliminar cola
        </button>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Datos generales</h2>
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Nombre</label>
          <input
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Descripción</label>
          <textarea
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[72px]"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Prioridad numérica</label>
            <input
              type="number"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value) || 0)}
            />
            <p className="text-xs text-slate-400 mt-1">Mayor número = mayor prioridad al elegir cola.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 sm:mt-6">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Cola activa
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Estrategia de distribución</h2>
          <p className="text-sm text-slate-500 mt-1">Define cómo se reparten los chats nuevos entre los agentes de esta cola.</p>
        </div>
        <div className="space-y-3">
          {STRATS.map((s) => (
            <label
              key={s.value}
              className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${
                strategy === s.value ? "border-sky-400 bg-sky-50/60" : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <input
                type="radio"
                name="dist-strat"
                className="mt-1"
                checked={strategy === s.value}
                onChange={() => setStrategy(s.value)}
              />
              <span>
                <span className="font-semibold text-slate-900">{s.label}</span>
                <span className="block text-xs text-slate-600 mt-0.5">{s.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Canales asociados a esta cola</h2>
          <p className="text-sm text-slate-500 mt-1">
            Elegí uno o varios canales de la empresa. Los chats de esos canales podrán enrutarse a esta cola.
          </p>
        </div>
        {channels.length === 0 ? (
          <p className="text-sm text-slate-600 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
            Todavía no hay canales configurados en la empresa. Creá un canal en omnicanal y volvé a esta pantalla.
          </p>
        ) : (
          <>
            <p className="text-xs text-slate-500">
              {linked.length === 0
                ? "Ningún canal asociado aún. Marcá los que correspondan."
                : `${linked.length} canal${linked.length === 1 ? "" : "es"} asociado${linked.length === 1 ? "" : "s"}.`}
            </p>
            <ul className="space-y-2 max-h-64 overflow-y-auto pr-1 divide-y divide-slate-100">
              {channels.map((c) => (
                <li key={c.id} className="flex items-center gap-3 text-sm pt-2 first:pt-0">
                  <input
                    type="checkbox"
                    checked={linked.includes(c.id)}
                    onChange={(e) => {
                      setLinked((prev) =>
                        e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id)
                      );
                    }}
                    id={`ch-${c.id}`}
                    className="rounded border-slate-300"
                  />
                  <label htmlFor={`ch-${c.id}`} className="cursor-pointer flex-1 min-w-0">
                    <span className="font-medium text-slate-800">{c.nombre?.trim() || c.type}</span>
                    <span className="text-slate-400"> · {c.type}</span>
                    {linked.includes(c.id) && (
                      <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                        Asociado
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        {linked.length > 0 && (
          <p className="text-xs text-slate-500">
            Con canales asociados, el filtro por tipo de canal (legado) no se usa al guardar.
          </p>
        )}
        {linked.length === 0 && (
          <details className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium text-slate-700">Compatibilidad avanzada (sin canales asociados)</summary>
            <p className="text-xs text-slate-500 mt-2 mb-2">
              Solo si aún no usás la asociación múltiple de canales: filtro histórico por tipo de canal.
            </p>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
              value={legacyChannelType}
              onChange={(e) => setLegacyChannelType(e.target.value)}
            >
              <option value="">Todos los tipos (sin filtro por tipo)</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="facebook">Facebook</option>
              <option value="instagram">Instagram</option>
              <option value="linkedin">LinkedIn</option>
              <option value="email">Email</option>
            </select>
          </details>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Redistribución por falta de respuesta inicial</h2>
          <p className="text-sm text-slate-500 mt-1">
            Aplica solo al primer contacto humano tras asignar un chat nuevo: si el asesor no respondió ni interactuó en el plazo,
            podés definir qué hacer (la ejecución automática completa puede activarse en una etapa posterior).
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={routing.initial_no_response?.enabled ?? false}
            onChange={(e) =>
              setRouting((r) => ({
                ...r,
                initial_no_response: { ...DEFAULT_QUEUE_ROUTING_CONFIG.initial_no_response!, ...r.initial_no_response, enabled: e.target.checked },
              }))
            }
          />
          Activar esta regla
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Tiempo</label>
            <input
              type="number"
              min={1}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={routing.initial_no_response?.value ?? 15}
              onChange={(e) =>
                setRouting((r) => ({
                  ...r,
                  initial_no_response: {
                    ...DEFAULT_QUEUE_ROUTING_CONFIG.initial_no_response!,
                    ...r.initial_no_response,
                    value: Math.max(1, Number(e.target.value) || 1),
                  },
                }))
              }
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Unidad</label>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={routing.initial_no_response?.unit ?? "minutes"}
              onChange={(e) =>
                setRouting((r) => ({
                  ...r,
                  initial_no_response: {
                    ...DEFAULT_QUEUE_ROUTING_CONFIG.initial_no_response!,
                    ...r.initial_no_response,
                    unit: e.target.value === "hours" ? "hours" : "minutes",
                  },
                }))
              }
            >
              <option value="minutes">Minutos</option>
              <option value="hours">Horas</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Acción al vencer el plazo</label>
          <select
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            value={routing.initial_no_response?.action ?? "reassign_prepare"}
            onChange={(e) =>
              setRouting((r) => ({
                ...r,
                initial_no_response: {
                  ...DEFAULT_QUEUE_ROUTING_CONFIG.initial_no_response!,
                  ...r.initial_no_response,
                  action: e.target.value === "reassign_auto" ? "reassign_auto" : "reassign_prepare",
                },
              }))
            }
          >
            <option value="reassign_prepare">Preparar redistribución (modelo listo; automatización después)</option>
            <option value="reassign_auto">Redistribuir automáticamente a otro agente (cuando el motor lo aplique)</option>
          </select>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Relación del cliente con el mismo asesor</h2>
          <p className="text-sm text-slate-500 mt-1">
            Si el cliente vuelve a escribir dentro de la ventana, el chat puede volver al mismo asesor. Si pasa el plazo, aplica la
            distribución normal de la cola.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={routing.same_advisor_window?.enabled ?? false}
            onChange={(e) =>
              setRouting((r) => ({
                ...r,
                same_advisor_window: {
                  ...DEFAULT_QUEUE_ROUTING_CONFIG.same_advisor_window!,
                  ...r.same_advisor_window,
                  enabled: e.target.checked,
                },
              }))
            }
          />
          Activar ventana de misma asesor
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Duración</label>
            <input
              type="number"
              min={1}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={routing.same_advisor_window?.value ?? 24}
              onChange={(e) =>
                setRouting((r) => ({
                  ...r,
                  same_advisor_window: {
                    ...DEFAULT_QUEUE_ROUTING_CONFIG.same_advisor_window!,
                    ...r.same_advisor_window,
                    value: Math.max(1, Number(e.target.value) || 1),
                  },
                }))
              }
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Unidad</label>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={routing.same_advisor_window?.unit ?? "hours"}
              onChange={(e) =>
                setRouting((r) => ({
                  ...r,
                  same_advisor_window: {
                    ...DEFAULT_QUEUE_ROUTING_CONFIG.same_advisor_window!,
                    ...r.same_advisor_window,
                    unit: e.target.value === "days" ? "days" : "hours",
                  },
                }))
              }
            >
              <option value="hours">Horas</option>
              <option value="days">Días</option>
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Cierre de conversaciones</h2>
            <p className="text-sm text-slate-600 mt-1 max-w-2xl">
              Definí los motivos de cierre que verá el asesor al pulsar «Finalizar». Cada estado puede tener subestados
              opcionales. Si no configurás nada, el sistema ofrece una lista por defecto hasta que cargues estados acá.
            </p>
          </div>
          <button
            type="button"
            disabled={closureSaving || !queueId}
            onClick={() => void handleSaveClosureTaxonomy()}
            className="shrink-0 rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
          >
            {closureSaving ? "Guardando…" : "Guardar cierre"}
          </button>
        </div>
        <div className="space-y-4">
          {closureDraft.map((row, si) => (
            <div key={si} className="rounded-xl border border-slate-100 bg-slate-50/80 p-4 space-y-3">
              <div className="flex flex-wrap gap-2 items-start">
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Estado</label>
                  <input
                    type="text"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                    value={row.label}
                    onChange={(e) =>
                      setClosureDraft((d) =>
                        d.map((x, i) => (i === si ? { ...x, label: e.target.value } : x))
                      )
                    }
                    placeholder="Ej. Venta cerrada"
                  />
                </div>
                <button
                  type="button"
                  className="mt-5 text-xs font-medium text-red-700 hover:underline"
                  onClick={() => setClosureDraft((d) => d.filter((_, i) => i !== si))}
                >
                  Quitar estado
                </button>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase">Subestados</p>
                {row.substates.map((sub, sj) => (
                  <div key={sj} className="flex gap-2 items-center">
                    <input
                      type="text"
                      className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white"
                      value={sub.label}
                      onChange={(e) =>
                        setClosureDraft((d) =>
                          d.map((x, i) =>
                            i !== si
                              ? x
                              : {
                                  ...x,
                                  substates: x.substates.map((y, j) =>
                                    j === sj ? { ...y, label: e.target.value } : y
                                  ),
                                }
                          )
                        )
                      }
                      placeholder="Ej. Pago confirmado"
                    />
                    <button
                      type="button"
                      className="text-xs text-slate-500 hover:text-red-700"
                      onClick={() =>
                        setClosureDraft((d) =>
                          d.map((x, i) =>
                            i !== si
                              ? x
                              : { ...x, substates: x.substates.filter((_, j) => j !== sj) }
                          )
                        )
                      }
                    >
                      Quitar
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="text-xs font-medium text-[#0EA5E9] hover:underline"
                  onClick={() =>
                    setClosureDraft((d) =>
                      d.map((x, i) =>
                        i !== si ? x : { ...x, substates: [...x.substates, { label: "" }] }
                      )
                    )
                  }
                >
                  + Agregar subestado
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="text-sm font-medium text-[#0EA5E9] hover:underline"
            onClick={() => setClosureDraft((d) => [...d, { label: "", substates: [] }])}
          >
            + Agregar estado
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Agentes</h2>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Agregar usuario</label>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={pickUser}
              onChange={(e) => setPickUser(e.target.value)}
            >
              <option value="">Elegir…</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre} ({u.email})
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void handleAddAgent()}
            className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-800"
          >
            Añadir
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                <th className="pb-2 pr-2">Usuario</th>
                <th className="pb-2 pr-2">Máx.</th>
                <th className="pb-2 pr-2">Prior.</th>
                <th className="pb-2 pr-2">Nuevos</th>
                <th className="pb-2 pr-2">Activo</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <AgentEditorRow key={a.id} queueId={queueId} agent={a} onChange={() => void load()} />
              ))}
            </tbody>
          </table>
          {agents.length === 0 && <p className="text-sm text-slate-500 pt-2">Sin agentes en esta cola.</p>}
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSaveQueue()}
          className="rounded-xl bg-[#0EA5E9] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0284C7] disabled:opacity-50"
        >
          {saving ? "Guardando…" : "Guardar cola y canales"}
        </button>
        <Link
          href="/configuracion/colas"
          className="inline-flex items-center rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
        >
          Volver
        </Link>
      </div>
    </div>
  );
}

function AgentEditorRow({
  queueId,
  agent,
  onChange,
}: {
  queueId: string;
  agent: QueueAgentRow;
  onChange: () => void;
}) {
  const [maxC, setMaxC] = useState(agent.max_conversations);
  const [prio, setPrio] = useState(agent.priority_in_queue);
  const [recv, setRecv] = useState(agent.receives_new_chats);
  const [active, setActive] = useState(agent.is_active);

  async function persist() {
    await apiUpdateQueueAgent(queueId, agent.id, {
      max_conversations: maxC,
      is_online: agent.is_online,
      is_active: active,
      receives_new_chats: recv,
      priority_in_queue: prio,
    });
    onChange();
  }

  async function remove() {
    if (!confirm("¿Quitar este agente de la cola?")) return;
    await apiRemoveQueueAgent(queueId, agent.id);
    onChange();
  }

  return (
    <tr className="border-b border-slate-50">
      <td className="py-2 pr-2">
        <span className="font-medium text-slate-800">{agent.nombre}</span>
        <span className="block text-xs text-slate-400 truncate max-w-[180px]">{agent.email}</span>
      </td>
      <td className="py-2 pr-2">
        <input
          type="number"
          min={1}
          className="w-16 border border-slate-200 rounded px-1 py-0.5 text-xs"
          value={maxC}
          onChange={(e) => setMaxC(Number(e.target.value) || 1)}
          onBlur={() => void persist()}
        />
      </td>
      <td className="py-2 pr-2">
        <input
          type="number"
          className="w-14 border border-slate-200 rounded px-1 py-0.5 text-xs"
          value={prio}
          onChange={(e) => setPrio(Number(e.target.value) || 0)}
          onBlur={() => void persist()}
        />
      </td>
      <td className="py-2 pr-2">
        <input
          type="checkbox"
          checked={recv}
          onChange={(e) => {
            setRecv(e.target.checked);
            void apiUpdateQueueAgent(queueId, agent.id, {
              max_conversations: maxC,
              is_online: agent.is_online,
              is_active: active,
              receives_new_chats: e.target.checked,
              priority_in_queue: prio,
            }).then(onChange);
          }}
        />
      </td>
      <td className="py-2 pr-2">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => {
            setActive(e.target.checked);
            void apiUpdateQueueAgent(queueId, agent.id, {
              max_conversations: maxC,
              is_online: agent.is_online,
              is_active: e.target.checked,
              receives_new_chats: recv,
              priority_in_queue: prio,
            }).then(onChange);
          }}
        />
      </td>
      <td className="py-2">
        <button type="button" onClick={() => void remove()} className="text-xs font-semibold text-red-600 hover:underline">
          Quitar
        </button>
      </td>
    </tr>
  );
}
