import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import type { FacturaElectronicaDTO, SifenBorradorGeneracionDetalle } from "@/lib/sifen/types";


/**
 * POST /api/facturas/[id]/sifen/borrador
 * Crea (o devuelve) el registro factura_electronica en estado borrador, sin XML ni SET.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getFacturasSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const { id: facturaId } = await params;
    if (!facturaId?.trim()) {
      return NextResponse.json(errorResponse("id de factura es obligatorio"), { status: 400 });
    }

    const fid = facturaId.trim();

    const { data: factura, error: errFactura } = await supabase
      .from("facturas")
      .select("id")
      .eq("id", fid)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errFactura) {
      return NextResponse.json(errorResponse(errFactura.message), { status: 400 });
    }
    if (!factura) {
      return NextResponse.json(errorResponse("Factura no encontrada"), { status: 404 });
    }

    const { data: sifenConfig, error: errConfig } = await supabase
      .from("empresa_sifen_config")
      .select("id, activo")
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errConfig) {
      return NextResponse.json(errorResponse(errConfig.message), { status: 400 });
    }
    if (!sifenConfig) {
      return NextResponse.json(
        errorResponse(
          "No hay configuración SIFEN para esta empresa. Cree la configuración en /api/configuracion/sifen antes de generar el borrador."
        ),
        { status: 400 }
      );
    }
    if (!sifenConfig.activo) {
      return NextResponse.json(
        errorResponse(
          "La configuración SIFEN está desactivada. Actívela desde /api/configuracion/sifen para generar borradores electrónicos."
        ),
        { status: 400 }
      );
    }

    const { data: existente, error: errExistente } = await supabase
      .from("factura_electronica")
      .select("*")
      .eq("factura_id", fid)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errExistente) {
      return NextResponse.json(errorResponse(errExistente.message), { status: 400 });
    }
    if (existente) {
      return NextResponse.json(successResponse(existente as FacturaElectronicaDTO));
    }

    const { data: creada, error: errInsert } = await supabase
      .from("factura_electronica")
      .insert({
        empresa_id: auth.empresa_id,
        factura_id: fid,
        estado_sifen: "borrador",
      })
      .select()
      .single();

    if (errInsert) {
      if (errInsert.code === "23505") {
        const { data: otra, error: errOtra } = await supabase
          .from("factura_electronica")
          .select("*")
          .eq("factura_id", fid)
          .eq("empresa_id", auth.empresa_id)
          .maybeSingle();
        if (errOtra) {
          return NextResponse.json(errorResponse(errOtra.message), { status: 400 });
        }
        if (otra) {
          return NextResponse.json(successResponse(otra as FacturaElectronicaDTO));
        }
      }
      return NextResponse.json(errorResponse(errInsert.message), { status: 400 });
    }

    const detalle: SifenBorradorGeneracionDetalle = {
      origen: "api_borrador",
      factura_id: fid,
    };

    const { error: errEvento } = await supabase.from("factura_electronica_evento").insert({
      empresa_id: auth.empresa_id,
      factura_electronica_id: creada.id,
      tipo: "generacion",
      detalle,
    });

    if (errEvento) {
      await supabase
        .from("factura_electronica")
        .delete()
        .eq("id", creada.id)
        .eq("empresa_id", auth.empresa_id);
      return NextResponse.json(
        errorResponse(`No se pudo registrar el evento de generación: ${errEvento.message}`),
        { status: 500 }
      );
    }

    return NextResponse.json(successResponse(creada as FacturaElectronicaDTO));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
