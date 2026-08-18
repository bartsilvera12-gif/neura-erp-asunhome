import { NextResponse } from "next/server";
import { getServiceAuthUsuario } from "@/lib/auth/get-service-auth-usuario";

/** Lista usuarios de la empresa del usuario autenticado (para /usuarios) */
export async function GET(request: Request) {
  try {
    const r = await getServiceAuthUsuario(request);
    if (!r.ok) {
      return NextResponse.json({ error: "No autenticado" }, { status: r.status });
    }
    const { supabaseSr, catalogUsuario } = r;
    if (!catalogUsuario) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    const empresaId = catalogUsuario.empresa_id ?? null;
    const rol = (catalogUsuario.rol ?? "").trim();
    if (!empresaId && rol !== "super_admin") {
      return NextResponse.json({ usuarios: [] });
    }

    let query = supabaseSr
      .from("usuarios")
      .select("id, nombre, email, telefono, fecha_nacimiento, rol, estado, created_at")
      .order("created_at", { ascending: false });

    if (rol !== "super_admin") {
      query = query.eq("empresa_id", empresaId as string);
    }

    const { data: usuarios, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ usuarios: usuarios ?? [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
