import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { resolveEffectiveDashboardViews } from "@/lib/dashboard/resolve-effective-dashboard-views";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return NextResponse.json({ error: "Config no disponible" }, { status: 500 });
    }

    const user = await getAuthUserForApiRoute(request);
    if (!user?.id) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const supabase = createServiceRoleClient();
    const usuario = await resolveUsuarioErpFromAuthUser(supabase, user);
    if (!usuario) {
      return NextResponse.json({ views: [], defaultSlug: null, defaultViewId: null });
    }

    const eff = await resolveEffectiveDashboardViews(supabase, {
      id: usuario.id,
      empresa_id: usuario.empresa_id,
      rol: usuario.rol,
    });

    return NextResponse.json({
      views: eff.views.map((v) => ({
        id: v.id,
        nombre: v.nombre,
        slug: v.slug,
        orden: v.orden,
      })),
      defaultSlug: eff.defaultSlug,
      defaultViewId: eff.defaultViewId,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
