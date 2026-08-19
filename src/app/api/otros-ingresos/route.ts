import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  getCajaAbierta,
  listOtrosIngresos,
  registrarMovimiento,
} from "@/lib/caja/server";

/**
 * GET /api/otros-ingresos
 *   Lista Otros Ingresos (tipo='ingreso' en caja_movimientos) con filtros:
 *     - fecha_desde, fecha_hasta (YYYY-MM-DD)
 *     - medio_pago: efectivo|tarjeta|transferencia|otro
 *     - caja_id
 *     - estado: activos (default) | anulados | todos
 *     - q: busca en concepto/observacion
 *     - limit (max 500)
 *
 * POST /api/otros-ingresos
 *   Crea un ingreso manual. Body:
 *     { concepto, descripcion?, monto, medio_pago, caja_id? }
 *   Si caja_id no viene, usa la caja abierta actual. Requiere caja abierta.
 *   Reglas:
 *     - concepto requerido (no vacio)
 *     - monto > 0
 *     - medio_pago valido
 *     - tipo='ingreso' siempre (es lo que define este modulo)
 *
 *   Internamente usa registrarMovimiento con tipo='ingreso'. No toca
 *   inventario. No crea venta. Suma a caja via computeResumen existente.
 */

const MEDIOS_VALIDOS = ["efectivo", "tarjeta", "transferencia", "otro"] as const;
const ESTADOS_VALIDOS = ["activos", "anulados", "todos"] as const;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const url = new URL(request.url);
    const estadoRaw = url.searchParams.get("estado") ?? "activos";
    const estado = (ESTADOS_VALIDOS as readonly string[]).includes(estadoRaw)
      ? (estadoRaw as (typeof ESTADOS_VALIDOS)[number])
      : "activos";

    const ingresos = await listOtrosIngresos(ctx.supabase, ctx.auth.empresa_id, {
      fechaDesde: url.searchParams.get("fecha_desde") ?? undefined,
      fechaHasta: url.searchParams.get("fecha_hasta") ?? undefined,
      medioPago: url.searchParams.get("medio_pago") as
        | "efectivo"
        | "tarjeta"
        | "transferencia"
        | "otro"
        | undefined,
      cajaId: url.searchParams.get("caja_id") ?? undefined,
      estado,
      q: url.searchParams.get("q") ?? undefined,
      limit: Number(url.searchParams.get("limit")) || undefined,
    });
    return NextResponse.json(successResponse({ ingresos }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo cargar.";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }
    const o = (body ?? {}) as Record<string, unknown>;

    const concepto = String(o.concepto ?? "").trim();
    if (!concepto) {
      return NextResponse.json(errorResponse("El concepto es obligatorio."), { status: 400 });
    }
    if (concepto.length > 200) {
      return NextResponse.json(errorResponse("El concepto es demasiado largo (máx. 200)."), { status: 400 });
    }
    const monto = Number(o.monto);
    if (!Number.isFinite(monto) || monto <= 0) {
      return NextResponse.json(
        errorResponse("El monto debe ser mayor a 0."),
        { status: 400 }
      );
    }
    const medioPago = String(o.medio_pago ?? "");
    if (!(MEDIOS_VALIDOS as readonly string[]).includes(medioPago)) {
      return NextResponse.json(
        errorResponse("Método de pago inválido."),
        { status: 400 }
      );
    }
    const descripcion =
      o.descripcion == null || o.descripcion === "" ? null : String(o.descripcion).slice(0, 1000);

    // Resolver caja_id: si viene, validar que sea de la empresa.
    let cajaId = o.caja_id == null || o.caja_id === "" ? null : String(o.caja_id);
    if (!cajaId) {
      const abierta = await getCajaAbierta(ctx.supabase, ctx.auth.empresa_id);
      if (!abierta) {
        return NextResponse.json(
          errorResponse(
            "No hay caja abierta. Abrí una caja antes de registrar el ingreso."
          ),
          { status: 409 }
        );
      }
      cajaId = abierta.id;
    }

    const mov = await registrarMovimiento(ctx.supabase, {
      empresaId: ctx.auth.empresa_id,
      cajaId,
      tipo: "ingreso", // CLAVE: define el modulo. Suma a caja, no toca inventario.
      concepto,
      monto,
      medioPago: medioPago as (typeof MEDIOS_VALIDOS)[number],
      observacion: descripcion,
      usuarioId: ctx.auth.usuarioCatalogId ?? null,
      usuarioEmail: ctx.auth.user?.email ?? null,
    });
    return NextResponse.json(successResponse({ ingreso: mov }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo registrar el ingreso.";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
