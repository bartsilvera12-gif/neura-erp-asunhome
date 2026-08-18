"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type TicketRow = {
  id: string;
  sorteo_id: string;
  entrada_id: string;
  status: string;
  cliente_nombre: string | null;
  cliente_documento: string | null;
  telefono: string | null;
  numero_orden: string | null;
  created_at: string;
};

export default function SorteosTicketsPage() {
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sorteoId, setSorteoId] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const sp = new URLSearchParams();
      if (sorteoId.trim()) sp.set("sorteo_id", sorteoId.trim());
      if (status.trim()) sp.set("status", status.trim());
      if (q.trim()) sp.set("q", q.trim());
      const res = await fetchWithSupabaseSession(`/api/sorteos/tickets?${sp.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as { success?: boolean; data?: TicketRow[]; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error?.trim() || `No se pudo cargar (${res.status})`);
      }
      setRows(Array.isArray(json.data) ? json.data : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- carga inicial; filtros con botón Filtrar
  }, []);

  async function openSignedUrl(ticketId: string) {
    setBusyId(ticketId);
    setErr(null);
    try {
      const res = await fetchWithSupabaseSession(
        `/api/sorteos/tickets/${encodeURIComponent(ticketId)}/signed-url?ttl=600`,
        { cache: "no-store" }
      );
      const json = (await res.json()) as { success?: boolean; data?: { url?: string }; error?: string };
      if (!res.ok || !json.success || !json.data?.url) {
        throw new Error(json.error || "Sin URL");
      }
      window.open(json.data.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al obtener URL firmada");
    } finally {
      setBusyId(null);
    }
  }

  async function resendTicket(ticketId: string) {
    if (!confirm("¿Reenviar la imagen por WhatsApp al cliente?")) return;
    setBusyId(ticketId);
    setErr(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/sorteos/tickets/${encodeURIComponent(ticketId)}/resend`, {
        method: "POST",
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error || "Falló reenvío");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusyId(null);
    }
  }

  async function regenerateTicket(ticketId: string) {
    if (!confirm("¿Regenerar el PNG (nueva revisión)? No se reenvía solo.")) return;
    setBusyId(ticketId);
    setErr(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/sorteos/tickets/${encodeURIComponent(ticketId)}/regenerate`, {
        method: "POST",
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error || "Falló regeneración");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/sorteos" className="hover:text-slate-800">
          Sorteos
        </Link>
        <span>/</span>
        <span className="text-slate-800 font-medium">Tickets</span>
      </div>
      <h1 className="text-2xl font-bold text-gray-800">Tickets / Comprobantes</h1>
      <p className="text-sm text-slate-600">
        Registro de generación y envío de comprobantes en imagen tras confirmar compras en WhatsApp.
      </p>

      <div className="flex flex-wrap gap-2 items-end bg-white border border-slate-200 rounded-xl p-4">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Sorteo ID</label>
          <input
            className="border rounded px-2 py-1 text-sm w-48"
            value={sorteoId}
            onChange={(e) => setSorteoId(e.target.value)}
            placeholder="uuid"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Estado</label>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">(todos)</option>
            <option value="pending">pending</option>
            <option value="generated">generated</option>
            <option value="sent">sent</option>
            <option value="error">error</option>
          </select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs text-slate-500 mb-1">Buscar</label>
          <input
            className="border rounded px-2 py-1 text-sm w-full"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="texto libre"
          />
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="bg-slate-800 text-white text-sm px-4 py-2 rounded-lg"
        >
          Filtrar
        </button>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-4 py-2">{err}</div>
      )}

      {loading ? (
        <div className="text-slate-400 text-sm animate-pulse py-8">Cargando…</div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Orden</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Doc / Tel</th>
                <th className="px-3 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs">{r.status}</td>
                  <td className="px-3 py-2">{r.numero_orden ?? "—"}</td>
                  <td className="px-3 py-2">{r.cliente_nombre ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {(r.cliente_documento ?? "").trim() || "—"} / {(r.telefono ?? "").trim() || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2 items-center">
                      <button
                        type="button"
                        disabled={busyId === r.id || r.status === "pending"}
                        onClick={() => void openSignedUrl(r.id)}
                        className="text-sky-600 hover:underline disabled:opacity-40 text-xs"
                      >
                        {busyId === r.id ? "…" : "Ver / descargar"}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => void resendTicket(r.id)}
                        className="text-emerald-700 hover:underline disabled:opacity-40 text-xs"
                      >
                        Reenviar WA
                      </button>
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => void regenerateTicket(r.id)}
                        className="text-violet-700 hover:underline disabled:opacity-40 text-xs"
                      >
                        Regenerar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                    Sin registros
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
