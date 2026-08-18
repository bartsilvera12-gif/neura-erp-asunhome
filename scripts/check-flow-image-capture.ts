import { config } from "dotenv";
config({ path: ".env.local" });
import pg from "pg";

const { Client } = pg;
const PROJECT_REF = "ycyibjxplsgguuxbqtps";

function getDbUrl(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (url) return url;
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) throw new Error("Falta SUPABASE_DB_PASSWORD o SUPABASE_DB_URL");
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${PROJECT_REF}.supabase.co:5432/postgres`;
}

async function main() {
  const client = new Client({
    connectionString: getDbUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const data = await client.query(
      `select conversation_id, flow_code, field_name, field_value, created_at
       from public.chat_flow_data
       where field_name = 'comprobante'
       order by created_at desc
       limit 10`
    );
    const events = await client.query(
      `select conversation_id, flow_code, node_code, event_type, payload, created_at
       from public.chat_flow_events
       where event_type = 'image_received'
       order by created_at desc
       limit 10`
    );
    console.log("FLOW_DATA_COMPROBANTE", JSON.stringify(data.rows));
    console.log("FLOW_EVENTS_IMAGE_RECEIVED", JSON.stringify(events.rows));
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
