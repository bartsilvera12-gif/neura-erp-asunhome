import type { Pool } from "pg";
import { quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";

/** Alineado a `ChannelQuickReplyRow` en quick-replies-actions (evita import circular). */
export type QuickReplyRowPg = {
  id: string;
  empresa_id: string;
  channel_id: string;
  title: string;
  body: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export async function pgChannelBelongsToEmpresa(
  pool: Pool,
  schema: string,
  empresaId: string,
  channelId: string
): Promise<boolean> {
  const qt = quoteSchemaTable(schema, "chat_channels");
  try {
    const r = await pool.query(
      `SELECT 1 AS one FROM ${qt} WHERE id = $1::uuid AND empresa_id = $2::uuid LIMIT 1`,
      [channelId.trim(), empresaId]
    );
    return (r.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function pgListActiveQuickRepliesForChannel(
  pool: Pool,
  schema: string,
  empresaId: string,
  channelId: string
): Promise<QuickReplyRowPg[]> {
  const qt = quoteSchemaTable(schema, "chat_channel_quick_replies");
  const q = `
    SELECT id::text, empresa_id::text, channel_id::text, title, body,
           sort_order, is_active, created_at, updated_at
    FROM ${qt}
    WHERE empresa_id = $1::uuid AND channel_id = $2::uuid AND is_active = true
    ORDER BY sort_order ASC NULLS LAST, title ASC
  `;
  const r = await pool.query(q, [empresaId, channelId.trim()]);
  return (r.rows ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id ?? ""),
    empresa_id: String(row.empresa_id ?? ""),
    channel_id: String(row.channel_id ?? ""),
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    sort_order: Number(row.sort_order) || 0,
    is_active: row.is_active !== false,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at ?? ""),
    updated_at:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at ?? ""),
  }));
}
