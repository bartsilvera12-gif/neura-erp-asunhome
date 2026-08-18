"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type ChannelOpt = {
  id: string;
  nombre: string | null;
  provider: string | null;
  type: string | null;
};

type QueueOpt = { id: string; nombre: string | null };

type TemplateOpt = {
  id: string;
  name: string;
  language: string;
  components_json: unknown[];
  variable_schema_json: Record<string, unknown>;
};

function providerFromChannel(ch: ChannelOpt): "meta" | "ycloud" {
  const p = String(ch.provider ?? "").trim().toLowerCase();
  if (p === "ycloud") return "ycloud";
  return "meta";
}

export default function CampanasNuevoClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [channels, setChannels] = useState<ChannelOpt[]>([]);
  const [queues, setQueues] = useState<QueueOpt[]>([]);
  const [channelId, setChannelId] = useState("");
  const [queueId, setQueueId] = useState("");
  const [templates, setTemplates] = useState<TemplateOpt[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [syncSummary, setSyncSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetchWithSupabaseSession("/api/campanas/options", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { channels: ChannelOpt[]; queues: QueueOpt[] };
      };
      if (cancelled || !res.ok || !json.success || !json.data) return;
      setChannels(json.data.channels ?? []);
      setQueues(json.data.queues ?? []);
      if ((json.data.channels ?? []).length === 1) {
        setChannelId(json.data.channels[0].id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === channelId),
    [channels, channelId]
  );

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId),
    [templates, templateId]
  );

  const slots = useMemo(() => {
    const vs = selectedTemplate?.variable_schema_json as { body_slots?: string[] } | undefined;
    return Array.isArray(vs?.body_slots) ? vs!.body_slots : [];
  }, [selectedTemplate]);

  const [mapping, setMapping] = useState<Record<string, string>>({});

  async function syncTemplates() {
    if (!channelId) {
      setErr("Elegí un canal");
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await fetchWithSupabaseSession("/api/campanas/templates/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel_id: channelId }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
      data?: { inserted?: number; fetched?: number };
    };
    setBusy(false);
    if (!res.ok || !json.success) {
      setErr(json.error ?? "No se pudieron sincronizar plantillas");
      setSyncSummary(null);
      return;
    }
    const fetchedFromApi = typeof json.data?.fetched === "number" ? json.data.fetched : undefined;
    const inserted = typeof json.data?.inserted === "number" ? json.data.inserted : undefined;

    const list = await fetchWithSupabaseSession(
      `/api/campanas/templates?channel_id=${encodeURIComponent(channelId)}`,
      { cache: "no-store" }
    );
    const lj = (await list.json().catch(() => ({}))) as { success?: boolean; data?: TemplateOpt[]; error?: string };
    if (!list.ok || !lj.success) {
      setErr(lj.error ?? "No se pudo cargar el listado de plantillas");
      setSyncSummary(null);
      setTemplates([]);
      return;
    }
    const listed = Array.isArray(lj.data) ? lj.data : [];
    setTemplates(listed);

    const n = listed.length;
    if (n > 0) {
      setSyncSummary(`Sincronización completada: ${n} plantilla(s) aprobada(s) disponible(s) para este canal.`);
    } else if (fetchedFromApi === 0) {
      setSyncSummary(
        "Sincronización completada, pero no se encontraron plantillas aprobadas para este canal. Verificá que la plantilla pertenezca al WABA configurado en YCloud y en Configuración → Canales."
      );
    } else if (typeof inserted === "number" && inserted === 0 && (fetchedFromApi ?? 0) > 0) {
      setSyncSummary(
        "YCloud devolvió plantillas pero no se pudieron guardar en el ERP. Revisá permisos de base de datos o contactá soporte."
      );
    } else {
      setSyncSummary(
        "Sincronización completada, pero no hay plantillas en el listado. Probá de nuevo o verificá el canal en Configuración → Canales."
      );
    }
  }

  async function createCampaign() {
    if (!name.trim() || !channelId || !selectedTemplate) {
      setErr("Nombre, canal y plantilla son obligatorios");
      return;
    }
    const prov = providerFromChannel(selectedChannel ?? { id: "", nombre: "", provider: null, type: null });
    setBusy(true);
    setErr(null);
    const res = await fetchWithSupabaseSession("/api/campanas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        channel_id: channelId,
        queue_id: queueId || null,
        provider: prov,
        template_id: selectedTemplate.id,
        template_name: selectedTemplate.name,
        template_language: selectedTemplate.language,
        template_components_json: selectedTemplate.components_json,
        variable_mapping_json: mapping,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      data?: { id: string };
      error?: string;
    };
    setBusy(false);
    if (!res.ok || !json.success || !json.data?.id) {
      setErr(json.error ?? "No se pudo crear");
      return;
    }
    router.push(`/dashboard/campanas/${json.data.id}`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <div>
        <Link href="/dashboard/campanas" className="text-sm text-indigo-600 hover:underline">
          ← Volver al listado
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">Nueva campaña</h1>
        <p className="text-sm text-slate-500">
          Configurá canal, cola y plantilla; en el detalle importás el archivo y validás variables.
        </p>
      </div>

      {err ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div> : null}

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Nombre de la campaña</span>
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Promo marzo"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Canal WhatsApp</span>
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={channelId}
            onChange={(e) => {
              setChannelId(e.target.value);
              setTemplates([]);
              setTemplateId("");
              setSyncSummary(null);
            }}
          >
            <option value="">Seleccionar…</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre || c.id} ({c.provider || "meta"})
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Cola de respuesta</span>
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={queueId}
            onChange={(e) => setQueueId(e.target.value)}
          >
            <option value="">(opcional — usa reglas del canal)</option>
            {queues.map((q) => (
              <option key={q.id} value={q.id}>
                {q.nombre || q.id}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            disabled={busy || !channelId}
            onClick={() => void syncTemplates()}
          >
            Sincronizar plantillas aprobadas
          </button>
          {syncSummary ? <span className="text-xs text-slate-700">{syncSummary}</span> : null}
        </div>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Plantilla</span>
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">Seleccionar…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.language})
              </option>
            ))}
          </select>
        </label>

        {slots.length > 0 ? (
          <div className="space-y-2 rounded-lg bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-700">Preview de mapeo (columnas del Excel)</p>
            <p className="text-xs text-slate-500">
              En el paso siguiente importarás el archivo; aquí podés adelantar el nombre de columna por cada{" "}
              {"{{n}}"}. También podés completarlo en la pantalla de detalle.
            </p>
            {slots.map((s) => (
              <label key={s} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-16 font-mono text-slate-600">{`{{${s}}}`}</span>
                <input
                  className="flex-1 rounded border border-slate-300 px-2 py-1"
                  placeholder="Nombre columna en Excel"
                  value={mapping[s] ?? ""}
                  onChange={(e) => setMapping((m) => ({ ...m, [s]: e.target.value }))}
                />
              </label>
            ))}
          </div>
        ) : null}

        <button
          type="button"
          className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          disabled={busy}
          onClick={() => void createCampaign()}
        >
          Crear borrador y continuar
        </button>
      </section>
    </div>
  );
}
