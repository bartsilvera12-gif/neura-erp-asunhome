/**
 * Datos del emisor para los documentos impresos (comprobantes, devoluciones).
 *
 * Antes estaban hardcodeados en cada plantilla, lo que hacía que una instancia
 * imprimiera la razón social y el RUC de otra empresa. Se leen de la config
 * SIFEN y, si todavía no está cargada, de la ficha de la empresa.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

export interface EmisorDatos {
  razonSocial: string;
  ruc: string;
}

export async function getEmisorDatos(schemaRaw: string, empresaId: string): Promise<EmisorDatos> {
  const vacio: EmisorDatos = { razonSocial: "", ruc: "" };
  const pool = getChatPostgresPool();
  if (!pool) return vacio;

  let schema: string;
  try {
    schema = assertAllowedChatDataSchema(schemaRaw);
  } catch {
    return vacio;
  }

  let razonSocial = "";
  let ruc = "";

  try {
    const t = quoteSchemaTable(schema, "empresa_sifen_config");
    const { rows } = await pool.query<{ razon_social: string | null; ruc: string | null }>(
      `SELECT razon_social, ruc FROM ${t} WHERE empresa_id = $1::uuid LIMIT 1`,
      [empresaId]
    );
    razonSocial = (rows[0]?.razon_social ?? "").trim();
    ruc = (rows[0]?.ruc ?? "").trim();
  } catch {
    /* sin config SIFEN todavía */
  }

  if (!razonSocial || !ruc) {
    try {
      const t = quoteSchemaTable(schema, "empresas");
      const { rows } = await pool.query<{ nombre_empresa: string | null; ruc: string | null }>(
        `SELECT nombre_empresa, ruc FROM ${t} WHERE id = $1::uuid LIMIT 1`,
        [empresaId]
      );
      if (!razonSocial) razonSocial = (rows[0]?.nombre_empresa ?? "").trim();
      if (!ruc) ruc = (rows[0]?.ruc ?? "").trim();
    } catch {
      /* se imprime sin encabezado de emisor */
    }
  }

  return { razonSocial, ruc };
}
