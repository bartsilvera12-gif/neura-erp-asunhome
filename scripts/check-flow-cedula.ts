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
    const node = await client.query(
      `select empresa_id, flow_code, node_code, save_as_field, next_node_code
       from public.chat_flow_nodes
       where flow_code = 'sorteo_default' and node_code = 'cedula'
       order by created_at desc
       limit 5`
    );
    const data = await client.query(
      `select conversation_id, flow_code, field_name, field_value, created_at
       from public.chat_flow_data
       where flow_code = 'sorteo_default' and field_name = 'cedula'
       order by created_at desc
       limit 5`
    );
    console.log("NODE_ROWS", JSON.stringify(node.rows));
    console.log("FLOW_DATA_ROWS", JSON.stringify(data.rows));
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
