import { config } from "dotenv";
import { join } from "path";
import { Client } from "pg";
import {
  collectMetaWebhookStatusValues,
  shouldApplyWhatsappStatus,
  type MetaWhatsappStatusName,
} from "../src/lib/chat/meta-whatsapp-status";

config({ path: join(process.cwd(), ".env.local"), quiet: true });

const DEFAULT_SCHEMA = "erp_triple_7_82f8a15a";
const DEFAULT_EMPRESA_ID = "82f8a15a-5dd6-48d9-99b3-97210b5130bd";
const DEFAULT_CONVERSATION_ID = "8763df1c-acde-4ca9-af8e-c75246f771a5";
const DEFAULT_PHONE_NUMBER_ID = "1148622968334898";
const DEFAULT_WAMID =
  "wamid.HBgMNTk1OTgzMTExMDAwFQIAERgSNzQ5RUU3RTlDRjYxNkQzM0Y5AA==";

function arg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length).trim();
  return value || fallback;
}

function payload(status: MetaWhatsappStatusName, wamid: string, phoneNumberId: string): unknown {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "mock-waba",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "595985959777",
                phone_number_id: phoneNumberId,
              },
              statuses: [
                {
                  id: wamid,
                  status,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: "595983111000",
                  conversation: { id: "mock-conversation", origin: { type: "user_initiated" } },
                  pricing: { billable: true, pricing_model: "CBP", category: "service" },
                  ...(status === "failed"
                    ? {
                        errors: [
                          {
                            code: 131000,
                            title: "Mock Meta failure",
                            message: "Mock failure for dry-run validation",
                          },
                        ],
                      }
                    : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

async function main(): Promise<void> {
  const schema = arg("schema", DEFAULT_SCHEMA);
  const empresaId = arg("empresa", DEFAULT_EMPRESA_ID);
  const conversationId = arg("conversation", DEFAULT_CONVERSATION_ID);
  const phoneNumberId = arg("phone-number-id", DEFAULT_PHONE_NUMBER_ID);
  const wamid = arg("wamid", DEFAULT_WAMID);

  console.log("[qa-whatsapp-status] dry-run: no modifica DB ni llama a Meta");
  console.log({ schema, empresaId, conversationId, phoneNumberId, wamid });

  const parsed = collectMetaWebhookStatusValues(payload("sent", wamid, phoneNumberId));
  const parsedDirect = collectMetaWebhookStatusValues({
    field: "statuses",
    value: {
      messaging_product: "whatsapp",
      metadata: { phone_number_id: phoneNumberId },
      statuses: [
        {
          id: `${wamid}.mock_failed`,
          status: "failed",
          timestamp: String(Math.floor(Date.now() / 1000)),
          recipient_id: "595983111000",
          errors: [{ code: 131000, message: "Mock failure for dry-run validation" }],
        },
      ],
    },
  });
  console.log("parser entry[].changes[].field=messages statuses:", parsed.length, parsed[0]?.statuses?.length ?? 0);
  console.log("parser field=statuses directo:", parsedDirect.length);

  const transitions: Array<{ current: string | null; next: MetaWhatsappStatusName; apply: boolean }> = [];
  let current: string | null = null;
  for (const next of ["sent", "delivered", "read", "sent", "failed"] as MetaWhatsappStatusName[]) {
    const apply = shouldApplyWhatsappStatus(current, next);
    transitions.push({ current, next, apply });
    if (apply) current = next;
  }
  console.table(transitions);

  const cs = process.env.SUPABASE_DB_URL?.trim();
  if (!cs) {
    console.log("SUPABASE_DB_URL no configurado; se omitió verificación DB dry-run.");
    return;
  }

  const client = new Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const cols = await client.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'chat_messages'
       ORDER BY ordinal_position`,
      [schema]
    );
    const relevant = cols.rows
      .map((r: { column_name: string }) => r.column_name)
      .filter((c: string) =>
        [
          "wa_message_id",
          "provider_message_id",
          "whatsapp_delivery_status",
          "whatsapp_sent_at",
          "whatsapp_delivered_at",
          "whatsapp_read_at",
          "whatsapp_failed_at",
          "error_code",
          "error_message",
          "raw_payload",
        ].includes(c)
      );
    console.log("columnas relevantes:", relevant.join(", "));

    const msg = await client.query(
      `SELECT id::text, whatsapp_delivery_status, whatsapp_delivered_at, whatsapp_read_at
       FROM "${schema}".chat_messages
       WHERE empresa_id = $1::uuid
         AND conversation_id = $2::uuid
         AND wa_message_id = $3
       LIMIT 1`,
      [empresaId, conversationId, wamid]
    );
    console.table(msg.rows);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
