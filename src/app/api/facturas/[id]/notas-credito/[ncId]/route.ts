import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * PATCH /api/facturas/[id]/notas-credito/[ncId]
 * Body: { "action": "anular_borrador" } — solo si estado_erp = borrador (operación interna).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ncId: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;
    const { id: facturaId, ncId } = await params;
    const fid = facturaId?.trim();
    const nid = ncId?.trim();
    if (!fid || !nid) {
      return NextResponse.json(errorResponse("Parámetros incompletos"), { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(errorResponse("Cuerpo JSON inválido"), { status: 400 });
    }
    const action = (body as { action?: string })?.action;
    if (action !== "anular_borrador") {
      return NextResponse.json(errorResponse('Acción no soportada. Usá action: "anular_borrador".'), {
        status: 400,
      });
    }

    const { data: nc, error: errN } = await supabase
      .from("nota_credito")
      .select("id, estado_erp, factura_id")
      .eq("id", nid)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errN) {
      return NextResponse.json(errorResponse(errN.message), { status: 400 });
    }
    if (!nc) {
      return NextResponse.json(errorResponse("Nota de crédito no encontrada"), { status: 404 });
    }
    if (String((nc as { factura_id: string }).factura_id) !== fid) {
      return NextResponse.json(errorResponse("La nota de crédito no corresponde a esta factura."), { status: 400 });
    }

    if (String((nc as { estado_erp: string }).estado_erp) !== "borrador") {
      return NextResponse.json(
        errorResponse("Solo se pueden anular notas de crédito en estado borrador."),
        { status: 409 }
      );
    }

    const { error: errU } = await supabase
      .from("nota_credito")
      .update({ estado_erp: "anulada_borrador" })
      .eq("id", nid)
      .eq("empresa_id", auth.empresa_id)
      .eq("estado_erp", "borrador");

    if (errU) {
      return NextResponse.json(errorResponse(errU.message), { status: 500 });
    }

    const { error: errE } = await supabase.from("nota_credito_evento").insert({
      empresa_id: auth.empresa_id,
      nota_credito_id: nid,
      actor_user_id: auth.user.id,
      tipo_evento: "anulacion_borrador",
      detalle_json: { motivo: "solicitud_usuario", factura_id: fid },
    });

    if (errE) {
      return NextResponse.json(
        errorResponse(`Nota anulada pero falló el evento de auditoría: ${errE.message}`),
        { status: 500 }
      );
    }

    return NextResponse.json(successResponse({ id: nid, estado_erp: "anulada_borrador" }));
  } catch (e) {
    return NextResponse.json(
      errorResponse(e instanceof Error ? e.message : "Error interno"),
      { status: 500 }
    );
  }
}
