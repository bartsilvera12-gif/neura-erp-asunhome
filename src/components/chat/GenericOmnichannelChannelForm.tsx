"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  saveGenericOmnichannelChannel,
  type ChatChannelRow,
  type GenericOmnichannelChannelInput,
} from "@/lib/chat/actions";

type Props = {
  mode: "create" | "edit";
  channelId?: string;
  channelType: GenericOmnichannelChannelInput["type"];
  defaultProvider: string;
  initialRow?: ChatChannelRow | null;
  cancelHref?: string;
  onSaved?: (channelId: string) => void;
};

export function GenericOmnichannelChannelForm({
  mode,
  channelId,
  channelType,
  defaultProvider,
  initialRow,
  cancelHref = "/configuracion/canales",
  onSaved,
}: Props) {
  const [nombre, setNombre] = useState(initialRow?.nombre ?? "");
  const [provider, setProvider] = useState(initialRow?.provider ?? defaultProvider);
  const [activo, setActivo] = useState(initialRow?.activo ?? false);
  const [externalId, setExternalId] = useState(
    typeof initialRow?.config?.external_id === "string" ? (initialRow.config.external_id as string) : ""
  );
  const [notes, setNotes] = useState(
    typeof initialRow?.config?.integration_notes === "string"
      ? (initialRow.config.integration_notes as string)
      : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (mode === "edit" && initialRow) {
      setNombre(initialRow.nombre ?? "");
      setProvider(initialRow.provider ?? defaultProvider);
      setActivo(initialRow.activo);
      setExternalId(typeof initialRow.config?.external_id === "string" ? (initialRow.config.external_id as string) : "");
      setNotes(
        typeof initialRow.config?.integration_notes === "string"
          ? (initialRow.config.integration_notes as string)
          : ""
      );
    }
  }, [mode, initialRow, defaultProvider]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const config: Record<string, unknown> = {};
      if (externalId.trim()) config.external_id = externalId.trim();
      if (notes.trim()) config.integration_notes = notes.trim();
      const id = await saveGenericOmnichannelChannel({
        id: mode === "edit" ? channelId : undefined,
        type: channelType,
        nombre: nombre.trim() || channelType,
        provider: provider.trim() || defaultProvider,
        activo,
        config,
      });
      setSuccess("Guardado.");
      onSaved?.(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-2xl">
      {error ? (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-4 py-2">{error}</div>
      ) : null}
      {success ? (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg px-4 py-2">
          {success}
        </div>
      ) : null}

      <div>
        <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Nombre visible</label>
        <input
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Proveedor</label>
        <input
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          placeholder={defaultProvider}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Identificador externo</label>
        <input
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono bg-white"
          value={externalId}
          onChange={(e) => setExternalId(e.target.value)}
          placeholder="Page ID, inbox ID, dominio, etc."
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Notas internas</label>
        <textarea
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white min-h-[88px]"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Contexto para el equipo o Etapa 2"
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={Boolean(activo)} onChange={(e) => setActivo(e.target.checked)} />
        Habilitado (preparación; la integración end-to-end sigue en roadmap)
      </label>

      <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200">
        <button
          type="submit"
          disabled={saving}
          className="bg-[#0EA5E9] hover:bg-[#0284C7] disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium"
        >
          {saving ? "Guardando…" : mode === "edit" ? "Guardar" : "Crear borrador"}
        </button>
        <Link
          href={cancelHref}
          className="inline-flex items-center border border-slate-200 text-slate-700 hover:bg-slate-50 px-5 py-2.5 rounded-lg text-sm font-medium"
        >
          Volver
        </Link>
      </div>
    </form>
  );
}
