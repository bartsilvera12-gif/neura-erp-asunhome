import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { createServiceRoleClientForEmpresa } from "@/lib/supabase/empresa-data-schema";
import { resolveEmpresaDataSchema } from "@/lib/supabase/schema";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { isLikelyUnexposedTenantChatSchema } from "@/lib/supabase/chat-data-schema";
import type { SupabaseAdmin } from "@/lib/chat/types";
import { isInvalidPostgrestSchemaError } from "@/lib/chat/postgrest-schema-error";
import { verifyYCloudWebhookSignatureWithDebug } from "@/lib/chat/webhooks/ycloud-signature";
import { explainYCloudChannelMatch, type YCloudInboundIdentifiers } from "@/lib/chat/webhooks/ycloud-match";

export type { YCloudInboundIdentifiers } from "@/lib/chat/webhooks/ycloud-match";

const LOG = "[webhooks/ycloud]";
const LOG_IN = "[ycloud-incoming]";

function cfgStr(cfg: Record<string, unknown>, key: string): string {
  const v = cfg[key];
  return typeof v === "string" ? v.trim() : "";
}

function summarizeSigHeader(h: string | null): { present: boolean; has_t: boolean; has_s: boolean; preview: string } {
  const t = (h ?? "").trim();
  if (!t) return { present: false, has_t: false, has_s: false, preview: "" };
  const has_t = /(?:^|,)\s*t=/.test(t);
  const has_s = /(?:^|,)\s*s=/.test(t);
  const preview = t.length > 48 ? `${t.slice(0, 48)}…` : t;
  return { present: true, has_t, has_s, preview };
}

function secretHint(secret: string): { configured: boolean; length: number } {
  const s = secret.trim();
  return { configured: s.length > 0, length: s.length };
}

type ChannelRow = {
  id: string;
  empresa_id: string;
  provider: string;
  type: string;
  config: unknown;
  provider_channel_id: string | null;
};

async function loadYcloudChannelRows(
  empresaId: string,
  dataSchema: string
): Promise<{ rows: ChannelRow[]; source: "pg" | "postgrest"; skipReason?: string }> {
  const pool = getChatPostgresPool();
  const tenant = isLikelyUnexposedTenantChatSchema(dataSchema);

  if (pool && (tenant || process.env.YCLOUD_WEBHOOK_CHAT_PG_ALWAYS === "1")) {
    const q = `
      SELECT id, empresa_id, provider, type, config, provider_channel_id, activo
      FROM ${quoteSchemaTable(dataSchema, "chat_channels")}
      WHERE empresa_id = $1::uuid
        AND type = 'whatsapp'
        AND provider = 'ycloud'
        AND activo = true
    `;
    const r = await pool.query(q, [empresaId]);
    return {
      rows: (r.rows ?? []) as ChannelRow[],
      source: "pg",
    };
  }

  let supabase: SupabaseAdmin;
  try {
    supabase = (await createServiceRoleClientForEmpresa(empresaId)) as SupabaseAdmin;
  } catch (e) {
    return {
      rows: [],
      source: "postgrest",
      skipReason: e instanceof Error ? e.message : "cliente_supabase",
    };
  }

  const { data: rows, error: chErr } = await supabase
    .from("chat_channels")
    .select("id, empresa_id, provider, type, config, provider_channel_id, activo")
    .eq("empresa_id", empresaId)
    .eq("type", "whatsapp")
    .eq("provider", "ycloud")
    .eq("activo", true);

  if (chErr) {
    if (tenant && isInvalidPostgrestSchemaError(chErr.message)) {
      return {
        rows: [],
        source: "postgrest",
        skipReason:
          "PostgREST no expone el schema tenant; definí SUPABASE_DB_URL (pooler Postgres) en el entorno del webhook o agregá el schema en Supabase → API → Exposed schemas.",
      };
    }
    return { rows: [], source: "postgrest", skipReason: chErr.message };
  }

  return { rows: (rows ?? []) as ChannelRow[], source: "postgrest" };
}

