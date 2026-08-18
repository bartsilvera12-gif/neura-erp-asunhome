/**
 * Helpers compartidos para los importadores Excel.
 * - leerArchivoYAuth: extrae file + auth + schema + checkbox crear_faltantes.
 * - lookupLowerMap: construye un Map(lower(trim(nombre)) -> id) para resolucion por nombre.
 * - chunked: parte un array en chunks de N.
 */
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getAuthWithRol, isAdmin } from "@/lib/middleware/auth";
import { parseUploadFile } from "@/lib/excel/import";

export interface AuthCtx {
  empresaId: string;
  schema: string;
  usuarioCatalogId: string | null;
  usuarioNombre: string | null;
  filename: string;
  rows: Record<string, string>[];
  crearFaltantes: boolean;
}

/** Lee form-data, valida auth + admin, parsea xlsx/csv. */
export async function leerArchivoYAuth(request: Request): Promise<
  | { ok: true; ctx: AuthCtx }
  | { ok: false; status: number; error: string }
> {
  const auth = await getAuthWithRol(request);
  if (!auth) return { ok: false, status: 401, error: "No autenticado." };
  if (!isAdmin(auth)) return { ok: false, status: 403, error: "Solo administradores pueden importar." };

  const tenant = await getTenantSupabaseFromAuth(request);
  if (!tenant) return { ok: false, status: 401, error: "No autenticado." };
  const empresaId = tenant.auth.empresa_id;
  const schema = await fetchDataSchemaForEmpresaId(empresaId);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, status: 400, error: "Form-data inválido." };
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return { ok: false, status: 400, error: "Falta el archivo." };
  }
  const parsed = await parseUploadFile(file);
  if ("error" in parsed) return { ok: false, status: 400, error: parsed.error };

  const crearFaltantes = String(form.get("crear_faltantes") ?? "") === "1";

  return {
    ok: true,
    ctx: {
      empresaId,
      schema,
      usuarioCatalogId: tenant.auth.usuarioCatalogId ?? null,
      usuarioNombre: tenant.auth.user?.email ?? null,
      filename: file.name,
      rows: parsed.rows,
      crearFaltantes,
    },
  };
}

export function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function pick(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

export function pickNumber(row: Record<string, string>, ...keys: string[]): number {
  const raw = pick(row, ...keys);
  if (!raw) return 0;
  const n = Number(String(raw).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function pickBool(row: Record<string, string>, ...keys: string[]): boolean {
  const raw = pick(row, ...keys).toLowerCase();
  if (!raw) return true; // default activo=true
  return ["si", "sí", "true", "1", "yes", "y", "activo"].includes(raw);
}
