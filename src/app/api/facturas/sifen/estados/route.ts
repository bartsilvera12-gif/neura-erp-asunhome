import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const MAX_IDS = 100;


function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export type FacturaSifenEstadoItem = {
  factura_electronica_id: string | null;
  estado_sifen: string | null;
};

/**
 * POST /api/facturas/sifen/estados
 * Body: { factura_ids: string[] } — hasta 100 IDs de facturas de la empresa.
 * Respuesta: { by_factura_id: Record<id, FacturaSifenEstadoItem> } solo para IDs válidos y existentes.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getFacturasSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(errorResponse("Cuerpo JSON inválido"), { status: 400 });
    }

    if (body == null || typeof body !== "object" || !Array.isArray((body as { factura_ids?: unknown }).factura_ids)) {
      return NextResponse.json(errorResponse("Se requiere factura_ids: string[]"), { status: 400 });
    }

    const raw = (body as { factura_ids: unknown[] }).factura_ids
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter((id) => id.length > 0 && isUuidLike(id));

    const unique = [...new Set(raw)].slice(0, MAX_IDS);
    if (unique.length === 0) {
      return NextResponse.json(successResponse({ by_factura_id: {} as Record<string, FacturaSifenEstadoItem> }));
    }


    const { data: facturasPropias, error: errF } = await supabase
      .from("facturas")
      .select("id")
      .eq("empresa_id", auth.empresa_id)
      .in("id", unique);

    if (errF) {
      return NextResponse.json(errorResponse(errF.message), { status: 400 });
    }

    const permitidos = new Set((facturasPropias ?? []).map((r) => String((r as { id: string }).id)));
    const idsFiltrados = unique.filter((id) => permitidos.has(id));
    if (idsFiltrados.length === 0) {
      return NextResponse.json(successResponse({ by_factura_id: {} as Record<string, FacturaSifenEstadoItem> }));
    }

    const { data: electronicas, error: errE } = await supabase
      .from("factura_electronica")
      .select("id, factura_id, estado_sifen")
      .eq("empresa_id", auth.empresa_id)
      .in("factura_id", idsFiltrados);

    if (errE) {
      return NextResponse.json(errorResponse(errE.message), { status: 400 });
    }

    const by_factura_id: Record<string, FacturaSifenEstadoItem> = {};
    for (const id of idsFiltrados) {
      by_factura_id[id] = { factura_electronica_id: null, estado_sifen: null };
    }
    for (const row of electronicas ?? []) {
      const r = row as { id: string; factura_id: string; estado_sifen: string };
      by_factura_id[r.factura_id] = {
        factura_electronica_id: r.id,
        estado_sifen: r.estado_sifen,
      };
    }

    return NextResponse.json(successResponse({ by_factura_id }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
