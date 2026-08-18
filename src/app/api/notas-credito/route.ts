import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import type { NotaCreditoGlobalListItemDTO } from "@/lib/nota-credito/types";

const SELECT_LIST =
  "id, monto, motivo, observacion_interna, estado_erp, created_at, factura_id, cliente_id, moneda_snapshot, created_by_user_id, created_by_email_snapshot, created_by_nombre_snapshot, clientes(id, empresa, nombre_contacto, ruc), facturas(id, numero_factura), nota_credito_electronica(estado_sifen, cdc, cdc_factura_origen, last_error, error)";

function mapClienteDisplay(c: Record<string, unknown> | null | undefined): string {
  if (!c) return "—";
  const emp = String(c.empresa ?? "").trim();
  const nom = String(c.nombre_contacto ?? "").trim();
  return emp || nom || "—";
}

function mapRow(r: Record<string, unknown>): NotaCreditoGlobalListItemDTO {
  const ne = r.nota_credito_electronica as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
  const neObj = Array.isArray(ne) ? ne[0] : ne;
  const lastErr =
    neObj?.last_error != null && String(neObj.last_error).trim() !== ""
      ? String(neObj.last_error)
      : neObj?.error != null && String(neObj.error).trim() !== ""
        ? String(neObj.error)
        : null;
  const cli = r.clientes as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
  const cliObj = Array.isArray(cli) ? cli[0] : cli;
  const fac = r.facturas as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
  const facObj = Array.isArray(fac) ? fac[0] : fac;
  return {
    id: String(r.id),
    monto: Number(r.monto),
    motivo: String(r.motivo ?? ""),
    observacion_interna: r.observacion_interna == null ? null : String(r.observacion_interna),
    estado_erp: String(r.estado_erp) as NotaCreditoGlobalListItemDTO["estado_erp"],
    created_at: String(r.created_at ?? ""),
    factura_id: String(r.factura_id),
    factura_numero: facObj?.numero_factura == null ? null : String(facObj.numero_factura),
    cliente_id: String(r.cliente_id),
    cliente_display: mapClienteDisplay(cliObj),
    moneda_snapshot: String(r.moneda_snapshot ?? "GS"),
    created_by_user_id: r.created_by_user_id == null ? null : String(r.created_by_user_id),
    created_by_email_snapshot: r.created_by_email_snapshot == null ? null : String(r.created_by_email_snapshot),
    created_by_nombre_snapshot: r.created_by_nombre_snapshot == null ? null : String(r.created_by_nombre_snapshot),
    estado_sifen: neObj?.estado_sifen == null ? null : (String(neObj.estado_sifen) as NotaCreditoGlobalListItemDTO["estado_sifen"]),
    cdc: neObj?.cdc == null ? null : String(neObj.cdc),
    cdc_factura_origen: neObj?.cdc_factura_origen == null ? null : String(neObj.cdc_factura_origen),
    last_error_resumido: lastErr == null ? null : lastErr.length > 120 ? `${lastErr.slice(0, 117)}…` : lastErr,
  };
}

/**
 * GET /api/notas-credito — listado global (tenant) con filtros.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;
    const sp = request.nextUrl.searchParams;

    const desde = sp.get("desde")?.trim() ?? "";
    const hasta = sp.get("hasta")?.trim() ?? "";
    const clienteId = sp.get("cliente_id")?.trim() ?? "";
    const estadoErp = sp.get("estado_erp")?.trim() ?? "";
    const estadoSifen = sp.get("estado_sifen")?.trim() ?? "";
    const usuarioId = sp.get("usuario_id")?.trim() ?? "";
    const facturaId = sp.get("factura_id")?.trim() ?? "";
    const buscar = sp.get("buscar")?.trim() ?? "";
    const cdcBuscar = sp.get("cdc")?.trim() ?? "";
    const conError = sp.get("con_error")?.trim() ?? "";

    const limit = Math.min(Math.max(parseInt(sp.get("limit") ?? "50", 10) || 50, 1), 200);
    const page = Math.max(parseInt(sp.get("page") ?? "1", 10) || 1, 1);
    const offset = (page - 1) * limit;

    let idFilter: string[] | null = null;

    if (estadoSifen || conError === "1" || conError === "0" || cdcBuscar.length >= 8) {
      let nq = supabase
        .from("nota_credito_electronica")
        .select("nota_credito_id, estado_sifen, cdc, last_error, error")
        .eq("empresa_id", auth.empresa_id);
      if (estadoSifen) nq = nq.eq("estado_sifen", estadoSifen);
      if (cdcBuscar.length >= 8) {
        const b = cdcBuscar.replace(/%/g, "");
        nq = nq.or(`cdc.ilike.%${b}%,cdc_factura_origen.ilike.%${b}%`);
      }
      if (conError === "1") {
        nq = nq.or("last_error.not.is.null,error.not.is.null");
      } else if (conError === "0") {
        nq = nq.is("last_error", null).is("error", null);
      }
      const { data: neRows, error: neErr } = await nq;
      if (neErr) {
        return NextResponse.json(errorResponse(neErr.message), { status: 400 });
      }
      idFilter = [...new Set((neRows ?? []).map((x) => String((x as { nota_credito_id: string }).nota_credito_id)))];
      if (idFilter.length === 0) {
        return NextResponse.json(successResponse({ items: [], total: 0, page, limit }));
      }
    }

    let q = supabase
      .from("nota_credito")
      .select(SELECT_LIST, { count: "exact" })
      .eq("empresa_id", auth.empresa_id)
      .order("created_at", { ascending: false });

    if (idFilter) q = q.in("id", idFilter);
    if (desde) q = q.gte("created_at", `${desde}T00:00:00.000Z`);
    if (hasta) q = q.lte("created_at", `${hasta}T23:59:59.999Z`);
    if (clienteId) q = q.eq("cliente_id", clienteId);
    if (estadoErp) q = q.eq("estado_erp", estadoErp);
    if (usuarioId) q = q.eq("created_by_user_id", usuarioId);
    if (facturaId) q = q.eq("factura_id", facturaId);
    if (buscar.length >= 2) {
      q = q.ilike("motivo", `%${buscar.replace(/%/g, "")}%`);
    }

    const { data: rows, error: errQ, count } = await q.range(offset, offset + limit - 1);

    if (errQ) {
      return NextResponse.json(errorResponse(errQ.message), { status: 400 });
    }

    const items = (rows ?? []).map((x) => mapRow(x as unknown as Record<string, unknown>));

    return NextResponse.json(
      successResponse({
        items,
        total: count ?? items.length,
        page,
        limit,
      })
    );
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}
