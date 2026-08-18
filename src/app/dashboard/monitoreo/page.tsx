"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  fetchMonitoreoPageData,
  type MonitoringDashboard,
  type MonitoringPendingReplyAgentGroup,
  type MonitoringUnassignedRow,
  type SupervisorAgentLoadRow,
} from "@/lib/chat/chat-ops-actions";
import { formatWaitHuman } from "@/lib/chat/format-wait-human";
import { assignmentWaitBadge, assignmentWaitBadgeClass } from "@/lib/chat/inbox-assignment-labels";
import { ArrowLeftRight, Eye, Flame } from "lucide-react";

/** `formatWaitHuman` depende de `Date.now()`; sin re-render el monitoreo mostraba tiempos “congelados”. */
function buildMonitoreoInboxHref(row: MonitoringUnassignedRow, opts: { transferir?: boolean }) {
  const p = new URLSearchParams();
  p.set("asignacion", "sin_asignar");
  p.set("conversationId", row.id);
  const qid = row.queue_id?.trim();
  if (qid) p.set("cola", qid);
  if (opts.transferir) p.set("transferir", "1");
  return `/dashboard/conversaciones?${p.toString()}`;
}

function TickingSinceLabel({ iso }: { iso: string | null | undefined }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((x) => x + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);
  if (!iso) return <>—</>;
  return <span className="tabular-nums">{formatWaitHuman(iso)}</span>;
}

