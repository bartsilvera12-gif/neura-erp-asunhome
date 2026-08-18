import { supabaseServiceRoleClientOptions } from "@/lib/supabase/schema";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getServiceAuthUsuario } from "@/lib/auth/get-service-auth-usuario";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getAuthUserId(supabase: any, usuario: { auth_user_id?: string | null; email?: string }) {
  if (usuario.auth_user_id) return usuario.auth_user_id;
  const emailBuscado = (usuario.email ?? "").trim().toLowerCase();
  if (!emailBuscado) return null;
  let page = 1;
  while (true) {
    const { data } = await supabase.auth.admin.listUsers({ page, perPage: 500 });
    const users = data?.users ?? [];
    const found = users.find((u: { id: string; email?: string }) => (u.email ?? "").toLowerCase() === emailBuscado);
    if (found) return found.id;
    if (users.length < 500) break;
    page++;
  }
  return null;
}

/**
 * Restablece contraseña (Supabase Auth) desde administración de empresa / super_admin.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return NextResponse.json({ error: "Config no disponible" }, { status: 500 });
    }

    const authR = await getServiceAuthUsuario(req);
    if (!authR.ok) {
      return NextResponse.json({ error: "No autenticado" }, { status: authR.status });
    }
    if (!authR.catalogUsuario) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    const rolEditor = (authR.catalogUsuario.rol ?? "").trim();
    const puede =
      rolEditor === "super_admin" || ["admin", "administrador"].includes(rolEditor);
    if (!puede) {
      return NextResponse.json({ error: "Sin permiso para restablecer contraseñas" }, { status: 403 });
    }

    const body = await req.json();
    const password = String(body.password ?? "");

    if (!password || password.length < 6) {
      return NextResponse.json({ error: "La contraseña debe tener al menos 6 caracteres." }, { status: 400 });
    }

    const supabase = createClient(url, serviceKey, { ...supabaseServiceRoleClientOptions });
    const empresaEditor = authR.catalogUsuario.empresa_id ?? undefined;

    const { data: usuario, error: errGet } = await supabase
      .from("usuarios")
      .select("id, email, auth_user_id, empresa_id")
      .eq("id", id)
      .single();

    if (errGet || !usuario) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    if (rolEditor !== "super_admin" && usuario.empresa_id !== empresaEditor) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }

    const authUserId = await getAuthUserId(supabase, usuario);
    if (!authUserId) {
      return NextResponse.json(
        { error: "No se encontró el usuario en Auth para actualizar la contraseña." },
        { status: 400 }
      );
    }

    const { error: errUp } = await supabase.auth.admin.updateUserById(authUserId, { password });
    if (errUp) {
      return NextResponse.json({ error: errUp.message }, { status: 400 });
    }

    if (!usuario.auth_user_id) {
      await supabase.from("usuarios").update({ auth_user_id: authUserId }).eq("id", id);
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
