/**
 * Diagnóstico: alinear sesión validación vs conversación para un teléfono en un tenant.
 * Uso: npx tsx scripts/diag-sorteo-session-alignment.ts [schema] [empresa_uuid] [phone_digits]
 * Requiere SUPABASE_DB_URL o DIRECT_URL en .env.local
 */
import { config } from "dotenv";
import pg from "pg";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local"), quiet: true });

const SCHEMA = process.argv[2] ?? "erp_el_papu_store_5ad0bdda";
const EMPRESA = process.argv[3] ?? "5ad0bdda-f94f-446c-9032-1fedf34e8479";
const PHONE = (process.argv[4] ?? "595982422590").replace(/\D/g, "");

async function main() {
  const url =
    process.env.SUPABASE_DB_URL?.trim() ||
    process.env.DIRECT_URL?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("Falta SUPABASE_DB_URL / DIRECT_URL / DATABASE_URL en .env.local");
    process.exit(2);
  }
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const q = `
      SELECT
        c.id AS contact_id,
        c.phone_number,
        c.name AS contact_name,
        conv.id AS conversation_id,
        conv.flow_status,
        conv.human_taken_over,
        conv.flow_current_node,
        conv.active_flow_session_id AS conv_session_id,
        v.id AS validation_id,
        v.flow_session_id AS validation_session_id,
        v.estado_validacion,
        v.motivo_validacion,
        (conv.active_flow_session_id IS NOT DISTINCT FROM v.flow_session_id) AS sessions_aligned
      FROM "${SCHEMA}".chat_contacts c
      INNER JOIN "${SCHEMA}".chat_conversations conv
        ON conv.contact_id = c.id AND conv.empresa_id = c.empresa_id
      LEFT JOIN (
        SELECT DISTINCT ON (conversation_id)
          id, empresa_id, conversation_id, flow_session_id, estado_validacion, motivo_validacion, updated_at
        FROM "${SCHEMA}".chat_comprobante_validaciones
        WHERE empresa_id = $1::uuid
        ORDER BY conversation_id, updated_at DESC NULLS LAST
      ) v ON v.conversation_id = conv.id AND v.empresa_id = conv.empresa_id
      WHERE c.empresa_id = $1::uuid
        AND regexp_replace(coalesce(c.phone_number, ''), '\\D', '', 'g') LIKE '%' || $2 || '%'
      ORDER BY conv.updated_at DESC NULLS LAST
      LIMIT 8
    `;
    const r = await pool.query(q, [EMPRESA, PHONE]);
    console.log(JSON.stringify({ schema: SCHEMA, empresa_id: EMPRESA, phone: PHONE, rows: r.rows }, null, 2));

    const qData = `
      SELECT field_name, field_value, flow_session_id
      FROM "${SCHEMA}".chat_flow_data
      WHERE empresa_id = $1::uuid
        AND regexp_replace(coalesce(field_value,''), '^\\s+|\\s+$', '', 'g') ILIKE '%hector%'
        AND field_name ILIKE '%nombre%'
      ORDER BY created_at DESC NULLS LAST
      LIMIT 12
    `;
    const r2 = await pool.query(qData, [EMPRESA]);
    if (r2.rows.length) {
      console.log("--- chat_flow_data (muestras nombre ~ Hector) ---");
      console.log(JSON.stringify(r2.rows, null, 2));
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