export default function MonitoreoPage() {
  const [dash, setDash] = useState<MonitoringDashboard | null>(null);
  const [agents, setAgents] = useState<SupervisorAgentLoadRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedPendingAgentId, setExpandedPendingAgentId] = useState<string | null>(null);
  const [uxRole, setUxRole] = useState<string | null>(null);
  const [uxTeamCount, setUxTeamCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { dash, agents, ux } = await fetchMonitoreoPageData();
      setDash(dash);
      setAgents(agents);
      setUxRole(ux.omnicanal_role);
      setUxTeamCount(ux.team_agent_usuario_count);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-8 max-w-6xl pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Monitoreo</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Centro de control operativo: colas, canales, carga de agentes y conversaciones que requieren atención.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/configuracion/colas"
            className="text-sm font-semibold text-slate-700 hover:text-slate-900 underline-offset-2 hover:underline"
          >
            Colas y enrutamiento
          </Link>
          <Link
            href="/dashboard/conversaciones"
            className="inline-flex items-center rounded-xl bg-[#0EA5E9] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#0284C7]"
          >
            Ir al inbox
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {uxRole === "supervisor" && !loading ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950">
          <span className="font-semibold">Vista de supervisor.</span> Métricas y tablas muestran solo el equipo a tu
          cargo
          {uxTeamCount !== null ? (
            <span className="tabular-nums">
              {" "}
              ({uxTeamCount} agente{uxTeamCount === 1 ? "" : "s"} en el equipo)
            </span>
          ) : null}
          . Las colas en pantalla son las de esos agentes, no la empresa completa.
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 shadow-sm">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Resumen general</h2>
        {loading || !dash ? (
          <p className="text-sm text-slate-400">Cargando métricas…</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <MetricTile label="Colas activas" value={dash.active_queues} tone="slate" />
            <MetricTile label="Agentes asignados" value={dash.agents_assigned} tone="slate" />
            <MetricTile label="Chats sin asignar" value={dash.unassigned_chats} tone="amber" />
            <MetricTile label="Pend. 1ª respuesta" value={dash.awaiting_first_response} tone="amber" />
            <MetricTile label="Chats pendientes" value={dash.pending_chats} tone="sky" />
            <MetricTile label="Canales activos" value={dash.active_channels} tone="emerald" />
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Chats sin asignar (recientes)</h2>
            <p className="text-xs text-slate-500 mt-1 max-w-3xl">
              <span className="font-medium text-slate-600">Motivo</span>: cola manual, sin agentes en estado{" "}
              <span className="font-medium">Disponible</span> para autoasignar, u otra espera en cola.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs font-semibold text-[#0EA5E9] hover:underline shrink-0"
          >
            Actualizar
          </button>
        </div>
        {loading || !dash ? (
          <p className="text-sm text-slate-400">Cargando…</p>
        ) : dash.unassigned_recent.length === 0 ? (
          <p className="text-sm text-slate-500">No hay conversaciones abiertas sin agente en este momento.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                  <th className="pb-2 pr-3">Espera</th>
                  <th className="pb-2 pr-3">Contacto</th>
                  <th className="pb-2 pr-3">Canal</th>
                  <th className="pb-2 pr-3">Cola</th>
                  <th className="pb-2 pr-3">Motivo</th>
                  <th className="pb-2 pr-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {dash.unassigned_recent.map((r: MonitoringUnassignedRow) => {
                  const w = assignmentWaitBadge(r.assignment_wait_code, Boolean(r.queue_id));
                  return (
                  <tr key={r.id} className="border-b border-slate-50">
                    <td className="py-2 pr-3 text-slate-700 tabular-nums">
                      <TickingSinceLabel iso={r.waiting_since} />
                    </td>
                    <td className="py-2 pr-3">
                      <span className="font-medium text-slate-800">{r.contact_name ?? "—"}</span>
                      <span className="block text-xs text-slate-400 font-mono truncate max-w-[160px]">
                        {r.contact_phone ?? ""}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-slate-600">
                      {r.channel_nombre ?? r.channel_type ?? "—"}
                    </td>
                    <td className="py-2 pr-3 text-slate-600">{r.queue_name ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-semibold ${assignmentWaitBadgeClass(w.tone)}`}
                      >
                        {w.label}
                      </span>
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <Link
                          href={buildMonitoreoInboxHref(r, {})}
                          title="Abrir en inbox"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-[#0EA5E9] hover:text-[#0284C7]"
                        >
                          <Eye className="h-4 w-4" aria-hidden />
                          <span className="sr-only">Ver en inbox</span>
                        </Link>
                        <Link
                          href={buildMonitoreoInboxHref(r, { transferir: true })}
                          title="Transferir…"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-[#0EA5E9] hover:text-[#0284C7]"
                        >
                          <ArrowLeftRight className="h-4 w-4" aria-hidden />
                          <span className="sr-only">Transferir conversación</span>
                        </Link>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
              Chats sin primera respuesta humana
            </h2>
            <p className="text-xs text-slate-500 mt-1 max-w-3xl">
              Por agente: fila compacta con cantidad; desplegá para ver contacto, canal y tiempo de espera.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs font-semibold text-[#0EA5E9] hover:underline shrink-0"
          >
            Actualizar
          </button>
        </div>
        {loading || !dash ? (
          <p className="text-sm text-slate-400">Cargando…</p>
        ) : dash.pending_human_reply_groups.length === 0 ? (
          <p className="text-sm text-slate-500">No hay conversaciones esperando la primera respuesta humana.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {dash.pending_human_reply_groups.map((g: MonitoringPendingReplyAgentGroup) => {
              const open = expandedPendingAgentId === g.assigned_agent_id;
              return (
                <div key={g.assigned_agent_id} className="rounded-xl border border-slate-200 bg-slate-50/60 overflow-hidden">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedPendingAgentId((cur) => (cur === g.assigned_agent_id ? null : g.assigned_agent_id))
                    }
                    className="w-full flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-white/90 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold text-slate-800 text-sm">{g.agent_name}</span>
                      <span className="block text-xs text-slate-500 truncate">{g.agent_email}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 text-orange-950 text-xs font-bold px-2.5 py-1 border border-orange-200">
                        <Flame className="w-3.5 h-3.5" aria-hidden />
                        {g.pending_count}
                      </span>
                      <span className="text-xs text-slate-500">{open ? "Ocultar" : "Ver"}</span>
                    </div>
                  </button>
                  {open ? (
                    <div className="border-t border-slate-200 bg-white px-3 py-2 space-y-1.5">
                      {g.items.map((it) => (
                        <div
                          key={it.conversation_id}
                          className="flex flex-wrap items-center justify-between gap-2 text-xs border-b border-slate-100 last:border-0 pb-1.5 last:pb-0"
                        >
                          <div className="min-w-0">
                            <Link
                              href={`/dashboard/conversaciones?conversationId=${encodeURIComponent(it.conversation_id)}`}
                              className="font-medium text-[#0EA5E9] hover:underline truncate block"
                            >
                              {it.contact_name?.trim() || "Sin nombre"}
                            </Link>
                            <span className="text-slate-500 font-mono">{it.contact_phone ?? "—"}</span>
                            {it.channel_label ? (
                              <span className="block text-slate-500">{it.channel_label}</span>
                            ) : null}
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-orange-900 font-semibold tabular-nums">
                              <TickingSinceLabel iso={it.waiting_since} />
                            </span>
                            {it.last_preview ? (
                              <span className="block text-slate-400 truncate max-w-[14rem] mt-0.5">{it.last_preview}</span>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-3">Agentes y carga</h2>
        {loading ? (
          <p className="text-sm text-slate-400">Cargando…</p>
        ) : agents.length === 0 ? (
          <p className="text-sm text-slate-500">
            {uxRole === "supervisor" ? (
              <>
                No tenés agentes asignados en{" "}
                <Link
                  href="/configuracion/omnicanal-equipos"
                  className="text-[#0EA5E9] font-semibold hover:underline"
                >
                  Equipos y supervisión
                </Link>
                , o aún no tienen perfil en{" "}
                <Link href="/configuracion/colas" className="text-[#0EA5E9] font-semibold hover:underline">
                  Colas
                </Link>
                .
              </>
            ) : (
              <>
                No hay filas en <code className="text-xs bg-slate-100 px-1 rounded">chat_agents</code>. Asigná usuarios
                desde{" "}
                <Link href="/configuracion/colas" className="text-[#0EA5E9] font-semibold hover:underline">
                  Colas
                </Link>
                .
              </>
            )}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                  <th className="pb-2 pr-3">Cola</th>
                  <th className="pb-2 pr-3">Agente</th>
                  <th className="pb-2 pr-3">En línea</th>
                  <th className="pb-2 pr-3">Turno</th>
                  <th className="pb-2 pr-3">En este modo</th>
                  <th className="pb-2 pr-3">Último ping inbox</th>
                  <th className="pb-2 pr-3">Máx.</th>
                  <th className="pb-2 pr-3">Chats activos</th>
                  <th className="pb-2">Sin 1ª resp.</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id} className="border-b border-slate-50">
                    <td className="py-2 pr-3 text-slate-600">{a.queue_nombre}</td>
                    <td className="py-2 pr-3">
                      <span className="font-medium text-slate-800">{a.nombre}</span>
                      <span className="block text-xs text-slate-400 truncate max-w-[200px]">{a.email}</span>
                    </td>
                    <td className="py-2 pr-3">
                      {a.is_online ? (
                        <span className="text-emerald-700 text-xs font-semibold">Sí</span>
                      ) : (
                        <span className="text-slate-400 text-xs">No</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {a.operational_status === "ready" ? (
                        <span className="text-emerald-800 text-xs font-semibold">Disponible</span>
                      ) : (
                        <span className="text-slate-500 text-xs font-medium">En pausa</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-slate-700 tabular-nums text-xs">
                      <TickingSinceLabel iso={a.operational_status_changed_at} />
                    </td>
                    <td className="py-2 pr-3 text-slate-700 tabular-nums text-xs">
                      <TickingSinceLabel iso={a.last_heartbeat_at} />
                    </td>
                    <td className="py-2 pr-3">{a.max_conversations}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={
                          a.active_conversations >= a.max_conversations
                            ? "text-amber-700 font-semibold"
                            : "text-slate-700"
                        }
                      >
                        {a.active_conversations}
                      </span>
                    </td>
                    <td className="py-2">
                      <span className={a.pending_first_reply > 0 ? "text-amber-800 font-semibold" : "text-slate-500"}>
                        {a.pending_first_reply}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function MetricTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "slate" | "amber" | "sky" | "emerald";
}) {
  const tones: Record<string, string> = {
    slate: "bg-slate-50 border-slate-200 text-slate-900",
    amber: "bg-amber-50 border-amber-200 text-amber-950",
    sky: "bg-sky-50 border-sky-200 text-sky-950",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-950",
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${tones[tone]}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-2xl font-bold tabular-nums mt-1">{value}</p>
    </div>
  );
}
