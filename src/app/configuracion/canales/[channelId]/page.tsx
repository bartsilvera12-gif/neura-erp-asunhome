"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ChannelBadge, channelTypeLabel } from "@/components/chat/ChannelBadge";
import { GenericOmnichannelChannelForm } from "@/components/chat/GenericOmnichannelChannelForm";
import { ChannelQuickRepliesStandaloneBlock } from "@/components/chat/ChannelQuickRepliesStandaloneBlock";
import { WhatsAppChannelForm } from "@/components/chat/WhatsAppChannelForm";
import { OMNICHANNEL_CARD_DEFINITIONS } from "@/lib/chat/omnichannel-catalog";
import { normalizeChannelType } from "@/lib/chat/channel-type-utils";
import {
  deleteChatChannel,
  fetchChatChannelById,
  type ChatChannelRow,
} from "@/lib/chat/actions";
import { getMisModulos } from "@/lib/empresas/actions";

function hasOmnichannel(slugs: string[]) {
  return slugs.includes("conversaciones") || slugs.includes("omnicanal");
}

export default function EditarCanalPage() {
  const params = useParams();
  const router = useRouter();
  const channelId = typeof params?.channelId === "string" ? params.channelId : "";

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [row, setRow] = useState<ChatChannelRow | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!channelId) return;
    setLoadError(null);
    try {
      const r = await fetchChatChannelById(channelId);
      setRow(r);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Error al cargar");
      setRow(null);
    }
  }, [channelId]);

  useEffect(() => {
    getMisModulos()
      .then((mods) => setAllowed(hasOmnichannel(mods.map((m) => m.slug))))
      .catch(() => setAllowed(false));
  }, []);

  useEffect(() => {
    if (allowed && channelId) void load();
  }, [allowed, channelId, load]);

  async function handleDelete() {
    if (!channelId || !confirm("¿Eliminar este canal? Las conversaciones asociadas pueden quedar huérfanas.")) {
      return;
    }
    setDeleting(true);
    try {
      await deleteChatChannel(channelId);
      router.push("/configuracion/canales");
    } catch (e) {
      alert(e instanceof Error ? e.message : "No se pudo eliminar");
    } finally {
      setDeleting(false);
    }
  }

  if (allowed === null) {
    return <div className="py-24 text-center text-sm text-slate-400">Cargando…</div>;
  }

  if (!allowed) {
    return (
      <div className="max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Módulo no habilitado.{" "}
        <Link href="/configuracion/canales" className="font-semibold underline">
          Volver
        </Link>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-xl space-y-4">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}</div>
        <Link href="/configuracion/canales" className="text-sm font-medium text-[#0EA5E9] hover:underline">
          ← Volver a canales
        </Link>
      </div>
    );
  }

  if (row === undefined) {
    return <div className="py-24 text-center text-sm text-slate-400">Cargando canal…</div>;
  }

  if (row === null) {
    return (
      <div className="max-w-xl space-y-4">
        <p className="text-slate-700">No encontramos este canal o no pertenece a tu empresa.</p>
        <Link href="/configuracion/canales" className="text-sm font-medium text-[#0EA5E9] hover:underline">
          ← Volver a canales
        </Link>
      </div>
    );
  }

  const type = normalizeChannelType(row.type);
  const isWhatsapp = type === "whatsapp";
  const providerNorm = String(row.provider ?? "meta").trim().toLowerCase();
  const isYcloud = isWhatsapp && providerNorm === "ycloud";
  const cardDef = OMNICHANNEL_CARD_DEFINITIONS.find((d) => d.type === type);

  return (
    <div className="w-full max-w-none space-y-6 px-4 sm:px-6 lg:px-8 xl:px-10 pb-10">
      <nav className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/configuracion" className="hover:text-slate-800">
          Configuración
        </Link>
        <span>/</span>
        <Link href="/configuracion/canales" className="hover:text-slate-800">
          Canales
        </Link>
        <span>/</span>
        <span className="text-slate-800 font-medium truncate max-w-[200px]">{row.nombre ?? channelId}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{row.nombre ?? channelTypeLabel(row.type)}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ChannelBadge type={row.type} nombre={null} />
            <span className="text-[11px] font-semibold uppercase text-slate-400">
              {String(row.provider ?? "meta")}
              {row.connection_mode ? ` · ${row.connection_mode}` : ""}
            </span>
            {row.config_status === "active" && row.activo ? (
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold uppercase text-emerald-800 border border-emerald-200">
                Activo
              </span>
            ) : row.config_status === "incomplete" && row.activo ? (
              <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold uppercase text-amber-900 border border-amber-200">
                Config. incompleta
              </span>
            ) : (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold uppercase text-slate-600 border border-slate-200">
                Inactivo
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          disabled={deleting}
          onClick={() => void handleDelete()}
          className="text-sm font-semibold text-red-600 hover:text-red-800 disabled:opacity-50"
        >
          {deleting ? "Eliminando…" : "Eliminar canal"}
        </button>
      </div>

      <section className="w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4 lg:mb-6">
          Credenciales y opciones
        </h2>
        {isWhatsapp ? (
          <WhatsAppChannelForm
            mode="edit"
            connectionProfile={isYcloud ? "ycloud" : "meta"}
            channelId={row.id}
            initialRow={row}
            cancelHref="/configuracion/canales"
            onSaved={() => void load()}
          />
        ) : (
          <div className="space-y-5">
            <GenericOmnichannelChannelForm
              mode="edit"
              channelId={row.id}
              channelType={type as "instagram" | "facebook" | "linkedin" | "email"}
              defaultProvider={cardDef?.defaultProvider ?? "meta"}
              initialRow={row}
              cancelHref="/configuracion/canales"
              onSaved={() => void load()}
            />
            <div className="border-t border-slate-200 pt-5">
              <ChannelQuickRepliesStandaloneBlock
                channelId={row.id}
                channelRow={row}
                onPersisted={() => void load()}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
