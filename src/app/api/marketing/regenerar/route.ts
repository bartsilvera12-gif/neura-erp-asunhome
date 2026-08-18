import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/middleware/auth";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { regenerarTareasClienteMes } from "@/lib/marketing/generador";

/**
 * POST /api/marketing/regenerar
 * Regenera tareas automáticas de un cliente en un mes.
 * Body: { mes: "YYYY-MM", cliente_id: string, confirmar: true }
 * - Elimina solo tareas automáticas del cliente en ese mes.
 * - Regenera según plantilla_operativa actual del plan activo.
 * - No toca tareas manuales.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx?.auth?.user?.email) {
      return NextResponse.json(errorResponse("No autenticado"), { status: 401 });
    }

    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(errorResponse("Solo administradores pueden regenerar tareas"), { status: 403 });
    }

    const empresaId = ctx.auth.empresa_id;
    if (!empresaId) {
      return NextResponse.json(errorResponse("Usuario sin empresa asignada"), { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const mes = typeof body.mes === "string" ? body.mes : "";
    const clienteId = typeof body.cliente_id === "string" ? body.cliente_id.trim() : "";
    const confirmar = body.confirmar === true;

    if (!confirmar) {
      return NextResponse.json(errorResponse("Debe enviar confirmar: true para ejecutar"), { status: 400 });
    }

    if (!/^\d{4}-\d{2}$/.test(mes)) {
      return NextResponse.json(errorResponse("Formato mes inválido (usar YYYY-MM)"), { status: 400 });
    }

    if (!clienteId) {
      return NextResponse.json(errorResponse("cliente_id requerido"), { status: 400 });
    }

    const supabaseAdmin = ctx.supabase;
    const resultado = await regenerarTareasClienteMes({
      empresa_id: empresaId,
      mes,
      cliente_id: clienteId,
      supabaseClient: supabaseAdmin,
    });

    if (resultado.errores.length > 0 && resultado.generadas === 0 && resultado.eliminadas === 0) {
      return NextResponse.json(
        errorResponse(resultado.errores[0] ?? "Error al regenerar"),
        { status: 400 }
      );
    }

    return NextResponse.json(
      successResponse({
        mes,
        cliente_id: clienteId,
        eliminadas: resultado.eliminadas,
        generadas: resultado.generadas,
        errores: resultado.errores,
      })
    );
  } catch (err) {
    console.error("[api/marketing/regenerar] POST:", err);
    return NextResponse.json(errorResponse("Error al regenerar"), { status: 500 });
  }
}
