/**
 * Diagnóstico lectura de falsos positivos en validación de comprobantes (sorteos / WhatsApp).
 *
 * Solo lectura (SELECT). Sin DELETE/UPDATE.
 *
 * Variables:
 *   SUPABASE_DB_URL | DIRECT_URL | DATABASE_URL
 *   CHAT_DIAGNOSE_SCHEMA (ej. erp_el_papu_store_5ad0bdda)
 *   CHAT_DIAGNOSE_EMPRESA_ID (uuid empresa)
 *   CHAT_DIAGNOSE_PHONE (ej. 595981462835 — solo dígitos significativos)
 *   CHAT_DIAGNOSE_DATE_FROM / CHAT_DIAGNOSE_DATE_TO (ISO, zona incluida en string)
 *
 * Ejemplo:
 *   CHAT_DIAGNOSE_SCHEMA=erp_el_papu_store_5ad0bdda `
 *   CHAT_DIAGNOSE_EMPRESA_ID=5ad0bdda-f94f-446c-9032-1fedf34e8479 `
 *   CHAT_DIAGNOSE_PHONE=595981462835 `
 *   CHAT_DIAGNOSE_DATE_FROM=2026-05-03T08:30:00-04:00 `
 *   CHAT_DIAGNOSE_DATE_TO=2026-05-03T10:30:00-04:00 `
 *   npx tsx scripts/diagnose-sorteo-comprobante-duplicate.ts
 */
import { config } from "dotenv";
import path from "node:path";
import pg from "pg";

config({ path: path.resolve(process.cwd(), ".env.local") });

const url =
  process.env.SUPABASE_DB_URL?.trim() ||
  process.env.DIRECT_URL?.trim() ||
  process.env.DATABASE_URL?.trim();
const schema = process.env.CHAT_DIAGNOSE_SCHEMA?.trim();
const empresaId = process.env.CHAT_DIAGNOSE_EMPRESA_ID?.trim();
const phoneRaw = process.env.CHAT_DIAGNOSE_PHONE?.trim();
const dateFrom = process.env.CHAT_DIAGNOSE_DATE_FROM?.trim();
const dateTo = process.env.CHAT_DIAGNOSE_DATE_TO?.trim();

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function tailDigitsHint(phone: string): string {
  const d = digitsOnly(phone);
  return d.length >= 9 ? d.slice(-9) : d;
}

