import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { supabaseServiceRoleClientOptions } from "@/lib/supabase/schema";

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email y password son requeridos" },
        { status: 400 }
      );
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    console.log("[create-user] URL:", url);
    console.log("[create-user] KEY length:", key?.length ?? 0);
    console.log("[create-user] KEY starts with:", key?.slice(0, 20));

    if (!url || !key) {
      return NextResponse.json(
        { error: "Variables de entorno no configuradas" },
        { status: 500 }
      );
    }

    const supabase = createClient(url, key, { ...supabaseServiceRoleClientOptions });

    console.log("[create-user] email recibido:", email);

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    console.log("[create-user] Supabase error:", error);
    console.log("[create-user] Supabase data:", data?.user?.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ user: data.user });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    console.error("[create-user] catch:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
