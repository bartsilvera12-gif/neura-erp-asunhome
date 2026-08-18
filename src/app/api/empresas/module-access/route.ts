import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import { NextResponse } from "next/server";
import { resolveEffectiveModules } from "@/lib/modulos/resolve-effective-modules";

/**
 * Slugs de módulos efectivos para el usuario autenticado (intersección empresa ∩ usuario).
 * super_admin → todos los slugs del catálogo.
 */
export async function GET(request: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !anonKey || !serviceKey) {
      return NextResponse.json({ error: "Config no disponible" }, { status: 500 });
    }

    const user = await getAuthUserForApiRoute(request);
    if (!user?.id) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    /**
     * En instancia dedicada monocliente (`NEURA_INSTANCE_MODE=single_client`), `empresa_modulos`
     * es la única fuente de verdad: los aliases legacy (omnicanal → finalizadas/historial/monitoreo,
     * clientes → gestion-clientes, ventas → notas_credito) quedan inhabilitados.
     */
    const strictAllowlist =
      (process.env.NEURA_INSTANCE_MODE ?? "").trim().toLowerCase() === "single_client";

    const supabase = createServiceRoleClient();

    const usuario = await resolveUsuarioErpFromAuthUser(supabase, user);

    if (!usuario) {
      if (isBootstrapSuperAdminEmail(user.email)) {
        const modulos = await resolveEffectiveModules(supabase, {
          id: user.id,
          empresa_id: null,
          rol: "super_admin",
        });
        return NextResponse.json({
          superAdmin: true,
          slugs: modulos.map((m) => m.slug).filter(Boolean),
          inactiveSlugs: [],
          strictAllowlist,
          modulos: modulos.map((m) => ({ id: m.id, nombre: m.nombre, slug: m.slug })),
        });
      }
      return NextResponse.json({
        superAdmin: false,
        slugs: [],
        inactiveSlugs: [],
        strictAllowlist,
        modulos: [],
      });
    }

    const modulos = await resolveEffectiveModules(supabase, {
      id: usuario.id,
      empresa_id: usuario.empresa_id,
      rol: usuario.rol,
    });

    const superAdmin = (usuario.rol ?? "").trim() === "super_admin";

    /**
     * Slugs presentes en `empresa_modulos` con `activo=false` para esta empresa.
     * Permite al gate de rutas distinguir "no presente" (alias legacy puede otorgar) de
     * "explícitamente desactivado" (ningún alias debe otorgar).
     */
    let inactiveSlugs: string[] = [];
    if (!superAdmin && usuario.empresa_id) {
      const { data: emInactive, error: errInactive } = await supabase
        .from("empresa_modulos")
        .select("modulo_id, modulos!inner(slug)")
        .eq("empresa_id", usuario.empresa_id)
        .eq("activo", false);
      if (!errInactive && Array.isArray(emInactive)) {
        inactiveSlugs = emInactive
          .map((r: { modulos?: { slug?: unknown } | { slug?: unknown }[] }) => {
            const mod = Array.isArray(r.modulos) ? r.modulos[0] : r.modulos;
            return typeof mod?.slug === "string" ? mod.slug : "";
          })
          .filter((s) => s.length > 0);
      }
    }

    return NextResponse.json({
      superAdmin,
      slugs: modulos.map((m) => m.slug).filter(Boolean),
      inactiveSlugs,
      strictAllowlist,
      modulos: modulos.map((m) => ({ id: m.id, nombre: m.nombre, slug: m.slug })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
