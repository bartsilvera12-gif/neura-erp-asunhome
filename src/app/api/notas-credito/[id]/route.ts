import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import type { NotaCreditoGlobalDetailDTO, NotaCreditoEventoAuditoriaDTO } from "@/lib/nota-credito/types";

function clienteDisplay(c: Record<string, unknown> | null): { id: string; display: string; ruc: string | null } {
  if (!c) return { id: "", display: "—", ruc: null };
  const emp = String(c.empresa ?? "").trim();
  const nom = String(c.nombre_contacto ?? "").trim();
  return {
    id: String(c.id ?? ""),
    display: emp || nom || "—",
    ruc: c.ruc == null || String(c.ruc).trim() === "" ? null : String(c.ruc).trim(),
  };
}

/**
 * GET /api/notas-credito/[id] — detalle + eventos (auditoría).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(_request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;
    const { id } = await params;
    const nid = id?.trim() ?? "";
    if (!nid) {
      return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });
    }

    const { data: nc, error: errNc } = await supabase
      .from("nota_credito")
      .select(
        "id, empresa_id, cliente_id, factura_id, monto, motivo, observacion_interna, estado_erp, created_at, updated_at, created_by_user_id, created_by_email_snapshot, created_by_nombre_snapshot, saldo_previo_snapshot, monto_factura_snapshot, suma_pagos_snapshot, moneda_snapshot, factura_electronica_origen_id"
      )
      .eq("id", nid)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errNc) {
      return NextResponse.json(errorResponse(errNc.message), { status: 400 });
    }
    if (!nc) {
      return NextResponse.json(errorResponse("Nota de crédito no encontrada"), { status: 404 });
    }

    const row = nc as { cliente_id: string; factura_id: string };
    const [{ data: ne }, { data: cli }, { data: fac }, { data: evs }] = await Promise.all([
      supabase.from("nota_credito_electronica").select("*").eq("nota_credito_id", nid).eq("empresa_id", auth.empresa_id).maybeSingle(),
      supabase.from("clientes").select("id, empresa, nombre_contacto, ruc").eq("id", row.cliente_id).eq("empresa_id", auth.empresa_id).maybeSingle(),
      supabase.from("facturas").select("id, numero_factura, fecha, monto, moneda").eq("id", row.factura_id).eq("empresa_id", auth.empresa_id).maybeSingle(),
      supabase
        .from("nota_credito_evento")
        .select("id, tipo_evento, detalle_json, created_at, actor_user_id")
        .eq("nota_credito_id", nid)
        .eq("empresa_id", auth.empresa_id)
        .order("created_at", { ascending: false }),
    ]);

    const eventos: NotaCreditoEventoAuditoriaDTO[] = (evs ?? []).map((e) => ({
      id: String((e as { id: string }).id),
      tipo_evento: String((e as { tipo_evento: string }).tipo_evento),
      detalle_json:
        typeof (e as { detalle_json?: unknown }).detalle_json === "object" &&
        (e as { detalle_json?: unknown }).detalle_json !== null
          ? ((e as { detalle_json: Record<string, unknown> }).detalle_json as Record<string, unknown>)
          : {},
      created_at: String((e as { created_at: string }).created_at),
      actor_user_id: (e as { actor_user_id?: string | null }).actor_user_id == null ? null : String((e as { actor_user_id: string }).actor_user_id),
    }));

    const f = fac as Record<string, unknown> | null;
    const payload: NotaCreditoGlobalDetailDTO = {
      nota_credito: nc as unknown as Record<string, unknown>,
      nota_credito_electronica: ne == null ? null : (ne as unknown as Record<string, unknown>),
      cliente: clienteDisplay(cli as Record<string, unknown> | null),
      factura: {
        id: String(f?.id ?? row.factura_id),
        numero_factura: f?.numero_factura == null ? null : String(f.numero_factura),
        fecha: f?.fecha == null ? null : String(f.fecha),
        monto: f?.monto == null ? null : Number(f.monto),
        moneda: f?.moneda == null ? null : String(f.moneda),
      },
      eventos,
    };

    return NextResponse.json(successResponse(payload));
  } catch (e) {
    return NextResponse.json(errorResponse(e instanceof Error ? e.message : "Error"), { status: 500 });
  }
}