export type ResolvedYCloudChannel = {
  empresa_id: string;
  channel_id: string;
  webhook_secret: string;
  /** Schema real de las tablas chat_* (para persistencia vía PG si hace falta). */
  data_schema: string;
};

/**
 * Busca canales WhatsApp YCloud que casen con el payload y cuya firma del body sea válida.
 */
export async function resolveYCloudChannelForWebhook(
  rawBody: string,
  signatureHeader: string | null,
  ids: YCloudInboundIdentifiers
): Promise<ResolvedYCloudChannel | null> {
  const catalog = createServiceRoleClient();
  const single = process.env.YCLOUD_WEBHOOK_EMPRESA_ID?.trim();

  let empresaRows: { id: string; data_schema: string | null }[] = [];
  if (single) {
    const { data: one, error } = await catalog
      .from("empresas")
      .select("id, data_schema")
      .eq("id", single)
      .maybeSingle();
    if (error) {
      console.warn(LOG, LOG_IN, "empresa_lookup", { error: error.message, YCLOUD_WEBHOOK_EMPRESA_ID: single });
      return null;
    }
    if (one) empresaRows = [one as { id: string; data_schema: string | null }];
  } else {
    const { data: emps, error } = await catalog.from("empresas").select("id, data_schema");
    if (error) {
      console.warn(LOG, LOG_IN, "list_empresas", error.message);
      return null;
    }
    empresaRows = (emps ?? []) as { id: string; data_schema: string | null }[];
  }

  const sigMeta = summarizeSigHeader(signatureHeader);
  console.info(LOG, LOG_IN, "resolver_inicio", {
    empresas_a_evaluar: empresaRows.length,
    wabaId: ids.wabaId,
    to: ids.to,
    from: ids.from,
    header_ycloud_signature: sigMeta,
  });

  type Candidate = {
    empresa_id: string;
    data_schema: string;
    channel_id: string;
    secret: string;
    match_strategy: string;
  };

  const candidatesMatch: Candidate[] = [];

  for (const emp of empresaRows) {
    const empresaId = (emp.id ?? "").trim();
    if (!empresaId) continue;

    const dataSchema = resolveEmpresaDataSchema(emp.data_schema);
    const { rows, source, skipReason } = await loadYcloudChannelRows(empresaId, dataSchema);

    if (skipReason && rows.length === 0) {
      console.info(LOG, LOG_IN, "skip_empresa_schema", {
        empresa_id: empresaId,
        data_schema: dataSchema,
        source,
        motivo: skipReason,
      });
      continue;
    }

    console.info(LOG, LOG_IN, "canales_ycloud_cargados", {
      empresa_id: empresaId,
      data_schema: dataSchema,
      source,
      count: rows.length,
    });

    for (const row of rows) {
      const r = row as ChannelRow;
      const ex = explainYCloudChannelMatch(r, ids);
      if (!ex.matched) continue;

      const cfg =
        r.config && typeof r.config === "object" && !Array.isArray(r.config)
          ? (r.config as Record<string, unknown>)
          : {};
      const secret = cfgStr(cfg, "ycloud_webhook_secret");
      const sh = secretHint(secret);

      console.info(LOG, LOG_IN, "candidato_payload", {
        empresa_id: r.empresa_id,
        data_schema: dataSchema,
        channel_id: r.id,
        match_strategy: ex.strategy,
        webhook_secret: sh,
      });

      if (!secret) {
        console.info(LOG, LOG_IN, "candidato_descartado", {
          channel_id: r.id,
          motivo: "sin_ycloud_webhook_secret_en_config",
        });
        continue;
      }

      candidatesMatch.push({
        empresa_id: r.empresa_id,
        data_schema: dataSchema,
        channel_id: r.id,
        secret,
        match_strategy: ex.strategy ?? "unknown",
      });
    }
  }

  if (candidatesMatch.length === 0) {
    console.warn(LOG, LOG_IN, "401", {
      canal_resuelto: false,
      motivo: "ningún_canal_coincide_con_payload_o_sin_secret",
      firma_evaluada: false,
      wabaId: ids.wabaId,
      to: ids.to,
    });
    return null;
  }

  let firmaAlgunaIntentada = false;
  for (const c of candidatesMatch) {
    firmaAlgunaIntentada = true;
    const sig = verifyYCloudWebhookSignatureWithDebug(rawBody, signatureHeader, c.secret);
    const firmaOk = sig.ok;
    console.info(LOG, LOG_IN, "firma_hmac", {
      canal_resuelto: true,
      empresa_id: c.empresa_id,
      data_schema: c.data_schema,
      channel_id: c.channel_id,
      match_strategy: c.match_strategy,
      firma_valida: firmaOk,
      matched_variant: sig.matched_variant,
      header_ycloud_signature: sigMeta,
      webhook_secret: secretHint(c.secret),
      sig_debug: firmaOk
        ? {
            raw_body_len: sig.raw_body_len,
            raw_body_sha256_16: sig.raw_body_sha256_16,
            signed_payload_len: sig.signed_payload_len,
            signed_payload_sha256_16: sig.signed_payload_sha256_16,
          }
        : {
            secret_len: sig.secret_len,
            raw_body_len: sig.raw_body_len,
            raw_body_sha256_16: sig.raw_body_sha256_16,
            signed_payload_len: sig.signed_payload_len,
            signed_payload_sha256_16: sig.signed_payload_sha256_16,
            t_len: sig.t_len,
            s_len: sig.s_len,
            s_preview: sig.s_preview,
            expected_hex_preview: sig.expected_hex_preview,
            nota:
              "Comparación oficial: HMAC-SHA256(hex) de `${t}.${rawBody}` (sin punto final). Se prueba también variante con punto final por compatibilidad.",
          },
    });
    if (firmaOk) {
      return {
        empresa_id: c.empresa_id,
        channel_id: c.channel_id,
        webhook_secret: c.secret,
        data_schema: c.data_schema,
      };
    }
  }

  console.warn(LOG, LOG_IN, "401", {
    canal_resuelto: true,
    candidatos_con_payload_y_secret: candidatesMatch.length,
    motivo: "firma_hmac_invalida_o_header_incompleto",
    firma_evaluada: firmaAlgunaIntentada,
    firma_valida: false,
    header_ycloud_signature: sigMeta,
    wabaId: ids.wabaId,
    to: ids.to,
  });
  return null;
}

