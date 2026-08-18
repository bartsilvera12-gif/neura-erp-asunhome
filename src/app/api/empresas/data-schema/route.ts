import { NextResponse } from "next/server";
import { resolveApiAuthContext } from "@/lib/middleware/api-auth-context";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { SUPABASE_APP_SCHEMA } from "@/lib/supabase/schema";

export const dynamic = "force-dynamic";

/**
 * GET /api/empresas/data-schema
 * Devuelve el schema PostgREST donde viven las tablas de negocio de la empresa autenticada.
 * Auth: anon + JWT (cookies o Authorization Bearer). Lectura empresas.data_schema vía RLS (sin service role).
 */
export async function GET(request: Request) {
  const r = await resolveApiAuthContext(request, { forDataSchemaEndpoint: true });
  if (!r.ok) {
    return NextResponse.json({ error: "No autorizado", code: r.code }, { status: 401 });
  }

  if (r.ctx.empresa_id === null) {
    return NextResponse.json({ schema: SUPABASE_APP_SCHEMA });
  }

  /**
   * Lectura con service role (misma fuente que `createServiceRoleClientForEmpresa`), no con
   * `userScopedSupabase`: en producción RLS sobre `empresas` puede devolver 502 y rompe el
   * cliente browser (`getBrowserSupabaseForEmpresaData`) en toda la app.
   */
  const schema = await fetchDataSchemaForEmpresaId(r.ctx.empresa_id);

  return NextResponse.json({ schema });
}
