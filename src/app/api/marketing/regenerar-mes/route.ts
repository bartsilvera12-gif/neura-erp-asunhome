import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/middleware/auth";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { regenerarMesCompleto } from "@/lib/marketing/generador";

/**
 * POST /api/marketing/regenerar-mes
 * Regenera TODAS las tareas automáticas del mes para TODOS los clientes marketing activos.
 * Body: { mes: "YYYY-MM", confirmar: true }
 * - Elimina solo tareas automáticas del mes.
 * - No toca tareas manuales.
 * - Regenera según plantilla_operativa actual de cada plan.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx?.auth?.user?.email) {
      return NextResponse.json(errorResponse("No autenticado"), { status: 401 });
    }

    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(errorResponse("Solo administradores pueden regenerar el mes"), { status: 403 });
    }

    const empresaId = ctx.auth.empresa_id;
    if (!empresaId) {
      return NextResponse.json(errorResponse("Usuario sin empresa asignada"), { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const mes = typeof body.mes === "string" ? body.mes : "";
    const confirmar = body.confirmar === true;

    if (!confirmar) {
      return NextResponse.json(errorResponse("Debe enviar confirmar: true para ejecutar"), { status: 400 });
    }

    if (!/^\d{4}-\d{2}$/.test(mes)) {
      return NextResponse.json(errorResponse("Formato mes inválido (usar YYYY-MM)"), { status: 400 });
    }

    const supabaseAdmin = ctx.supabase;
    const resultado = await regenerarMesCompleto({
      empresa_id: empresaId,
      mes,
      supabaseClient: supabaseAdmin,
    });

    return NextResponse.json(
      successResponse({
        mes,
        eliminadas: resultado.eliminadas,
        generadas: resultado.generadas,
        omitidas: resultado.omitidas,
        errores: resultado.errores,
      })
    );
  } catch (err) {
    console.error("[api/marketing/regenerar-mes] POST:", err);
    return NextResponse.json(errorResponse("Error al regenerar mes"), { status: 500 });
  }
}
