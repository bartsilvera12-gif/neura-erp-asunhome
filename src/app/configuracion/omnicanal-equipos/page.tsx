"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import {
  fetchSupervisionLinks,
  linkAgentToSupervisor,
  removeSupervisionLink,
  type SupervisionLinkRow,
} from "@/lib/chat/supervision-admin-actions";
import { listAgentesForEquiposPick, listSupervisoresForEquiposPick } from "@/lib/chat/queue-admin-actions";
import type { UsuarioPickRow } from "@/lib/chat/queue-admin-repo";

function hasOmnichannelFromModuleAccess(body: {
  superAdmin?: boolean;
  slugs?: string[];
}): boolean {
  if (body.superAdmin) return true;
  const slugs = Array.isArray(body.slugs) ? body.slugs : [];
  return slugs.includes("conversaciones") || slugs.includes("omnicanal");
}

function labelUsuario(u: UsuarioPickRow): string {
  const n = (u.nombre ?? "").trim();
  const e = (u.email ?? "").trim();
  return n ? (e ? `${n} (${e})` : n) : e || u.id.slice(0, 8);
}

export default function OmnicanalEquiposPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [supervisores, setSupervisores] = useState<UsuarioPickRow[]>([]);
  const [agentes, setAgentes] = useState<UsuarioPickRow[]>([]);
  const [rows, setRows] = useState<SupervisionLinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [supervisorId, setSupervisorId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [links] = await Promise.all([fetchSupervisionLinks()]);
      setRows(links);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar equipos");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSelectores = useCallback(async () => {
    try {
      const [sup, ag] = await Promise.all([listSupervisoresForEquiposPick(), listAgentesForEquiposPick()]);
      setSupervisores(sup);
      setAgentes(ag);
    } catch {
      setSupervisores([]);
      setAgentes([]);
    }
  }, []);

  useEffect(() => {
    fetchWithSupabaseSession("/api/empresas/module-access", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          setAllowed(false);
          return;
        }
        const body = (await res.json()) as { superAdmin?: boolean; slugs?: string[] };
        setAllowed(hasOmnichannelFromModuleAccess(body));
      })
      .catch(() => setAllowed(false));
  }, []);

  useEffect(() => {
    if (allowed) {
      void loadSelectores();
      void load();
    }
  }, [allowed, load, loadSelectores]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!supervisorId || !agentId) return;
    setSaving(true);
    setError(null);
    try {
      await linkAgentToSupervisor(supervisorId, agentId);
      setAgentId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: string) {
    if (!window.confirm("¿Quitar este agente del supervisor?")) return;
    setError(null);
    try {
      await removeSupervisionLink(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar");
    }
  }

  if (allowed === null) {
    return <div className="py-24 text-center text-sm text-slate-400">Cargando…</div>;
  }

  if (!allowed) {
    return (
      <div className="max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Módulo no habilitado.{" "}
        <Link href="/configuracion" className="font-semibold underline">
          Volver
        </Link>
      </div>
    );
  }

  const bySupervisor = new Map<string, SupervisionLinkRow[]>();
  for (const r of rows) {
    const list = bySupervisor.get(r.supervisor_usuario_id) ?? [];
    list.push(r);
    bySupervisor.set(r.supervisor_usuario_id, list);
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <nav className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/configuracion" className="hover:text-slate-800">
          Configuración
        </Link>
        <span>/</span>
        <Link href="/configuracion/colas" className="hover:text-slate-800">
          Colas
        </Link>
        <span>/</span>
        <span className="text-slate-800 font-medium">Equipos y supervisión</span>
      </nav>

      <div>
        <h1 className="text-2xl font-bold text-slate-900">Equipos y supervisión omnicanal</h1>
        <p className="text-sm text-slate-500 mt-2 max-w-2xl leading-relaxed">
          Definí qué usuarios supervisan a qué agentes. Las colas siguen siendo solo distribución de trabajo; la
          supervisión es la jerarquía humana: el supervisor ve inbox, historial y monitoreo únicamente de los agentes
          asignados aquí (por conversaciones asignadas a esos agentes).
        </p>
      </div>

      <form onSubmit={(e) => void handleAdd(e)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-slate-800">Nueva relación supervisor → agente</h2>
        <p className="text-xs text-slate-500 leading-relaxed">
          Supervisores: solo usuarios con perfil <strong className="text-slate-700">Supervisor</strong> en el ERP.
          Agentes: solo perfil <strong className="text-slate-700">Usuario</strong> y asignados a al menos una cola en{" "}
          <Link href="/configuracion/colas" className="font-semibold text-[#0EA5E9] hover:underline">
            Colas y enrutamiento
          </Link>
          .
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Supervisor
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
                value={supervisorId}
                onChange={(ev) => setSupervisorId(ev.target.value)}
                required
                disabled={supervisores.length === 0}
              >
                <option value="">{supervisores.length === 0 ? "Sin opciones" : "Elegí supervisor…"}</option>
                {supervisores.map((u) => (
                  <option key={u.id} value={u.id}>
                    {labelUsuario(u)}
                  </option>
                ))}
              </select>
            </label>
            {supervisores.length === 0 ? (
              <p className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                No hay supervisores disponibles. El perfil del usuario en el ERP debe ser{" "}
                <strong>Supervisor</strong> (desde Usuarios).
              </p>
            ) : null}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Agente a cargo
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
                value={agentId}
                onChange={(ev) => setAgentId(ev.target.value)}
                required
                disabled={agentes.length === 0}
              >
                <option value="">{agentes.length === 0 ? "Sin opciones" : "Elegí agente…"}</option>
                {agentes.map((u) => (
                  <option key={u.id} value={u.id}>
                    {labelUsuario(u)}
                  </option>
                ))}
              </select>
            </label>
            {agentes.length === 0 ? (
              <p className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                No hay agentes disponibles con cola asignada. El usuario debe tener perfil{" "}
                <strong>Usuario</strong> en el ERP y figurar como agente en una cola activa.
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={
              saving ||
              supervisores.length === 0 ||
              agentes.length === 0 ||
              !supervisorId ||
              !agentId
            }
            className="rounded-xl bg-[#0EA5E9] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#0284C7] disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Asignar agente al supervisor"}
          </button>
          <p className="text-xs text-slate-400">
            Al guardar, el supervisor recibe también el rol operativo omnicanal correspondiente en la empresa.
          </p>
        </div>
      </form>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-3 bg-slate-50">
          <h2 className="text-sm font-semibold text-slate-800">Equipo por supervisor</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Un mismo supervisor puede tener varios agentes. Un agente solo puede tener un supervisor principal por fila
            única en base de datos (empresa + supervisor + agente).
          </p>
        </div>
        {loading ? (
          <p className="p-6 text-sm text-slate-400">Cargando…</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-slate-600">No hay relaciones cargadas todavía.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {[...bySupervisor.entries()].map(([supId, list]) => {
              const head = list[0];
              const supLabel =
                (head.supervisor_nombre ?? "").trim() ||
                (head.supervisor_email ?? "").trim() ||
                supId.slice(0, 8);
              return (
                <li key={supId} className="px-5 py-4">
                  <p className="font-semibold text-slate-900">{supLabel}</p>
                  <p className="text-xs text-slate-500 mb-2">
                    {(head.supervisor_email ?? "").trim() || `ID ${supId}`}
                  </p>
                  <ul className="space-y-2 mt-2">
                    {list.map((r) => {
                      const agLabel =
                        (r.agent_nombre ?? "").trim() || (r.agent_email ?? "").trim() || r.agent_usuario_id.slice(0, 8);
                      return (
                        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span className="text-slate-700">{agLabel}</span>
                          <button
                            type="button"
                            className="text-xs font-semibold text-red-600 hover:underline"
                            onClick={() => void handleRemove(r.id)}
                          >
                            Quitar
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-xs text-slate-400">
        Los agentes listados ya cumplen perfil Usuario + membresía en cola; la supervisión define la jerarquía de
        visibilidad, no sustituye la configuración de colas.
      </p>
    </div>
  );
}
