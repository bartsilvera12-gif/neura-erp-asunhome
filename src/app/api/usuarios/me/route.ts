import { NextResponse } from "next/server";
import { getServiceAuthUsuario } from "@/lib/auth/get-service-auth-usuario";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { resolveEffectiveModules } from "@/lib/modulos/resolve-effective-modules";

type UsuarioMeRow = {
  nombre: string | null;
  email: string | null;
  rol: string | null;
};

function pickAuthMetadataName(authUser: { user_metadata?: Record<string, unknown> | null }): string | null {
  const meta = authUser.user_metadata ?? {};
  const candidates = [meta.full_name, meta.name, meta.nombre];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * GET /api/usuarios/me
 *
 * Perfil mínimo para el header: resuelve el usuario autenticado server-side y
 * evita leer `usuarios` desde el navegador.
 */
export async function GET(request: Request) {
  try {
    const r = await getServiceAuthUsuario(request);
    if (!r.ok) {
      return NextResponse.json({ error: "No autenticado" }, { status: r.status });
    }

    const { authUser, catalogUsuario, supabaseSr } = r;
    let row: UsuarioMeRow | null = null;

    if (catalogUsuario?.id) {
      const { data, error } = await supabaseSr
        .from("usuarios")
        .select("nombre, email, rol")
        .eq("id", catalogUsuario.id)
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      row = (data ?? null) as UsuarioMeRow | null;
    }

    const nombre = (row?.nombre ?? pickAuthMetadataName(authUser) ?? "").trim() || null;
    const email = (row?.email ?? authUser.email ?? "").trim() || null;
    const rol = (row?.rol ?? catalogUsuario?.rol ?? "").trim() || null;

    // Slugs de módulos efectivos: lo usa el login para elegir landing
    // (quien no tiene 'dashboard' arranca en Caja/Ventas). Best-effort.
    let modulos: string[] = [];
    if (catalogUsuario?.id && catalogUsuario?.empresa_id) {
      try {
        const catalog = createServiceRoleClient();
        const mods = await resolveEffectiveModules(catalog, {
          id: catalogUsuario.id,
          empresa_id: catalogUsuario.empresa_id,
          rol: catalogUsuario.rol ?? rol,
        });
        modulos = mods.map((m) => (m.slug ?? "").trim().toLowerCase()).filter(Boolean);
      } catch {
        modulos = [];
      }
    }

    return NextResponse.json({ usuario: { nombre, rol, email, modulos } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al obtener el usuario actual";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
