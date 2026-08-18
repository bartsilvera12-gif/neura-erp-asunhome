import { createClient } from "@supabase/supabase-js";
import { supabaseServiceRoleClientOptions } from "@/lib/supabase/schema";
import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import { ensureNotasCreditoModuloInCatalog } from "@/lib/modulos/ensure-notas-credito-modulo-catalog";
import { ensureOmnicanalModulosInCatalog } from "@/lib/modulos/ensure-omnicanal-modulos-catalog";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !key) {
      return NextResponse.json({ error: "Config no disponible" }, { status: 500 });
    }

    const user = await getAuthUserForApiRoute(request);
    if (!user?.id) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const supabaseSr = createClient(url, key, { ...supabaseServiceRoleClientOptions });
    const usuario = await resolveUsuarioErpFromAuthUser(supabaseSr, user);
    const rolSuper = (usuario?.rol ?? "").trim() === "super_admin";
    const bootstrapSuper = isBootstrapSuperAdminEmail(user.email);
    if (!rolSuper && !bootstrapSuper) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const ensured = await ensureNotasCreditoModuloInCatalog(supabaseSr);
    if (!ensured.ok) {
      return NextResponse.json({ error: ensured.message }, { status: 500 });
    }

    const ensuredOmni = await ensureOmnicanalModulosInCatalog(supabaseSr);
    if (!ensuredOmni.ok) {
      return NextResponse.json({ error: ensuredOmni.message }, { status: 500 });
    }

    const { data, error } = await supabaseSr
      .from("modulos")
      .select("*")
      .order("nombre", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
