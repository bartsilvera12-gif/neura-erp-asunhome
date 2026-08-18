import { createClient } from "@supabase/supabase-js";
import { supabaseServiceRoleClientOptions } from "@/lib/supabase/schema";
import { NextResponse } from "next/server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { password } = body;

    if (!password || typeof password !== "string" || password.length < 6) {
      return NextResponse.json(
        { error: "La contraseña debe tener al menos 6 caracteres" },
        { status: 400 }
      );
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json({ error: "Config no disponible" }, { status: 500 });
    }

    const supabase = createClient(url, key, { ...supabaseServiceRoleClientOptions });

    const { data: usuario, error: errGet } = await supabase
      .from("usuarios")
      .select("email")
      .eq("id", id)
      .single();

    if (errGet || !usuario) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const authUser = authUsers?.users?.find((u) => u.email === usuario.email);

    if (!authUser) {
      return NextResponse.json(
        { error: "No se encontró el usuario en Auth. Verifique que el email coincida." },
        { status: 404 }
      );
    }

    const { error: errAuth } = await supabase.auth.admin.updateUserById(authUser.id, {
      password,
    });

    if (errAuth) {
      return NextResponse.json({ error: errAuth.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
