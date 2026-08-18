import type { PoolClient } from "pg";
import type { SaveIncomingMessageResult } from "@/lib/chat/incoming-message-service";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

const LOG = "[webhooks/ycloud]";
const LOG_IN = "[ycloud-incoming]";

export type YCloudPersistPgInput = {
  data_schema: string;
  empresa_id: string;
  channel_id: string;
  external_id: string;
  contact_phone_normalized: string;
  contact_display_name: string;
  message_type: string;
  content: string | null;
  raw_payload: Record<string, unknown>;
  created_at_iso: string;
  /** Saliente (eco SMB, envío desde app de negocio, etc.). */
  from_me?: boolean;
  sender_type?: string;
  /** Por defecto: solo incrementa unread en mensajes entrantes del contacto. */
  bump_unread?: boolean;
};

async function resolveFlowForNewWhatsappConversation(
  client: PoolClient,
  schema: string,
  empresaId: string
): Promise<{ flow_code: string | null; flow_current_node: string | null }> {
  const sch = assertAllowedChatDataSchema(schema);
  const ft = quoteSchemaTable(sch, "chat_flows");
  const nt = quoteSchemaTable(sch, "chat_flow_nodes");
  const r = await client.query(
    `SELECT flow_code::text AS flow_code
     FROM ${ft}
     WHERE empresa_id = $1::uuid AND channel = 'whatsapp' AND activo = true
     ORDER BY flow_code ASC`,
    [empresaId]
  );
  const codes = [...new Set((r.rows ?? []).map((x) => String((x as { flow_code: string }).flow_code).trim()).filter(Boolean))];
  if (codes.length !== 1) {
    return { flow_code: null, flow_current_node: null };
  }
  const fc = codes[0]!;
  const n = await client.query(
    `SELECT node_code::text AS node_code
     FROM ${nt}
     WHERE empresa_id = $1::uuid AND flow_code = $2::text AND is_active = true
     ORDER BY sort_order ASC NULLS LAST, created_at ASC
     LIMIT 1`,
    [empresaId, fc]
  );
  const node = (n.rows[0] as { node_code?: string } | undefined)?.node_code?.trim() || null;
  return { flow_code: fc, flow_current_node: node ?? "inicio" };
}

/**
 * Persistencia del inbound YCloud vía Postgres (schemas tenant no expuestos en PostgREST).
 * Una sola transacción: contacto, conversación (si falta), mensaje, bump de conversación.
 * La asignación a cola/agente la hace el route con `assignConversationPg` tras el COMMIT.
 */
