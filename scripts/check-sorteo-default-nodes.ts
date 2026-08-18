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
    const r = await client.query(
      `select empresa_id, node_code, node_type, save_as_field, next_node_code, message_text
       from public.chat_flow_nodes
       where flow_code = 'sorteo_default'
         and node_code in ('cedula','ciudad','comprobante','confirmacion')
       order by empresa_id, node_code`
    );
    console.log(JSON.stringify(r.rows));
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
