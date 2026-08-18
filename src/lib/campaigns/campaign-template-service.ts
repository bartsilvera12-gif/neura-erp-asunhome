import "server-only";
import type { SupabaseAdmin } from "@/lib/chat/types";
import { fetchMetaApprovedTemplates } from "@/lib/campaigns/providers/meta-campaign-provider";
import { fetchYCloudApprovedTemplates } from "@/lib/campaigns/providers/ycloud-campaign-provider";
import type { CampaignProviderId } from "@/lib/campaigns/providers/types";
import { effectiveOutboundProvider } from "@/lib/chat/outbound-send-dispatch";

function readChannelConfig(config: unknown): Record<string, unknown> {
  return config && typeof config === "object" && !Array.isArray(config)
    ? (config as Record<string, unknown>)
    : {};
}

export async function syncCampaignTemplatesForChannel(params: {
  supabase: SupabaseAdmin;
  empresaId: string;
  channelId: string;
}): Promise<{ inserted: number; fetched: number; error?: string }> {
  const { supabase, empresaId, channelId } = params;

  const { data: ch, error: chErr } = await supabase
    .from("chat_channels")
    .select(
      "id, empresa_id, provider, type, config, meta_phone_number_id, whatsapp_access_token, activo, provider_channel_id"
    )
    .eq("id", channelId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (chErr || !ch) {
    return { inserted: 0, fetched: 0, error: chErr?.message ?? "Canal no encontrado" };
  }

  const channel = ch as {
    config?: unknown;
    activo?: boolean;
    provider?: string | null;
    type?: string | null;
    whatsapp_access_token?: string | null;
    meta_phone_number_id?: string | null;
    provider_channel_id?: string | null;
  };
  if (channel.activo === false) {
    return { inserted: 0, fetched: 0, error: "Canal desactivado" };
  }

  const provider = effectiveOutboundProvider(channel) as CampaignProviderId;
  const cfg = readChannelConfig(channel.config);
  const now = new Date().toISOString();

  let rows: Awaited<ReturnType<typeof fetchMetaApprovedTemplates>> = [];

  if (provider === "meta") {
    const waba =
      typeof cfg.meta_waba_id === "string"
        ? cfg.meta_waba_id.trim()
        : typeof cfg.waba_id === "string"
          ? String(cfg.waba_id).trim()
          : "";
    const tok =
      typeof channel.whatsapp_access_token === "string" ? channel.whatsapp_access_token.trim() : "";
    if (!waba || !tok) {
      return {
        inserted: 0,
        fetched: 0,
        error: "Canal Meta: configurá meta_waba_id en el canal y token de acceso para sincronizar plantillas.",
      };
    }
    try {
      rows = await fetchMetaApprovedTemplates({ wabaId: waba, accessToken: tok });
    } catch (e) {
      return { inserted: 0, fetched: 0, error: e instanceof Error ? e.message : "Error Meta templates" };
    }
  } else {
    const apiKey = typeof cfg.ycloud_api_key === "string" ? cfg.ycloud_api_key.trim() : "";
    const waba =
      typeof cfg.ycloud_waba_id === "string"
        ? cfg.ycloud_waba_id.trim()
        : typeof cfg.meta_waba_id === "string"
          ? cfg.meta_waba_id.trim()
          : typeof channel.provider_channel_id === "string"
            ? String(channel.provider_channel_id).trim()
            : typeof cfg.ycloud_channel_id === "string"
              ? cfg.ycloud_channel_id.trim()
              : "";
    if (!apiKey) {
      return { inserted: 0, fetched: 0, error: "Canal YCloud: falta ycloud_api_key en la configuración." };
    }
    if (!waba) {
      return {
        inserted: 0,
        fetched: 0,
        error:
          "El canal YCloud seleccionado no tiene configurado el identificador de la cuenta de WhatsApp Business (WABA). " +
          "Editá el canal en Configuración → Canales, completá “WABA ID” o “Channel ID” según YCloud, y volvé a sincronizar plantillas.",
      };
    }
    rows = await fetchYCloudApprovedTemplates({ apiKey, wabaId: waba });
  }

  const fetched = rows.length;
  let n = 0;
  for (const r of rows) {
    const { error } = await supabase.from("chat_campaign_templates").upsert(
      {
        empresa_id: empresaId,
        channel_id: channelId,
        provider,
        provider_template_id: r.provider_template_id,
        name: r.name,
        language: r.language,
        category: r.category,
        status: "APPROVED",
        components_json: r.components_json,
        variable_schema_json: r.variable_schema_json,
        provider_payload_json: r.provider_payload_json,
        last_synced_at: now,
        updated_at: now,
      },
      { onConflict: "empresa_id,channel_id,provider,name,language" }
    );
    if (!error) n += 1;
    else {
      console.warn("[campaign-template-service] chat_campaign_templates upsert failed", {
        channelId,
        name: r.name,
        language: r.language,
        message: error.message,
      });
    }
  }

  return { inserted: n, fetched };
}
