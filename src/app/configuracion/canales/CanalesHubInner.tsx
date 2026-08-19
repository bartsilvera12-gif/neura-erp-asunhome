"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChannelBadge, channelTypeLabel } from "@/components/chat/ChannelBadge";
import { OmnichannelChannelCard } from "@/components/chat/OmnichannelChannelCard";
import { fetchWithSupabaseSession, isAbortError } from "@/lib/api/fetch-with-supabase-session";
import { normalizeChannelType } from "@/lib/chat/channel-type-utils";
import {
  fetchChatChannels,
  patchChatChannelActivo,
  type ChatChannelRow,
} from "@/lib/chat/actions";
import { OMNICHANNEL_CARD_DEFINITIONS } from "@/lib/chat/omnichannel-catalog";

function hasOmnichannelFromModuleAccess(body: {
  superAdmin?: boolean;
  slugs?: string[];
}): boolean {
  if (body.superAdmin) return true;
  const slugs = Array.isArray(body.slugs) ? body.slugs : [];
  return slugs.includes("conversaciones") || slugs.includes("omnicanal");
}

function channelIdentifierLine(r: ChatChannelRow): string {
  const p = String(r.provider ?? "").toLowerCase();
  if (p === "ycloud") {
    const sid = typeof r.config?.ycloud_sender_id === "string" ? r.config.ycloud_sender_id : "";
    const cid = typeof r.config?.ycloud_channel_id === "string" ? r.config.ycloud_channel_id : "";
    const parts = [
      sid.trim() && `Sender: ${sid.trim()}`,
      cid.trim() && `Canal YCloud: ${cid.trim()}`,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "—";
  }
  const mp = r.meta_phone_number_id?.trim();
  return mp ? `Phone number ID: ${mp}` : "—";
}

function credentialsSummary(r: ChatChannelRow): string {
  const p = String(r.provider ?? "").toLowerCase();
  if (p === "ycloud") {
    if (r.ycloud_api_key_present === true) return "API key guardada";
    if (r.ycloud_api_key_present === false) return "Sin API key en ERP";
    return r.config_status === "active" ? "Credenciales listas" : "Revisá API key YCloud";
  }
  if (r.meta_access_token_present === true) return "Token Meta guardado";
  if (r.meta_access_token_present === false) return "Sin token Meta en ERP";
  return r.config_status === "active" ? "Credenciales completas" : "Credenciales incompletas";
}

export function CanalesHubInner() {
  const searchParams = useSearchParams();
  const tipoFiltro = (searchParams?.get("tipo") ?? "").trim().toLowerCase();

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<ChatChannelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggleBusyId, setToggleBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchChatChannels();
      setRows(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar canales");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchWithSupabaseSession("/api/empresas/module-access", {
      cache: "no-store",
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (ctrl.signal.aborted) return;
        if (!res.ok) {
          setAllowed(false);
          return;
        }
        try {
          const body = (await res.json()) as { superAdmin?: boolean; slugs?: unknown };
          if (ctrl.signal.aborted) return;
          const slugs = Array.isArray(body.slugs) ? body.slugs.filter((s): s is string => typeof s === "string") : [];
          setAllowed(hasOmnichannelFromModuleAccess({ superAdmin: body.superAdmin, slugs }));
        } catch {
          if (ctrl.signal.aborted) return;
          setAllowed(false);
        }
      })
      .catch((e: unknown) => {
        if (isAbortError(e)) return;
        setAllowed(false);
      });
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const filteredRows = useMemo(() => {
    if (!tipoFiltro) return [];
    return rows.filter((r) => normalizeChannelType(r.type) === tipoFiltro);
  }, [rows, tipoFiltro]);

  const whatsappChannels = useMemo(
    () => rows.filter((r) => normalizeChannelType(r.type) === "whatsapp"),
    [rows]
  );

  useEffect(() => {
    if (tipoFiltro !== "whatsapp" || typeof document === "undefined") return;
    requestAnimationFrame(() => {
      document.getElementById("whatsapp-canales")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [tipoFiltro]);

  async function handleToggleActive(row: ChatChannelRow, next: boolean) {
    setToggleBusyId(row.id);
    setError(null);
    try {
      await patchChatChannelActivo(row.id, next);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar el canal");
    } finally {
      setToggleBusyId(null);
    }
  }

  if (allowed === null) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-slate-400">Cargando…</div>
    );
  }

  if (!allowed) {
    return (
      <div className="max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        <p className="font-medium">Módulo no habilitado</p>
        <p className="mt-2 text-amber-800/90">
          Tu empresa no tiene el módulo de conversaciones u omnicanal. Contactá al administrador.
        </p>
        <Link href="/configuracion" className="mt-4 inline-block text-sm font-semibold text-amber-900 underline">
          Volver a configuración
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <nav className="flex items-center gap-2 text-sm text-slate-500 mb-2">
            <Link href="/configuracion" className="hover:text-slate-800">
              Configuración
            </Link>
            <span>/</span>
            <span className="text-slate-800 font-medium">Canales y comunicación</span>
          </nav>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Canales y comunicación</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Podés tener varios WhatsApp por empresa (por ejemplo cobranzas, ventas o coexistencia YCloud). Cada uno es
            una fila en el sistema; activalos o desactivalos sin perder la configuración guardada.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <Link
            href="/configuracion/colas"
            className="inline-flex items-center justify-center shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Colas y enrutamiento
          </Link>
          <Link
            href="/configuracion/canales/nuevo?tipo=whatsapp"
            className="inline-flex items-center justify-center shrink-0 rounded-xl bg-[#0EA5E9] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#0284C7] transition-colors"
          >
            Conectar canal
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-44 rounded-2xl border border-slate-200 bg-slate-50 animate-pulse"
              aria-hidden
            />
          ))}
        </div>
      ) : (
        <>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 list-none p-0 m-0">
            {OMNICHANNEL_CARD_DEFINITIONS.map((def) => (
              <li key={def.type}>
                <OmnichannelChannelCard def={def} rows={rows} />
              </li>
            ))}
          </ul>

          <section
            id="whatsapp-canales"
            className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden scroll-mt-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">WhatsApp</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {whatsappChannels.length === 0
                    ? "Aún no hay números configurados."
                    : `${whatsappChannels.length} número${whatsappChannels.length === 1 ? "" : "s"} · cada ítem es un canal independiente`}
                </p>
              </div>
              <Link
                href="/configuracion/canales/nuevo?tipo=whatsapp"
                className="inline-flex items-center justify-center shrink-0 rounded-xl bg-[#0EA5E9] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0284C7]"
              >
                Agregar WhatsApp
              </Link>
            </div>
            {whatsappChannels.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                Creá el primero con el asistente (Meta Cloud API o coexistencia YCloud).
              </div>
            ) : (
              <ul className="divide-y divide-slate-200">
                {whatsappChannels.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900 truncate">{r.nombre ?? "WhatsApp"}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        <span className="font-semibold uppercase tracking-wide text-slate-400">{r.provider}</span>
                        {r.connection_mode ? (
                          <span className="text-slate-400"> · {r.connection_mode}</span>
                        ) : null}
                        {" · "}
                        <span
                          className={
                            r.activo && r.config_status === "active"
                              ? "text-emerald-700"
                              : r.activo
                                ? "text-amber-700"
                                : "text-slate-500"
                          }
                        >
                          {r.activo ? (r.config_status === "active" ? "Activo" : "Activo · config. incompleta") : "Inactivo"}
                        </span>
                      </p>
                      <p className="text-xs font-mono text-slate-600 mt-1 truncate" title={channelIdentifierLine(r)}>
                        {channelIdentifierLine(r)}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1">{credentialsSummary(r)}</p>
                    </div>
                    <label className="flex items-center gap-2 shrink-0 text-xs text-slate-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="rounded border-slate-300"
                        checked={Boolean(r.activo)}
                        disabled={toggleBusyId === r.id}
                        onChange={(e) => void handleToggleActive(r, e.target.checked)}
                        aria-label={`Canal ${r.nombre ?? r.id} activo`}
                      />
                      <span className="hidden sm:inline">{toggleBusyId === r.id ? "…" : "Operativo"}</span>
                    </label>
                    <Link
                      href={`/configuracion/canales/${r.id}`}
                      className="shrink-0 text-sm font-semibold text-[#0EA5E9] hover:underline"
                    >
                      Editar
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {tipoFiltro && tipoFiltro !== "whatsapp" && filteredRows.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
              Conexiones {channelTypeLabel(tipoFiltro)}
            </h2>
            <Link href="/configuracion/canales" className="text-xs font-semibold text-[#0EA5E9] hover:underline">
              Ver todos los canales
            </Link>
          </div>
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {filteredRows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 truncate">{r.nombre ?? channelTypeLabel(r.type)}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <ChannelBadge type={r.type} nombre={null} />
                    <span className="text-[10px] uppercase font-semibold text-slate-400">{r.provider}</span>
                  </div>
                </div>
                <Link
                  href={`/configuracion/canales/${r.id}`}
                  className="shrink-0 text-sm font-semibold text-[#0EA5E9] hover:underline"
                >
                  Editar
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
