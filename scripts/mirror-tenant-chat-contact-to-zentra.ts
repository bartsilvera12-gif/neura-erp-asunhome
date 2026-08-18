/**
 * Repara datos: copia `chat_contacts` tenant → `zentra_erp.chat_contacts` (mismo UUID).
 *
 *   npx tsx scripts/mirror-tenant-chat-contact-to-zentra.ts --schema <erp_*> --empresa <uuid> --contact <uuid>
 */
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

async function main() {
  const argv = process.argv;
  function arg(name: string): string | undefined {
    const i = argv.indexOf(name);
    if (i >= 0 && argv[i + 1]) return argv[i + 1].trim();
    return undefined;
  }

  const schema = arg("--schema");
  const empresa = arg("--empresa");
  const contact = arg("--contact");
  if (!schema || !empresa || !contact) {
    console.error(
      "Uso: npx tsx scripts/mirror-tenant-chat-contact-to-zentra.ts --schema <erp_*> --empresa <uuid> --contact <uuid>"
    );
    process.exit(1);
  }

  const { ensureCentralChatContactMirror } = await import(
    "../src/lib/chat/central-chat-contact-mirror"
  );
  const { getChatPostgresPool } = await import("../src/lib/supabase/chat-pg-pool");

  const pool = getChatPostgresPool();
  if (!pool) {
    console.error("No hay pool Postgres: definí SUPABASE_DB_URL / DIRECT_URL / DATABASE_URL en .env.local");
    process.exit(1);
  }

  await ensureCentralChatContactMirror({
    pool,
    tenantDataSchema: schema,
    empresaId: empresa,
    contactId: contact,
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
