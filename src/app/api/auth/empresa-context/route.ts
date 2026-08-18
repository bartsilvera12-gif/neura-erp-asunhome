import { NextResponse } from "next/server";
import { resolveApiAuthContext } from "@/lib/middleware/api-auth-context";
import { isAdmin, type UsuarioConEmpresaYRol } from "@/lib/middleware/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/auth/empresa-context
 * Rol y flag admin alineados con las rutas API (resolveApiAuthContext + isAdmin),
 * sin depender del select a `usuarios` desde el cliente browser (RLS / sesión).
 */
export async function GET(request: Request) {
  try {
    const r = await resolveApiAuthContext(request);
    if (!r.ok) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const ctx = r.ctx;
    const auth: UsuarioConEmpresaYRol = {
      user: ctx.user,
      empresa_id: ctx.empresa_id ?? "",
      rol: ctx.usuarioRol ?? undefined,
      nombre: ctx.usuarioNombre ?? undefined,
    };
    return NextResponse.json(
      successResponse({
        es_admin: isAdmin(auth),
        rol: ctx.usuarioRol ?? null,
        empresa_id: ctx.empresa_id ?? null,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
