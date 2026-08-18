import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/middleware/auth";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { previewSyncMarketing, regenerarMesCompleto, sincronizarClientesMarketing } from "@/lib/marketing/generador";

/**
 * GET /api/marketing/sync?preview=1&mes=YYYY-MM
 * Preview de sincronización: clientes a marcar, tareas a generar. No ejecuta nada.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx?.auth?.user?.email) {
      return NextResponse.json(errorResponse("No autenticado"), { status: 401 });
    }

    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(errorResponse("Solo administradores pueden sincronizar marketing"), { status: 403 });
    }

    const empresaId = ctx.auth.empresa_id;
    if (!empresaId) {
      return NextResponse.json(errorResponse("Usuario sin empresa asignada"), { status: 403 });
    }

    const url = new URL(request.url);
    const mes = url.searchParams.get("mes") || new Date().toISOString().slice(0, 7);

    if (!/^\d{4}-\d{2}$/.test(mes)) {
      return NextResponse.json(errorResponse("Formato mes inválido (usar YYYY-MM)"), { status: 400 });
    }

    const supabaseAdmin = ctx.supabase;
    const previewData = await previewSyncMarketing({
      empresa_id: empresaId,
      mes,
      supabaseClient: supabaseAdmin,
    });
    return NextResponse.json(successResponse(previewData));
  } catch (err) {
    console.error("[api/marketing/sync] GET:", err);
    return NextResponse.json(errorResponse("Error en preview"), { status: 500 });
  }
}

/**
 * POST /api/marketing/sync
 * Ejecuta sincronización: marca clientes y genera tareas.
 * Body: { mes: "YYYY-MM", confirmar: true }
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx?.auth?.user?.email) {
      return NextResponse.json(errorResponse("No autenticado"), { status: 401 });
    }

    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(errorResponse("Solo administradores pueden sincronizar marketing"), { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const mes = typeof body.mes === "string" ? body.mes : new Date().toISOString().slice(0, 7);
    const confirmar = body.confirmar === true;

    if (!confirmar) {
      return NextResponse.json(errorResponse("Debe enviar confirmar: true para ejecutar"), { status: 400 });
    }

    if (!/^\d{4}-\d{2}$/.test(mes)) {
      return NextResponse.json(errorResponse("Formato mes inválido (usar YYYY-MM)"), { status: 400 });
    }

    const empresaId = ctx.auth.empresa_id;
    if (!empresaId) {
      return NextResponse.json(errorResponse("Usuario sin empresa asignada"), { status: 403 });
    }

    const supabaseAdmin = ctx.supabase;
    const syncCli = await sincronizarClientesMarketing(empresaId, supabaseAdmin);
    const resultado = await regenerarMesCompleto({
      empresa_id: empresaId,
      mes,
      supabaseClient: supabaseAdmin,
    });

    const errores = [...syncCli.errores, ...resultado.errores];

    return NextResponse.json(
      successResponse({
        mes,
        clientes_actualizados: syncCli.actualizados,
        clientes_sincronizar_errores: syncCli.errores,
        tareas_eliminadas: resultado.eliminadas,
        tareas_generadas: resultado.generadas,
        tareas_omitidas: resultado.omitidas,
        errores,
      })
    );
  } catch (err) {
    console.error("[api/marketing/sync] POST:", err);
    return NextResponse.json(errorResponse("Error al sincronizar"), { status: 500 });
  }
}
