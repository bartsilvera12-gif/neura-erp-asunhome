import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { createBrowserClient } from "@supabase/ssr";
import {
  resolveEmpresaDataSchema,
  supabaseDbSchemaOption,
  type AppSupabaseClient,
} from "@/lib/supabase/schema";
const SCHEMA_KEY = "neura_erp_data_schema_v1";
const SCHEMA_TS_KEY = "neura_erp_data_schema_ts_v1";
const TTL_MS = 120_000;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-key";

/**
 * Cliente browser para tablas de negocio (respeta `empresas.data_schema` vía API).
 * El catálogo (usuarios, módulos) sigue en `zentra_erp` con el cliente de `@/lib/supabase`.
 */
export async function getBrowserSupabaseForEmpresaData(): Promise<AppSupabaseClient> {
  if (typeof window === "undefined") {
    throw new Error("getBrowserSupabaseForEmpresaData solo está disponible en el cliente");
  }

  const now = Date.now();
  const cachedRaw = sessionStorage.getItem(SCHEMA_KEY);
  const ts = Number(sessionStorage.getItem(SCHEMA_TS_KEY) || "0");
  if (cachedRaw != null && cachedRaw !== "" && now - ts < TTL_MS) {
    const schema = resolveEmpresaDataSchema(cachedRaw);
    if (schema !== cachedRaw) {
      sessionStorage.setItem(SCHEMA_KEY, schema);
    }
    return createBrowserClient(supabaseUrl, supabaseAnonKey, {
      ...supabaseDbSchemaOption,
      db: { schema },
    }) as AppSupabaseClient;
  }

  const res = await fetchWithSupabaseSession("/api/empresas/data-schema", {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = `${res.status}`;
    try {
      const j = JSON.parse(text) as { error?: string; code?: string };
      if (j?.error) detail = `${res.status} ${j.code ?? ""}: ${j.error}`.trim();
    } catch {
      if (text) detail = `${res.status}: ${text.slice(0, 200)}`;
    }
    throw new Error(`No se pudo resolver el schema de datos de la empresa (${detail})`);
  }
  const body = (await res.json()) as { schema?: string };
  const schema = resolveEmpresaDataSchema(body.schema);

  sessionStorage.setItem(SCHEMA_KEY, schema);
  sessionStorage.setItem(SCHEMA_TS_KEY, String(now));

  return createBrowserClient(supabaseUrl, supabaseAnonKey, {
    ...supabaseDbSchemaOption,
    db: { schema },
  }) as AppSupabaseClient;
}

export function clearBrowserEmpresaDataSchemaCache(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SCHEMA_KEY);
  sessionStorage.removeItem(SCHEMA_TS_KEY);
}
