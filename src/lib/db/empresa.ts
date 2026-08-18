import { getCurrentUser } from "@/lib/auth";
import { getBrowserSupabaseForEmpresaData } from "@/lib/supabase/browser-data-client";

/**
 * Obtiene empresa_id del usuario actual.
 * @throws Error si el usuario no está autenticado o no tiene empresa asignada
 */
export async function getEmpresaId(): Promise<string> {
  const usuario = await getCurrentUser();
  const id = usuario?.empresa_id?.trim();
  if (!usuario || !id) {
    throw new Error("Usuario no autenticado o sin empresa");
  }
  return id;
}

/**
 * Devuelve un query builder de Supabase filtrado por empresa_id del usuario actual.
 * Útil para estandarizar consultas multiempresa en el ERP.
 *
 * @example
 * const { data } = await (await queryEmpresa("productos")).select("*");
 * const { data } = await (await queryEmpresa("clientes")).select("*").order("nombre");
 */
export async function queryEmpresa(tabla: string) {
  const [sb, empresaId] = await Promise.all([
    getBrowserSupabaseForEmpresaData(),
    getEmpresaId(),
  ]);
  // Tabla dinámica: Supabase tipa por nombre literal; con string el builder no expone .eq() en tipos
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (sb.from(tabla as any) as any).eq("empresa_id", empresaId);
}
