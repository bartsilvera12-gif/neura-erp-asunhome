/**
 * Diagnóstico de cierre sorteo por teléfono (tenant PG).
 * Env: CHAT_DIAGNOSE_SCHEMA, CHAT_DIAGNOSE_EMPRESA_ID, CHAT_DIAGNOSE_PHONE
 * O argumentos: npx tsx scripts/diagnose-sorteo-close-for-phone.ts [schema] [empresa_uuid] [phone]
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
      LIMIT 3
    `;
    const convR = await pool.query(convQ, [EMPRESA, PHONE]);
    if (!convR.rows.length) {
      console.log(JSON.stringify({ error: "sin_contacto_o_conversacion", phone: PHONE }, null, 2));
      return;
    }
    const row = convR.rows[0] as Record<string, unknown>;
    const conversationId = String(row.conversation_id);
    const sid = row.active_flow_session_id ? String(row.active_flow_session_id) : "";

    const fdQ = `
      SELECT field_name, left(field_value, 200) AS field_value_preview
      FROM "${SCHEMA}".chat_flow_data
      WHERE empresa_id = $1::uuid AND flow_session_id = $2::uuid
      ORDER BY field_name
    `;
    const fdR = sid ? await pool.query(fdQ, [EMPRESA, sid]) : { rows: [] };

    const valQ = `
      SELECT id, flow_session_id, estado_validacion, motivo_validacion,
             left(comprobante_url, 120) AS url_preview,
             left(comprobante_media_id, 80) AS media_id_preview,
             sorteo_entrada_id
      FROM "${SCHEMA}".chat_comprobante_validaciones
      WHERE empresa_id = $1::uuid AND conversation_id = $2::uuid
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 5
    `;
    const valR = await pool.query(valQ, [EMPRESA, conversationId]);

    const entQ = `
      SELECT e.id, e.numero_orden, e.sorteo_id, e.cantidad_boletos,
             left(e.nombre_participante, 80) AS nombre_participante,
             left(e.documento, 40) AS documento,
             e.created_at
      FROM "${SCHEMA}".sorteo_entradas e
      WHERE e.empresa_id = $1::uuid
        AND e.chat_conversation_id = $2::uuid
      ORDER BY e.created_at DESC NULLS LAST
      LIMIT 5
    `;
    const entR = await pool.query(entQ, [EMPRESA, conversationId]);

    let cupones: unknown[] = [];
    const entradaId = entR.rows[0]?.id;
    if (entradaId) {
      const cupQ = `
        SELECT numero_cupon FROM "${SCHEMA}".sorteo_cupones
        WHERE empresa_id = $1::uuid AND sorteo_entrada_id = $2::uuid
        ORDER BY numero_cupon
        LIMIT 50
      `;
      cupones = (await pool.query(cupQ, [EMPRESA, entradaId])).rows;
    }

    const tdQ = `
      SELECT id, status, left(coalesce(storage_path,''), 120) AS storage_path,
             left(coalesce(whatsapp_message_id,''), 40) AS wa_mid,
             left(coalesce(error_message,''), 200) AS err
      FROM "${SCHEMA}".sorteo_ticket_deliveries
      WHERE empresa_id = $1::uuid AND conversation_id = $2::uuid
      ORDER BY created_at DESC NULLS LAST
      LIMIT 5
    `;
    const tdR = await pool.query(tdQ, [EMPRESA, conversationId]);

    const msgQ = `
      SELECT message_type, left(content, 400) AS content_preview, from_me, created_at
      FROM "${SCHEMA}".chat_messages
      WHERE empresa_id = $1::uuid AND conversation_id = $2::uuid
      ORDER BY created_at DESC NULLS LAST
      LIMIT 12
    `;
    const msgR = await pool.query(msgQ, [EMPRESA, conversationId]);

    const fdMap = Object.fromEntries(
      fdR.rows.map((r: { field_name: string; field_value_preview: string }) => [
        r.field_name,
        r.field_value_preview,
      ])
    );
    const urlFd = fdMap["sorteo_comprobante_url"] ?? "";
    const mediaFd = fdMap["sorteo_comprobante_media_id"] ?? "";
    const emptyFinalRisk =
      /participación fue registrada/i.test(
        String((msgR.rows as { content_preview?: string }[]).find((m) => m.from_me)?.content_preview ?? "")
      ) &&
      (!fdMap["numero_orden"]?.trim() || !fdMap["numeros_cupon"]?.trim());

    const out = {
      schema: SCHEMA,
      empresa_id: EMPRESA,
      phone: PHONE,
      conversation_id: conversationId,
      active_flow_session_id: sid || null,
      flow_current_node: row.flow_current_node,
      flow_data_keys_sample: Object.keys(fdMap).filter((k) =>
        /sorteo|comprobante|orden|cupon|pendiente|numero/i.test(k)
      ),
      comprobante_in_flow_data: {
        has_url: Boolean(urlFd?.trim()),
        has_media_id: Boolean(mediaFd?.trim()),
      },
      validations: valR.rows,
      sorteo_entradas: entR.rows,
      cupones_count: cupones.length,
      cupones_sample: cupones.slice(0, 8),
      ticket_deliveries: tdR.rows,
      last_messages: msgR.rows,
      heuristic_empty_final_message: Boolean(emptyFinalRisk),
      probable_cause:
        entR.rows.length === 0
          ? "Caso_A_or_E: sin entrada — finalize no corrió o falló antes de RPC"
          : !fdMap["numero_orden"]?.trim()
            ? "Caso_C: entrada existe pero chat_flow_data sin numero_orden (sesión/upsert)"
            : !urlFd?.trim() && !valR.rows[0]?.url_preview
              ? "sin_comprobante_en_sesion likely — falta URL/media en flow_data y validación"
              : cupones.length === 0
                ? "Caso_B: entrada sin cupones"
                : tdR.rows.length === 0
                  ? "Caso_F: sin ticket_delivery"
                  : "revisar plantilla / merge vars",
    };

    console.log(JSON.stringify(out, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