/**
 * Valida la firma HMAC del body contra los canales YCloud de una sola empresa
 * (p. ej. eventos `whatsapp.message.updated` con `externalId` y sin from/to en el payload).
 */
export async function verifyYCloudWebhookSignatureForEmpresa(
  rawBody: string,
  signatureHeader: string | null,
  empresaId: string
): Promise<boolean> {
  const { data: emp, error } = await createServiceRoleClient()
    .from("empresas")
    .select("data_schema")
    .eq("id", empresaId)
    .maybeSingle();
  if (error || !emp) {
    console.warn(LOG, LOG_IN, "verify_empresa", { error: error?.message, empresaId });
    return false;
  }
  const dataSchema = resolveEmpresaDataSchema((emp as { data_schema?: string | null }).data_schema);
  const { rows, skipReason } = await loadYcloudChannelRows(empresaId, dataSchema);
  if (skipReason && rows.length === 0) {
    console.info(LOG, LOG_IN, "verify_empresa_sin_canales", { empresaId, skipReason });
    return false;
  }
  for (const row of rows) {
    const r = row as ChannelRow;
    const cfg =
      r.config && typeof r.config === "object" && !Array.isArray(r.config)
        ? (r.config as Record<string, unknown>)
        : {};
    const secret = cfgStr(cfg, "ycloud_webhook_secret");
    if (!secret) continue;
    const sig = verifyYCloudWebhookSignatureWithDebug(rawBody, signatureHeader, secret);
    if (sig.ok) return true;
  }
  return false;
}