async function main() {
  if (!url) {
    console.error("Falta SUPABASE_DB_URL, DIRECT_URL o DATABASE_URL");
    process.exit(1);
  }
  if (!schema) {
    console.error("Falta CHAT_DIAGNOSE_SCHEMA");
    process.exit(1);
  }
  if (!empresaId) {
    console.error("Falta CHAT_DIAGNOSE_EMPRESA_ID");
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  try {
    console.log("[diagnose][meta]", { schema, empresa_id: empresaId, phone: phoneRaw ?? null, dateFrom, dateTo });

    const qt = (name: string) => `"${schema.replace(/"/g, "")}".${name}`;

    let contactRows: Record<string, unknown>[] = [];
    if (phoneRaw) {
      const hint = tailDigitsHint(phoneRaw);
      const cr = await client.query(
        `
        SELECT id::text, name::text, phone_number::text, crm_prospecto_id::text
        FROM ${qt("chat_contacts")}
        WHERE empresa_id = $1::uuid
          AND regexp_replace(coalesce(phone_number,''), '\\D', '', 'g') LIKE '%' || $2 || '%'
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 20
        `,
        [empresaId, hint]
      );
      contactRows = (cr.rows ?? []) as Record<string, unknown>[];
    }

    console.log("[diagnose][contacts_found]", { count: contactRows.length, sample: contactRows.slice(0, 5) });

    const contactIds = contactRows.map((r) => String(r.id ?? "").trim()).filter(Boolean);

    if (contactIds.length === 0 && phoneRaw) {
      console.warn("[diagnose] No se encontraron contactos por teléfono; revisá formato guardado en chat_contacts.phone_number.");
    }

    if (contactIds.length > 0) {
      const convQ = await client.query(
        `
        SELECT id::text, status::text, channel_id::text, contact_id::text, last_message_at
        FROM ${qt("chat_conversations")}
        WHERE empresa_id = $1::uuid AND contact_id = ANY($2::uuid[])
        ORDER BY last_message_at DESC NULLS LAST
        LIMIT 50
        `,
        [empresaId, contactIds]
      );
      console.log("[diagnose][conversations]", convQ.rows ?? []);

      const convIds = (convQ.rows ?? []).map((r: { id?: string }) => String(r.id ?? "").trim()).filter(Boolean);

      if (convIds.length > 0 && dateFrom && dateTo) {
        const mq = await client.query(
          `
          SELECT id::text, conversation_id::text, message_type::text, created_at,
                 substring(coalesce(content,''), 1, 80) AS content_preview,
                 length(coalesce(raw_payload::text,'')) AS raw_payload_len
          FROM ${qt("chat_messages")}
          WHERE empresa_id = $1::uuid
            AND conversation_id = ANY($2::uuid[])
            AND created_at >= $3::timestamptz
            AND created_at <= $4::timestamptz
          ORDER BY created_at ASC
          `,
          [empresaId, convIds, dateFrom, dateTo]
        );
        console.log("[diagnose][messages_window]", mq.rows ?? []);
      }

      const valQ = await client.query(
        `
        SELECT id::text, conversation_id::text, flow_session_id::text, flow_code::text,
               estado_validacion::text, motivo_validacion::text,
               substring(comprobante_hash, 1, 16) AS hash_prefix,
               substring(coalesce(comprobante_media_id,''), 1, 24) AS media_id_prefix,
               substring(coalesce(ocr_referencia,''), 1, 24) AS ocr_ref_prefix,
               substring(coalesce(ocr_fingerprint,''), 1, 16) AS fp_prefix,
               length(coalesce(ocr_text_raw,'')) AS ocr_text_len,
               created_at
        FROM ${qt("chat_comprobante_validaciones")}
        WHERE empresa_id = $1::uuid AND conversation_id = ANY($2::uuid[])
        ORDER BY created_at DESC
        LIMIT 40
        `,
        [empresaId, convIds]
      );
      console.log("[diagnose][comprobante_validaciones]", valQ.rows ?? []);

      const dupDay =
        dateFrom && dateTo
          ? await client.query(
              `
              SELECT comprobante_hash, COUNT(*)::int AS n,
                     COUNT(DISTINCT conversation_id)::int AS distinct_conversations,
                     COUNT(DISTINCT NULLIF(trim(comprobante_media_id),''))::int AS distinct_media_ids
              FROM ${qt("chat_comprobante_validaciones")}
              WHERE empresa_id = $1::uuid
                AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz
              GROUP BY comprobante_hash
              HAVING COUNT(*) > 1
              ORDER BY n DESC
              LIMIT 20
              `,
              [empresaId, dateFrom, dateTo]
            )
          : { rows: [] };
      console.log("[diagnose][hash_repeated_in_window]", dupDay.rows ?? []);

      const fpDay =
        dateFrom && dateTo
          ? await client.query(
              `
              SELECT ocr_fingerprint, COUNT(*)::int AS n
              FROM ${qt("chat_comprobante_validaciones")}
              WHERE empresa_id = $1::uuid
                AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz
                AND ocr_fingerprint IS NOT NULL AND length(trim(ocr_fingerprint)) > 0
              GROUP BY ocr_fingerprint
              HAVING COUNT(*) > 1
              ORDER BY n DESC
              LIMIT 20
              `,
              [empresaId, dateFrom, dateTo]
            )
          : { rows: [] };
      console.log("[diagnose][ocr_fingerprint_repeated_in_window]", fpDay.rows ?? []);

      const estadoHist = await client.query(
        `
        SELECT estado_validacion::text, COUNT(*)::int AS n
        FROM ${qt("chat_comprobante_validaciones")}
        WHERE empresa_id = $1::uuid
        GROUP BY estado_validacion
        ORDER BY n DESC
        `,
        [empresaId]
      );
      console.log("[diagnose][estado_histogram]", estadoHist.rows ?? []);
    }

    console.log("[diagnose][nota]", {
      causa_tipica_falso_positivo:
        "Referencia OCR corta o genérica comparada entre sesiones, o huella de texto completo con plantilla de banco repetida (mitigado en código subiendo umbral de caracteres y separando bloqueo fuerte vs revisión débil).",
      schema_scope:
        "Este script solo consulta el schema indicado; si PostgREST apuntara a otro schema, contrastar con APP.",
    });
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
