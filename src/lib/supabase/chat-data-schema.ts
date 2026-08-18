import { SUPABASE_APP_SCHEMA } from "@/lib/supabase/schema";

/** Slug + sufijo hex de empresa (p. ej. erp_demo_audit_3b885371). */
const RE_ERP = /^erp_[a-zA-Z0-9_]+$/;
const RE_ER_UUID = /^er_[0-9a-f]{32}$/;

/**
 * Valida nombre de schema Postgres para interpolación segura en SQL (solo datos chat).
 */
export function assertAllowedChatDataSchema(schema: string): string {
  const s = schema.trim();
  if (!s) throw new Error("schema vacío");
  if (s === "public" || s === SUPABASE_APP_SCHEMA) return s;
  if (RE_ERP.test(s) || RE_ER_UUID.test(s)) return s;
  throw new Error(`schema no permitido: ${s}`);
}

/** Esquema tenant donde PostgREST suele fallar si no está en "Exposed schemas". */
export function isLikelyUnexposedTenantChatSchema(schema: string): boolean {
  const s = schema.trim();
  if (!s || s === SUPABASE_APP_SCHEMA || s === "public") return false;
  return RE_ERP.test(s) || RE_ER_UUID.test(s);
}
