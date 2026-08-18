/**
 * Diagnóstico: usuario trabado tras mensaje de cantidad / datos incompletos en sorteo.
 *
 * Env: CHAT_DIAGNOSE_SCHEMA, CHAT_DIAGNOSE_EMPRESA_ID, CHAT_DIAGNOSE_PHONE
 * O: npx tsx scripts/diagnose-sorteo-quantity-stuck.ts [schema] [empresa_uuid] [phone]
 */
import { config } from "dotenv";
import pg from "pg";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local"), quiet: true });

const SCHEMA =
  process.argv[2] ?? process.env.CHAT_DIAGNOSE_SCHEMA ?? "erp_el_papu_store_5ad0bdda";
const EMPRESA =
  process.argv[3] ?? process.env.CHAT_DIAGNOSE_EMPRESA_ID ?? "5ad0bdda-f94f-446c-9032-1fedf34e8479";
const PHONE_RAW = process.argv[4] ?? process.env.CHAT_DIAGNOSE_PHONE ?? "";
const PHONE = PHONE_RAW.replace(/\D/g, "");

const QTY_KEYS = [
  "cantidad",
  "sorteo_cantidad_opcion",
  "sorteo_snap_cantidad",
  "cantidad_boletos",
  "cantidad_boletas",
  "cantidad_numeros",
  "cantidad_entradas",
  "numeros",
  "entradas",
  "boletos",
  "qty",
  "opcion_label",
  "monto",
  "sorteo_comprobante_validacion_id",
  "sorteo_comprobante_url",
  "sorteo_comprobante_media_id",
  "sorteo_entrada_id",
  "numero_orden",
];

