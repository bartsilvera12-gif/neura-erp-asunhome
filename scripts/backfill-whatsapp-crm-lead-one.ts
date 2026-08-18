/**
 * Crea (o enlaza) un prospecto CRM para un contacto de chat que aún no tiene `crm_prospecto_id`,
 * usando la misma lógica que el webhook (`ensureWhatsappInboundCrmLeadPg`).
 *
 * Requiere en .env.local: SUPABASE_DB_URL (o DIRECT_URL / DATABASE_URL).
 *
 * Uso:
 *   npx tsx scripts/backfill-whatsapp-crm-lead-one.ts --empresa-id=<uuid> --contact-id=<uuid>
 *   npx tsx scripts/backfill-whatsapp-crm-lead-one.ts --empresa-id=<uuid> --phone=595971321999
 *
 * Opcional: --preview="Texto" (si no, toma el último mensaje entrante de la conversación).
 */
import { config } from "dotenv";
import path from "node:path";
import pg from "pg";
import { quoteSchemaTable } from "../src/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "../src/lib/supabase/chat-data-schema";
import { resolveEmpresaDataSchema } from "../src/lib/supabase/schema";

config({ path: path.resolve(process.cwd(), ".env.local") });

function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

async function main() {
  const args = parseArgs();
  const empresaId = args["empresa-id"]?.trim();
  const contactIdArg = args["contact-id"]?.trim();
  const phoneArg = args["phone"]?.trim();
  if (!empresaId || (!contactIdArg && !phoneArg)) {
    console.error(
      "Uso:\n" +
        "  npx tsx scripts/backfill-whatsapp-crm-lead-one.ts --empresa-id=<uuid> --contact-id=<uuid>\n" +
        "  npx tsx scripts/backfill-whatsapp-crm-lead-one.ts --empresa-id=<uuid> --phone=595971321999\n" +
        "Opcional: --preview=\"...\""
    );
    process.exit(1);
  }

  const url =
    process.env.SUPABASE_DB_URL?.trim() ||
    process.env.DIRECT_URL?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("Falta SUPABASE_DB_URL (o DIRECT_URL / DATABASE_URL) en el entorno");
  }

  const pool = new pg.Pool({
    connectionString: url,
    max: 2,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 15_000,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });

  const client = await pool.connect();
  let schema: string;
  let resolvedContactId: string;
  let conversationId: string;
  let channelId: string;
  let preview: string | null = args["preview"]?.trim() ? args["preview"].trim().slice(0, 500) : null;

  try {
    const er = await client.query<{ data_schema: string | null }>(
      `SELECT data_schema FROM zentra_erp.empresas WHERE id = $1::uuid LIMIT 1`,
      [empresaId]
    );
    if (!er.rows[0]) {
      throw new Error("Empresa no encontrada en zentra_erp.empresas");
    }
    schema = assertAllowedChatDataSchema(resolveEmpresaDataSchema(er.rows[0].data_schema));

    const ct = quoteSchemaTable(schema, "chat_contacts");
    const cv = quoteSchemaTable(schema, "chat_conversations");
    const cm = quoteSchemaTable(schema, "chat_messages");

    if (contactIdArg) {
      resolvedContactId = contactIdArg;
    } else {
      const norm = digitsOnly(phoneArg!);
      if (!norm) {
        throw new Error("--phone sin dígitos");
      }
      const cr = await client.query<{ id: string }>(
        `SELECT id::text FROM ${ct}
         WHERE empresa_id = $1::uuid
           AND regexp_replace(coalesce(phone_normalized, phone_number, ''), '[^0-9]', '', 'g') = $2
         LIMIT 5`,
        [empresaId, norm]
      );
      if (cr.rows.length === 0) {
        throw new Error("Sin contacto para ese teléfono en esa empresa");
      }
      if (cr.rows.length > 1) {
        throw new Error(
          `Varios contactos (${cr.rows.length}); pasá --contact-id. ids: ${cr.rows.map((r) => r.id).join(", ")}`
        );
      }
      resolvedContactId = cr.rows[0].id;
    }

    const convr = await client.query<{ id: string; channel_id: string }>(
      `SELECT id::text, channel_id::text FROM ${cv}
       WHERE contact_id = $1::uuid AND empresa_id = $2::uuid
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,
      [resolvedContactId, empresaId]
    );
    if (!convr.rows[0]) {
      throw new Error("Sin conversación para ese contacto");
    }
    conversationId = convr.rows[0].id;
    channelId = convr.rows[0].channel_id;

    if (!preview) {
      const pr = await client.query<{ content: string | null }>(
        `SELECT left(coalesce(content, ''), 500)::text AS content FROM ${cm}
         WHERE conversation_id = $1::uuid AND empresa_id = $2::uuid AND coalesce(from_me, false) = false
         ORDER BY created_at DESC NULLS LAST
         LIMIT 1`,
        [conversationId, empresaId]
      );
      preview = pr.rows[0]?.content ?? null;
    }
  } finally {
    client.release();
  }

  const { ensureWhatsappInboundCrmLeadPg } = await import("../src/lib/crm/whatsapp-inbound-lead-pg");
  const res = await ensureWhatsappInboundCrmLeadPg({
    pool,
    data_schema: schema,
    empresa_id: empresaId,
    contact_id: resolvedContactId,
    conversation_id: conversationId,
    channel_id: channelId,
    first_message_preview: preview,
  });

  if (res.ok) {
    console.log("OK: lead asegurado (nuevo o ya existía vinculado).", {
      empresa_id: empresaId,
      contact_id: resolvedContactId,
      conversation_id: conversationId,
      channel_id: channelId,
      schema,
    });
  } else {
    console.error("Falló:", res.error);
    process.exit(1);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
