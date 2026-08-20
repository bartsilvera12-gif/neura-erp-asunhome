/**
 * Datos del emisor para documentos y para el XML de SIFEN.
 *
 * Fuente única. Antes estaban hardcodeados en cada plantilla y en las rutas de
 * SIFEN, lo que hacía que una instancia imprimiera —y declarara— la razón
 * social, el RUC, el teléfono y el email de otra empresa.
 *
 * Orden de resolución:
 *   razón social / RUC → empresa_sifen_config, si no → empresas
 *   teléfono / email / dirección → empresas
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

export interface EmisorDatos {
  razonSocial: string;
  ruc: string;
  telefono: string;
  email: string;
  direccion: string;
}

const VACIO: EmisorDatos = { razonSocial: "", ruc: "", telefono: "", email: "", direccion: "" };

export async function getEmisorDatos(schemaRaw: string, empresaId: string): Promise<EmisorDatos> {
  const pool = getChatPostgresPool();
  if (!pool) return VACIO;

  let schema: string;
  try {
    schema = assertAllowedChatDataSchema(schemaRaw);
  } catch {
    return VACIO;
  }

  const out: EmisorDatos = { ...VACIO };

  try {
    const t = quoteSchemaTable(schema, "empresa_sifen_config");
    const { rows } = await pool.query<{ razon_social: string | null; ruc: string | null }>(
      `SELECT razon_social, ruc FROM ${t} WHERE empresa_id = $1::uuid LIMIT 1`,
      [empresaId]
    );
    out.razonSocial = (rows[0]?.razon_social ?? "").trim();
    out.ruc = (rows[0]?.ruc ?? "").trim();
  } catch {
    /* sin config SIFEN todavía */
  }

  try {
    const t = quoteSchemaTable(schema, "empresas");
    const { rows } = await pool.query<{
      nombre_empresa: string | null;
      ruc: string | null;
      telefono: string | null;
      email: string | null;
      direccion: string | null;
    }>(
      `SELECT nombre_empresa, ruc, telefono, email, direccion
         FROM ${t} WHERE id = $1::uuid LIMIT 1`,
      [empresaId]
    );
    const e = rows[0];
    if (!out.razonSocial) out.razonSocial = (e?.nombre_empresa ?? "").trim();
    if (!out.ruc) out.ruc = (e?.ruc ?? "").trim();
    out.telefono = (e?.telefono ?? "").trim();
    out.email = (e?.email ?? "").trim();
    out.direccion = (e?.direccion ?? "").trim();
  } catch {
    /* se imprime con lo que haya */
  }

  return out;
}