async function main() {
  const url =
    process.env.SUPABASE_DB_URL?.trim() ||
    process.env.DIRECT_URL?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("Falta SUPABASE_DB_URL / DIRECT_URL / DATABASE_URL");
    process.exit(2);
  }
  if (!PHONE) {
    console.error("Falta teléfono (arg o CHAT_DIAGNOSE_PHONE)");
    process.exit(2);
  }

  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const convQ = `
      SELECT
        c.id AS contact_id,
        c.phone_number,
        c.name AS contact_name,
        conv.id AS conversation_id,
        conv.flow_code,
        conv.flow_current_node,
        conv.flow_status,
        conv.human_taken_over,
        conv.active_flow_session_id,
        conv.updated_at AS conv_updated_at,
        sess.status AS session_status,
        sess.flow_code AS session_flow_code
      FROM "${SCHEMA}".chat_contacts c
      JOIN "${SCHEMA}".chat_conversations conv
        ON conv.contact_id = c.id AND conv.empresa_id = c.empresa_id
      LEFT JOIN "${SCHEMA}".chat_flow_sessions sess
        ON sess.id = conv.active_flow_session_id AND sess.empresa_id = conv.empresa_id
      WHERE c.empresa_id = $1::uuid
        AND regexp_replace(coalesce(c.phone_number,''), '\\D', '', 'g') LIKE '%' || $2 || '%'
      ORDER BY conv.updated_at DESC NULLS LAST
      LIMIT 1
    `;
    const convR = await pool.query(convQ, [EMPRESA, PHONE]);
    if (!convR.rows.length) {
      console.log(JSON.stringify({ error: "sin_contacto_o_conversacion", phone: PHONE }, null, 2));
      return;
    }
    const row = convR.rows[0] as Record<string, unknown>;
    const conversationId = String(row.conversation_id);
    const sid = row.active_flow_session_id ? String(row.active_flow_session_id) : "";
    const flowCode = row.flow_code ? String(row.flow_code) : "";

    const fdQ =
      sid !== ""
        ? `
      SELECT field_name, left(field_value, 400) AS field_value_preview
      FROM "${SCHEMA}".chat_flow_data
      WHERE empresa_id = $1::uuid AND flow_session_id = $2::uuid
      ORDER BY field_name
    `
        : `
      SELECT field_name, left(field_value, 400) AS field_value_preview
      FROM "${SCHEMA}".chat_flow_data
      WHERE empresa_id = $1::uuid AND conversation_id = $2::uuid AND flow_code = $3
      ORDER BY created_at DESC NULLS LAST
      LIMIT 200
    `;

    const fdR =
      sid !== ""
        ? await pool.query(fdQ, [EMPRESA, sid])
        : await pool.query(fdQ, [EMPRESA, conversationId, flowCode]);

    const fdRows = fdR.rows as { field_name: string; field_value_preview: string }[];
    const qtyPreview = Object.fromEntries(
      fdRows
        .filter((r) =>
          QTY_KEYS.some((k) => r.field_name.toLowerCase().includes(k.toLowerCase())) ||
          /cantidad|bolet|entrada|numer|qty|opcion|monto|comprobante|entrada_id|orden/i.test(
            r.field_name
          )
        )
        .map((r) => [r.field_name, r.field_value_preview])
    );

    const evQ = `
      SELECT event_type, node_code, left(coalesce(payload::text,''), 500) AS payload_preview,
             created_at, selected_option_id
      FROM "${SCHEMA}".chat_flow_events
      WHERE empresa_id = $1::uuid AND conversation_id = $2::uuid
      ORDER BY created_at DESC NULLS LAST
      LIMIT 25
    `;
    const evR = await pool.query(evQ, [EMPRESA, conversationId]);

    const optQ = flowCode
      ? `
      SELECT o.id, o.label, left(coalesce(o.option_payload::text,''), 300) AS payload_preview,
             o.next_node_code, n.node_code AS parent_node_code
      FROM "${SCHEMA}".chat_flow_options o
      JOIN "${SCHEMA}".chat_flow_nodes n ON n.id = o.node_id AND n.empresa_id = $1::uuid
      WHERE n.empresa_id = $1::uuid AND n.flow_code = $2
        AND (n.node_type = 'buttons' OR n.node_type = 'list')
      ORDER BY n.sort_order, o.sort_order
    `
      : null;
    const optR = optQ ? await pool.query(optQ, [EMPRESA, flowCode]) : { rows: [] };

    const msgQ = `
      SELECT from_me, left(content, 220) AS content_preview, message_type, created_at
      FROM "${SCHEMA}".chat_messages
      WHERE empresa_id = $1::uuid AND conversation_id = $2::uuid
        AND (
          content ILIKE '%confirmar nuevamente la cantidad%'
          OR content ILIKE '%combos%'
          OR message_type = 'interactive'
        )
      ORDER BY created_at DESC NULLS LAST
      LIMIT 15
    `;
    const msgR = await pool.query(msgQ, [EMPRESA, conversationId]);

    const sessionsQ = `
      SELECT id, status, flow_code, started_at, created_at
      FROM "${SCHEMA}".chat_flow_sessions
      WHERE empresa_id = $1::uuid AND conversation_id = $2::uuid
      ORDER BY started_at DESC NULLS LAST
      LIMIT 8
    `;
    const sessionsR = await pool.query(sessionsQ, [EMPRESA, conversationId]);

    console.log(
      JSON.stringify(
        {
          schema: SCHEMA,
          empresa_id: EMPRESA,
          phone_query: PHONE,
          contact: {
            id: row.contact_id,
            name: row.contact_name,
            phone: row.phone_number,
          },
          conversation: {
            id: conversationId,
            flow_code: row.flow_code,
            flow_current_node: row.flow_current_node,
            flow_status: row.flow_status,
            human_taken_over: row.human_taken_over,
            active_flow_session_id: sid || null,
            updated_at: row.conv_updated_at,
          },
          session_active: sid
            ? {
                status: row.session_status,
                flow_code: row.session_flow_code,
              }
            : null,
          flow_data_quantity_related: qtyPreview,
          flow_data_all_keys: fdRows.map((r) => r.field_name),
          recent_flow_events: evR.rows,
          combo_like_options: optR.rows,
          relevant_messages: msgR.rows,
          recent_sessions: sessionsR.rows,
          nota:
            "Si cantidad está solo en otra sesión o bajo alias (cantidad_numeros), el código ahora normaliza; si falta del todo, el bot debe reenviar el nodo de combos.",
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
