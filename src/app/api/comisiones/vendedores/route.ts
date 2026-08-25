/**
 * Vendedores para comisiones (modelo ASUNHOME: % del total de ventas).
 *
 * GET   → lista de vendedores (usuarios con es_vendedor=true) {id, nombre, porcentaje_comision}
 *         Usado por el selector de vendedor en la venta y por el reporte de comisiones.
 * PATCH → edita el % de comisión de un vendedor { id, porcentaje_comision }.
 *         Solo admin (requireComisionesModuleAccess + puedeConfigurarComisiones).
 */
import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import {
  puedeConfigurarComisiones,
  requireComisionesModuleAccess,
} from "@/lib/comisiones/comisiones-auth";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";

/** GET — lista de vendedores. Accesible a cualquier usuario autenticado de la empresa
 *  (el selector de venta lo necesita), por eso usa el auth tenant estándar. */
export async function GET(request: Request) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse("No autenticado"), { status: 401 });

    const { data, error } = await ctx.supabase
      .from("usuarios")
      .select("id, nombre, email, porcentaje_comision")
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("es_vendedor", true)
      .order("nombre", { ascending: true });
    if (error) throw new Error(error.message);

    const vendedores = (data ?? []).map((u) => ({
      id: String((u as { id: string }).id),
      nombre: ((u as { nombre?: string | null }).nombre ?? "").trim() || ((u as { email?: string | null }).email ?? ""),
      email: ((u as { email?: string | null }).email ?? "").trim(),
      porcentaje_comision: Number((u as { porcentaje_comision?: number | null }).porcentaje_comision) || 0,
    }));

    return NextResponse.json(successResponse({ vendedores }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/** PATCH — editar % de comisión de un vendedor (solo admin). */
export async function PATCH(request: Request) {
  const auth = await requireComisionesModuleAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }
  if (!puedeConfigurarComisiones(auth.rol)) {
    return NextResponse.json(errorResponse("Sin permiso para configurar comisiones"), { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = body.id != null ? String(body.id) : "";
    if (!id) return NextResponse.json(errorResponse("id es obligatorio"), { status: 400 });

    const pct = Number(body.porcentaje_comision);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return NextResponse.json(errorResponse("porcentaje_comision debe estar entre 0 y 100"), { status: 400 });
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { error } = await sb
      .from("usuarios")
      .update({ porcentaje_comision: pct })
      .eq("id", id)
      .eq("empresa_id", auth.empresaId);
    if (error) throw new Error(error.message);

    return NextResponse.json(successResponse({ id, porcentaje_comision: pct }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