export async function persistYCloudInboundMessagePg(input: YCloudPersistPgInput): Promise<SaveIncomingMessageResult> {
  const pool = getChatPostgresPool();
  if (!pool) {
    return { ok: false, error: "Sin pool Postgres (SUPABASE_DB_URL / DIRECT_URL / DATABASE_URL)" };
  }

  const schema = assertAllowedChatDataSchema(input.data_schema);
  const ext = input.external_id.trim();
  if (!ext) return { ok: false, error: "external_id es obligatorio" };
  const phone = input.contact_phone_normalized.trim();
  if (!phone) return { ok: false, error: "contact_data.address inválido" };

  const msgT = quoteSchemaTable(schema, "chat_messages");
  const convT = quoteSchemaTable(schema, "chat_conversations");
  const ctT = quoteSchemaTable(schema, "chat_contacts");
  const fsT = quoteSchemaTable(schema, "chat_flow_sessions");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const dup = await client.query(
      `SELECT id FROM ${msgT} WHERE wa_message_id = $1::text AND empresa_id = $2::uuid LIMIT 1`,
      [ext, input.empresa_id]
    );
    if (dup.rows[0]) {
      await client.query("COMMIT");
      console.info(LOG, LOG_IN, "persist_pg_duplicado", { wa_message_id: ext });
      return { ok: true, skipped_duplicate: true };
    }

    const cIns = await client.query(
      `INSERT INTO ${ctT} (empresa_id, phone_number, name)
       VALUES ($1::uuid, $2::text, $3::text)
       ON CONFLICT (empresa_id, phone_number)
       DO UPDATE SET
         name = COALESCE(NULLIF(btrim(EXCLUDED.name), ''), chat_contacts.name),
         updated_at = now()
       RETURNING id::text`,
      [input.empresa_id, phone, input.contact_display_name.trim() || phone]
    );
    const contactId = (cIns.rows[0] as { id: string }).id;

    type ConvRow = {
      id: string;
      status: string;
      unread_count: number;
      flow_code: string | null;
      flow_current_node: string | null;
      flow_status: string;
      human_taken_over: boolean;
      active_flow_session_id: string | null;
    };

    const convRes = await client.query(
      `SELECT id::text, status, unread_count, flow_code, flow_current_node, flow_status, human_taken_over, active_flow_session_id
       FROM ${convT}
       WHERE contact_id = $1::uuid AND channel_id = $2::uuid
       LIMIT 1`,
      [contactId, input.channel_id]
    );
    let conv: ConvRow | undefined = convRes.rows[0] as ConvRow | undefined;

    if (!conv) {
      const flow = await resolveFlowForNewWhatsappConversation(client, schema, input.empresa_id);
      let ins: { rows: ConvRow[] };
      try {
        ins = await client.query(
          `INSERT INTO ${convT} (
             empresa_id, channel_id, contact_id,
             status, flow_code, flow_current_node, flow_status, human_taken_over,
             last_message_at, last_message_preview, unread_count
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid,
             'open', $4::text, $5::text, 'bot', false,
             NULL, NULL, 0
           )
           RETURNING id::text, status, unread_count, flow_code, flow_current_node, flow_status, human_taken_over, active_flow_session_id`,
          [input.empresa_id, input.channel_id, contactId, flow.flow_code, flow.flow_current_node]
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("23505")) throw e;
        ins = await client.query(
          `SELECT id::text, status, unread_count, flow_code, flow_current_node, flow_status, human_taken_over, active_flow_session_id
           FROM ${convT}
           WHERE contact_id = $1::uuid AND channel_id = $2::uuid
           LIMIT 1`,
          [contactId, input.channel_id]
        );
      }
      conv = ins.rows[0] as ConvRow | undefined;
      if (!conv?.id) throw new Error("insert_conversacion_sin_fila");

      if (flow.flow_code) {
        const sidIns = await client.query(
          `INSERT INTO ${fsT} (empresa_id, conversation_id, flow_code, status)
           VALUES ($1::uuid, $2::uuid, $3::text, 'active')
           RETURNING id::text`,
          [input.empresa_id, conv.id, flow.flow_code]
        );
        const sid = (sidIns.rows[0] as { id: string } | undefined)?.id;
        if (sid) {
          await client.query(
            `UPDATE ${convT} SET active_flow_session_id = $1::uuid, updated_at = now() WHERE id = $2::uuid AND empresa_id = $3::uuid`,
            [sid, conv.id, input.empresa_id]
          );
        }
      }
    }

    if (!conv?.id) throw new Error("sin_conversacion");

    const conversationId = conv.id;

    const ts = input.created_at_iso.trim() || new Date().toISOString();
    const preview = (input.content ?? "").slice(0, 280);
    const fromMe = Boolean(input.from_me);
    const senderType = (input.sender_type ?? (fromMe ? "human" : "contact")).trim() || "contact";
    const bumpUnread =
      input.bump_unread !== undefined
        ? Boolean(input.bump_unread)
        : !fromMe && senderType.toLowerCase() === "contact";

    const convRow = await client.query(
      `SELECT status, unread_count, flow_code, flow_current_node, flow_status, human_taken_over
       FROM ${convT}
       WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [conversationId, input.empresa_id]
    );
    const row = convRow.rows[0] as
      | {
          status: string;
          unread_count: number;
          flow_code: string | null;
          flow_current_node: string | null;
          flow_status: string;
          human_taken_over: boolean;
        }
      | undefined;
    const prevStatus = row?.status ?? conv.status ?? "open";
    const nextStatus = prevStatus === "closed" ? "pending" : prevStatus;

    const msgIns = await client.query(
      `INSERT INTO ${msgT} (
         empresa_id, conversation_id, wa_message_id, from_me, sender_type, message_type, content, raw_payload, created_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::text, $4::boolean, $5::text, $6::text, $7::text, $8::jsonb, $9::timestamptz
       )
       RETURNING id::text`,
      [
        input.empresa_id,
        conversationId,
        ext,
        fromMe,
        senderType,
        input.message_type,
        input.content,
        JSON.stringify(input.raw_payload ?? {}),
        ts,
      ]
    );
    const messageId = (msgIns.rows[0] as { id: string }).id;

    const unreadBase = row?.unread_count ?? conv.unread_count ?? 0;

    const unreadNext = bumpUnread ? unreadBase + 1 : unreadBase;

    await client.query(
      `UPDATE ${convT}
       SET flow_code = $1::text,
           flow_current_node = $2::text,
           flow_status = COALESCE($3::text, flow_status),
           human_taken_over = COALESCE($4::boolean, human_taken_over),
           last_message_at = $5::timestamptz,
           last_message_preview = $6::text,
           unread_count = $7::int,
           status = $8::text,
           updated_at = now()
       WHERE id = $9::uuid AND empresa_id = $10::uuid`,
      [
        row?.flow_code ?? conv.flow_code ?? null,
        row?.flow_current_node ?? conv.flow_current_node ?? null,
        row?.flow_status ?? conv.flow_status ?? "bot",
        row?.human_taken_over ?? conv.human_taken_over ?? false,
        ts,
        preview,
        unreadNext,
        nextStatus,
        conversationId,
        input.empresa_id,
      ]
    );

    await client.query("COMMIT");

    console.info(LOG, LOG_IN, "persist_pg_ok", { conversation_id: conversationId, message_id: messageId });

    return {
      ok: true,
      skipped_duplicate: false,
      conversation_id: conversationId,
      contact_id: contactId,
      message_id: messageId,
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    console.error(LOG, LOG_IN, "persist_pg_error", msg);
    return { ok: false, error: msg };
  } finally {
    client.release();
  }
}
