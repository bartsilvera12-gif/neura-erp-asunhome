import type { Pool } from "pg";
import { quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";

export type ChatChannelMetaPrevPg = {
  config: unknown;
  meta_phone_number_id: string | null;
  whatsapp_access_token: string | null;
};

export async function pgSelectChatChannelMetaPrev(
  pool: Pool,
  schema: string,
  empresaId: string,
  channelId: string
): Promise<ChatChannelMetaPrevPg | null> {
  const q = `
    SELECT config, meta_phone_number_id, whatsapp_access_token
    FROM ${quoteSchemaTable(schema, "chat_channels")}
    WHERE id = $1::uuid AND empresa_id = $2::uuid
    LIMIT 1
  `;
  const r = await pool.query(q, [channelId, empresaId]);
  const row = r.rows?.[0];
  if (!row) return null;
  return {
    config: row.config,
    meta_phone_number_id: row.meta_phone_number_id ?? null,
    whatsapp_access_token: row.whatsapp_access_token ?? null,
  };
}

export async function pgUpdateChatChannelMetaWhatsapp(
  pool: Pool,
  schema: string,
  empresaId: string,
  channelId: string,
  payload: {
    nombre: string;
    type: string;
    meta_phone_number_id: string;
    provider: string;
    provider_channel_id: string | null;
    activo: boolean;
    connection_mode: string;
    config_status: string;
    config: Record<string, unknown>;
    updated_at: string;
    whatsapp_access_token_patch?: string | null;
  }
): Promise<{ id: string } | null> {
  const qt = quoteSchemaTable(schema, "chat_channels");
  const cfg = JSON.stringify(payload.config ?? {});
  const tokenPatch = payload.whatsapp_access_token_patch?.trim();

  if (tokenPatch) {
    const q = `
      UPDATE ${qt} SET
        nombre = $3,
        type = $4,
        meta_phone_number_id = $5,
        provider = $6,
        provider_channel_id = $7,
        activo = $8,
        connection_mode = $9,
        config_status = $10,
        config = $11::jsonb,
        updated_at = $12::timestamptz,
        whatsapp_access_token = $13
      WHERE id = $1::uuid AND empresa_id = $2::uuid
      RETURNING id::text AS id
    `;
    const r = await pool.query(q, [
      channelId,
      empresaId,
      payload.nombre,
      payload.type,
      payload.meta_phone_number_id,
      payload.provider,
      payload.provider_channel_id,
      payload.activo,
      payload.connection_mode,
      payload.config_status,
      cfg,
      payload.updated_at,
      tokenPatch,
    ]);
    const id = r.rows?.[0]?.id as string | undefined;
    return id ? { id } : null;
  }

  const q = `
    UPDATE ${qt} SET
      nombre = $3,
      type = $4,
      meta_phone_number_id = $5,
      provider = $6,
      provider_channel_id = $7,
      activo = $8,
      connection_mode = $9,
      config_status = $10,
      config = $11::jsonb,
      updated_at = $12::timestamptz
    WHERE id = $1::uuid AND empresa_id = $2::uuid
    RETURNING id::text AS id
  `;
  const r = await pool.query(q, [
    channelId,
    empresaId,
    payload.nombre,
    payload.type,
    payload.meta_phone_number_id,
    payload.provider,
    payload.provider_channel_id,
    payload.activo,
    payload.connection_mode,
    payload.config_status,
    cfg,
    payload.updated_at,
  ]);
  const id = r.rows?.[0]?.id as string | undefined;
  return id ? { id } : null;
}

export async function pgInsertChatChannelMetaWhatsapp(
  pool: Pool,
  schema: string,
  payload: {
    empresa_id: string;
    nombre: string;
    type: string;
    meta_phone_number_id: string;
    provider: string;
    provider_channel_id: string | null;
    activo: boolean;
    connection_mode: string;
    config_status: string;
    config: Record<string, unknown>;
    whatsapp_access_token: string | null;
  }
): Promise<string> {
  const qt = quoteSchemaTable(schema, "chat_channels");
  const cfg = JSON.stringify(payload.config ?? {});
  const q = `
    INSERT INTO ${qt} (
      empresa_id, nombre, type, meta_phone_number_id, provider, provider_channel_id,
      activo, connection_mode, config_status, config, whatsapp_access_token
    )
    VALUES (
      $1::uuid, $2, $3, $4, $5, $6,
      $7, $8, $9, $10::jsonb, $11
    )
    RETURNING id::text AS id
  `;
  const r = await pool.query(q, [
    payload.empresa_id,
    payload.nombre,
    payload.type,
    payload.meta_phone_number_id,
    payload.provider,
    payload.provider_channel_id,
    payload.activo,
    payload.connection_mode,
    payload.config_status,
    cfg,
    payload.whatsapp_access_token,
  ]);
  const id = r.rows?.[0]?.id as string | undefined;
  if (!id) throw new Error("INSERT chat_channels no devolvió id.");
  return id;
}

export async function pgSelectChatChannelConfig(
  pool: Pool,
  schema: string,
  empresaId: string,
  channelId: string
): Promise<unknown | null> {
  const q = `
    SELECT config
    FROM ${quoteSchemaTable(schema, "chat_channels")}
    WHERE id = $1::uuid AND empresa_id = $2::uuid
    LIMIT 1
  `;
  const r = await pool.query(q, [channelId, empresaId]);
  return r.rows?.[0]?.config ?? null;
}

export async function pgUpdateChatChannelConfig(
  pool: Pool,
  schema: string,
  empresaId: string,
  channelId: string,
  config: Record<string, unknown>,
  updatedAt: string
): Promise<void> {
  const qt = quoteSchemaTable(schema, "chat_channels");
  const q = `
    UPDATE ${qt}
    SET config = $3::jsonb, updated_at = $4::timestamptz
    WHERE id = $1::uuid AND empresa_id = $2::uuid
  `;
  await pool.query(q, [channelId, empresaId, JSON.stringify(config), updatedAt]);
}

export async function pgDeleteChatChannel(
  pool: Pool,
  schema: string,
  empresaId: string,
  channelId: string
): Promise<{ meta_phone_number_id: string | null; provider: string | null } | null> {
  const qt = quoteSchemaTable(schema, "chat_channels");
  const q = `
    DELETE FROM ${qt}
    WHERE id = $1::uuid AND empresa_id = $2::uuid
    RETURNING meta_phone_number_id, provider
  `;
  const r = await pool.query(q, [channelId, empresaId]);
  const row = r.rows?.[0];
  if (!row) return null;
  return {
    meta_phone_number_id: row.meta_phone_number_id ?? null,
    provider: row.provider != null ? String(row.provider) : null,
  };
}

export async function pgUpdateGenericOmnichannelChannel(
  pool: Pool,
  schema: string,
  empresaId: string,
  channelId: string,
  row: {
    nombre: string;
    type: string;
    meta_phone_number_id: null;
    provider: string;
    provider_channel_id: null;
    activo: boolean;
    connection_mode: "standard";
    config_status: "inactive" | "incomplete" | "active";
    config: Record<string, unknown>;
    updated_at: string;
  }
): Promise<{ id: string } | null> {
  const qt = quoteSchemaTable(schema, "chat_channels");
  const cfg = JSON.stringify(row.config ?? {});
  const q = `
    UPDATE ${qt} SET
      nombre = $3,
      type = $4,
      meta_phone_number_id = NULL,
      provider = $5,
      provider_channel_id = NULL,
      activo = $6,
      connection_mode = $7,
      config_status = $8,
      config = $9::jsonb,
      updated_at = $10::timestamptz
    WHERE id = $1::uuid AND empresa_id = $2::uuid
    RETURNING id::text AS id
  `;
  const r = await pool.query(q, [
    channelId,
    empresaId,
    row.nombre,
    row.type,
    row.provider,
    row.activo,
    row.connection_mode,
    row.config_status,
    cfg,
    row.updated_at,
  ]);
  const id = r.rows?.[0]?.id as string | undefined;
  return id ? { id } : null;
}

export async function pgUpdateYCloudWhatsappChannel(
  pool: Pool,
  schema: string,
  empresaId: string,
  channelId: string,
  row: {
    nombre: string;
    type: string;
    provider: string;
    provider_channel_id: string | null;
    activo: boolean;
    connection_mode: string;
    config_status: string;
    config: Record<string, unknown>;
    updated_at: string;
  }
): Promise<{ id: string } | null> {
  const qt = quoteSchemaTable(schema, "chat_channels");
  const cfg = JSON.stringify(row.config ?? {});
  const q = `
    UPDATE ${qt} SET
      nombre = $3,
      type = $4,
      meta_phone_number_id = NULL,
      provider = $5,
      provider_channel_id = $6,
      activo = $7,
      connection_mode = $8,
      config_status = $9,
      config = $10::jsonb,
      updated_at = $11::timestamptz
    WHERE id = $1::uuid AND empresa_id = $2::uuid
    RETURNING id::text AS id
  `;
  const r = await pool.query(q, [
    channelId,
    empresaId,
    row.nombre,
    row.type,
    row.provider,
    row.provider_channel_id,
    row.activo,
    row.connection_mode,
    row.config_status,
    cfg,
    row.updated_at,
  ]);
  const id = r.rows?.[0]?.id as string | undefined;
  return id ? { id } : null;
}

export async function pgInsertYCloudWhatsappChannel(
  pool: Pool,
  schema: string,
  row: {
    empresa_id: string;
    nombre: string;
    type: string;
    provider: string;
    provider_channel_id: string | null;
    activo: boolean;
    connection_mode: string;
    config_status: string;
    config: Record<string, unknown>;
  }
): Promise<string> {
  const qt = quoteSchemaTable(schema, "chat_channels");
  const cfg = JSON.stringify(row.config ?? {});
  const q = `
    INSERT INTO ${qt} (
      empresa_id, nombre, type, meta_phone_number_id, provider, provider_channel_id,
      activo, connection_mode, config_status, config
    )
    VALUES (
      $1::uuid, $2, $3, NULL, $4, $5,
      $6, $7, $8, $9::jsonb
    )
    RETURNING id::text AS id
  `;
  const r = await pool.query(q, [
    row.empresa_id,
    row.nombre,
    row.type,
    row.provider,
    row.provider_channel_id,
    row.activo,
    row.connection_mode,
    row.config_status,
    cfg,
  ]);
  const id = r.rows?.[0]?.id as string | undefined;
  if (!id) throw new Error("INSERT canal YCloud no devolvió id.");
  return id;
}

export async function pgInsertGenericOmnichannelChannel(
  pool: Pool,
  schema: string,
  row: {
    empresa_id: string;
    nombre: string;
    type: string;
    meta_phone_number_id: null;
    provider: string;
    provider_channel_id: null;
    activo: boolean;
    connection_mode: "standard";
    config_status: "inactive" | "incomplete" | "active";
    config: Record<string, unknown>;
  }
): Promise<string> {
  const qt = quoteSchemaTable(schema, "chat_channels");
  const cfg = JSON.stringify(row.config ?? {});
  const q = `
    INSERT INTO ${qt} (
      empresa_id, nombre, type, meta_phone_number_id, provider, provider_channel_id,
      activo, connection_mode, config_status, config
    )
    VALUES (
      $1::uuid, $2, $3, NULL, $4, NULL,
      $5, $6, $7, $8::jsonb
    )
    RETURNING id::text AS id
  `;
  const r = await pool.query(q, [
    row.empresa_id,
    row.nombre,
    row.type,
    row.provider,
    row.activo,
    row.connection_mode,
    row.config_status,
    cfg,
  ]);
  const id = r.rows?.[0]?.id as string | undefined;
  if (!id) throw new Error("INSERT canal omnicanal no devolvió id.");
  return id;
}
