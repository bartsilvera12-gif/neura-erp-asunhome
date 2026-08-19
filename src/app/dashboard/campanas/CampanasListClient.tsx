"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchWithSupabaseSession, isAbortError } from "@/lib/api/fetch-with-supabase-session";

type CampaignRow = {
  id: string;
  name: string;
  channel_id: string;
  provider: string;
  template_name: string;
  template_language: string;
  status: string;
  total_count: number;
  sent_count: number;
  failed_count: number;
  replied_count: number;
  created_at: string;
};

export default function CampanasListClient() {
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Upgrade del flag `cancelled` a AbortController: ahora la peticion HTTP
    // se aborta de verdad (libera socket, bytecode JSON) en vez de solo
    // ignorar el setState. Importa cuando el user navega rapido entre paginas.
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetchWithSupabaseSession("/api/campanas", {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        const json = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          data?: CampaignRow[];
          error?: string;
        };
        if (ctrl.signal.aborted) return;
        if (!res.ok || !json.success) {
          setErr(json.error ?? "No se pudo cargar");
          setLoading(false);
          return;
        }
        setRows(json.data ?? []);
        setLoading(false);
      } catch (e) {
        if (isAbortError(e)) return;
        setErr(e instanceof Error ? e.message : "No se pudo cargar");
        setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, []);

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Cargando campañas…</div>;
  }

  if (err) {
    return <div className="p-6 text-sm text-red-600">{err}</div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Campañas WhatsApp</h1>
          <p className="text-sm text-slate-500">Envíos masivos con plantillas aprobadas (Meta / YCloud).</p>
        </div>
        <Link
          href="/dashboard/campanas/nuevo"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Nueva campaña
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-3">Nombre</th>
              <th className="px-4 py-3">Proveedor</th>
              <th className="px-4 py-3">Plantilla</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Enviados</th>
              <th className="px-4 py-3 text-right">Fallidos</th>
              <th className="px-4 py-3 text-right">Respondieron</th>
              <th className="px-4 py-3"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                  No hay campañas todavía.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-3 font-medium text-slate-900">{r.name}</td>
                  <td className="px-4 py-3 text-slate-600">{r.provider}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {r.template_name}{" "}
                    <span className="text-slate-400">({r.template_language})</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.total_count}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{r.sent_count}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-red-600">{r.failed_count}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-indigo-700">{r.replied_count}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/dashboard/campanas/${r.id}`}
                      className="text-indigo-600 hover:underline"
                    >
                      Ver
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
