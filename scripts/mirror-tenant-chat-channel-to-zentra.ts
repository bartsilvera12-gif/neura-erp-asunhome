/**
 * Repara datos: copia una fila `chat_channels` del schema tenant a `zentra_erp.chat_channels`
 * (mismo UUID). Uso operativo one-off / soporte.
 *
 *   npx tsx scripts/mirror-tenant-chat-channel-to-zentra.ts --schema <erp_*> --empresa <uuid> --channel <uuid>
 *
 * Requiere `.env.local` con SUPABASE_DB_URL (o DIRECT_URL / DATABASE_URL) para el pool Postgres.
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
  const channel = arg("--channel");
  if (!schema || !empresa || !channel) {
    console.error(
      "Uso: npx tsx scripts/mirror-tenant-chat-channel-to-zentra.ts --schema <erp_*> --empresa <uuid> --channel <uuid>"
    );
    process.exit(1);
  }

  const { ensureCentralChatChannelMirror } = await import(
    "../src/lib/chat/central-chat-channel-mirror"
  );
  const { getChatPostgresPool } = await import("../src/lib/supabase/chat-pg-pool");

  const pool = getChatPostgresPool();
  if (!pool) {
    console.error("No hay pool Postgres: definí SUPABASE_DB_URL / DIRECT_URL / DATABASE_URL en .env.local");
    process.exit(1);
  }

  await ensureCentralChatChannelMirror({
    pool,
    tenantDataSchema: schema,
    empresaId: empresa,
    channelId: channel,
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
