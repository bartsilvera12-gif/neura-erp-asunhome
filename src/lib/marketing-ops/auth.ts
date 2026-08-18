import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import { resolveEffectiveModules } from "@/lib/modulos/resolve-effective-modules";

export type MarketingOpsApiAuth =
  | { ok: true; empresaId: string; usuarioCatalogId: string; rol: string | null }
  | { ok: false; status: number; message: string };

export async function requireMarketingOpsApiAccess(request: Request): Promise<MarketingOpsApiAuth> {
  const user = await getAuthUserForApiRoute(request);
  if (!user?.id) {
    return { ok: false, status: 401, message: "No autenticado" };
  }

  const catalog = createServiceRoleClient();
  const usuario = await resolveUsuarioErpFromAuthUser(catalog, user);

  if (!usuario?.empresa_id) {
    if (isBootstrapSuperAdminEmail(user.email)) {
      return { ok: false, status: 403, message: "Seleccioná una empresa para usar Marketing Ops" };
    }
    return { ok: false, status: 403, message: "Usuario sin empresa" };
  }

  const rol = (usuario.rol ?? "").trim();
  if (rol === "super_admin" || isBootstrapSuperAdminEmail(user.email)) {
    return { ok: true, empresaId: usuario.empresa_id, usuarioCatalogId: usuario.id, rol: usuario.rol };
  }

  const modulos = await resolveEffectiveModules(catalog, {
    id: usuario.id,
    empresa_id: usuario.empresa_id,
    rol: usuario.rol,
  });
  const slugs = new Set(modulos.map((m) => (m.slug ?? "").trim().toLowerCase()));
  if (!slugs.has("marketing_ops")) {
    return { ok: false, status: 403, message: "Sin acceso al módulo Marketing Ops" };
  }

  return { ok: true, empresaId: usuario.empresa_id, usuarioCatalogId: usuario.id, rol: usuario.rol };
}
