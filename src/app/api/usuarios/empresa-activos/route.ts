import { NextResponse } from "next/server";
import { getServiceAuthUsuario } from "@/lib/auth/get-service-auth-usuario";

type UsuarioActivoRow = {
  id: string;
  nombre: string | null;
  email: string | null;
  rol?: string | null;
  estado: string | null;
};

/**
 * GET /api/usuarios/empresa-activos
 *
 * Catálogo acotado para selects: resuelve la empresa desde la sesión y lee
 * `usuarios` server-side con service role, sin exponer RLS ni datos de otras empresas.
 */
export async function GET(request: Request) {
  try {
    const r = await getServiceAuthUsuario(request);
    if (!r.ok) {
      return NextResponse.json({ error: "No autenticado" }, { status: r.status });
    }

    const { catalogUsuario, supabaseSr } = r;
    const empresaId = catalogUsuario?.empresa_id ?? null;
    if (!empresaId) {
      return NextResponse.json({ error: "Perfil de empresa no encontrado" }, { status: 403 });
    }

    const { data, error } = await supabaseSr
      .from("usuarios")
      .select("id, nombre, email, rol, estado")
      .eq("empresa_id", empresaId)
      .eq("estado", "activo")
      .order("nombre", { ascending: true })
      .order("email", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const usuarios = ((data ?? []) as UsuarioActivoRow[]).map((u) => ({
      id: u.id,
      nombre: u.nombre,
      email: u.email ?? "",
      rol: u.rol ?? null,
      estado: u.estado,
    }));

    return NextResponse.json({ usuarios });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al listar usuarios activos";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
