"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { ChatQueueAdminRow } from "@/lib/chat/queue-admin-repo";
import { apiCreateQueueDraft, apiListQueues } from "./queue-admin-api";

function hasOmnichannelFromModuleAccess(body: {
  superAdmin?: boolean;
  slugs?: string[];
}): boolean {
  if (body.superAdmin) return true;
  const slugs = Array.isArray(body.slugs) ? body.slugs : [];
  return slugs.includes("conversaciones") || slugs.includes("omnicanal");
}

const STRAT_LABEL: Record<string, string> = {
  least_load: "Menor carga",
  round_robin: "Circular",
  manual_pull: "Manual (sin autoasignación)",
};

export default function ConfiguracionColasPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const colaGuardadaOk = searchParams?.get("cola_guardada") === "1";
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<ChatQueueAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await apiListQueues());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
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
    if (allowed) void load();
  }, [allowed, load]);

  useEffect(() => {
    if (!colaGuardadaOk) return;
    const id = window.setTimeout(() => {
      router.replace("/configuracion/colas");
    }, 10_000);
    return () => window.clearTimeout(id);
  }, [colaGuardadaOk, router]);

  async function handleNew() {
    setError(null);
    try {
      const id = await apiCreateQueueDraft();
      router.push(`/configuracion/colas/${encodeURIComponent(id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear la cola");
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

  return (
    <div className="space-y-6 max-w-4xl">
      <nav className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
        <Link href="/configuracion" className="hover:text-slate-800">
          Configuración
        </Link>
        <span>/</span>
        <span className="text-slate-800 font-medium">Colas y enrutamiento</span>
        <span className="text-slate-300">·</span>
        <Link href="/configuracion/omnicanal-equipos" className="text-[#0EA5E9] hover:underline font-medium">
          Equipos y supervisión
        </Link>
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Colas y enrutamiento</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-xl">
            Definí colas, canales asociados, estrategia de distribución y agentes por cola. El inbox y el webhook
            existentes siguen usando la misma base de datos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleNew()}
          className="rounded-xl bg-[#0EA5E9] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#0284C7]"
        >
          Nueva cola
        </button>
      </div>
      {colaGuardadaOk ? (
        <div
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
          role="status"
        >
          Cola guardada correctamente.
        </div>
      ) : null}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-slate-400">Cargando…</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-slate-600">No hay colas. Creá la primera con el botón superior.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((q) => (
              <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="font-semibold text-slate-900">{q.nombre}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {STRAT_LABEL[q.distribution_strategy] ?? q.distribution_strategy}
                    {q.channel_type ? ` · tipo ${q.channel_type}` : " · todos los canales (legado)"} · prioridad{" "}
                    {q.priority}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold uppercase ${q.is_active ? "text-emerald-700" : "text-slate-400"}`}>
                    {q.is_active ? "Activa" : "Inactiva"}
                  </span>
                  <Link
                    href={`/configuracion/colas/${encodeURIComponent(String(q.id ?? "").trim())}`}
                    className="text-sm font-semibold text-[#0EA5E9] hover:underline"
                  >
                    Editar
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-slate-400">
        El módulo <Link href="/dashboard/monitoreo" className="text-[#0EA5E9] hover:underline">Monitoreo</Link> resume
        carga operativa en tiempo casi real.
      </p>
    </div>
  );
}
