import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";


/** Genera lista de meses desde fecha_inicio por duracion_meses. Formato YYYY-MM. */
function generarMeses(fechaInicio: string, duracionMeses: number): string[] {
  const meses: string[] = [];
  const [year, month] = fechaInicio.split("-").map(Number);
  for (let i = 0; i < duracionMeses; i++) {
    const m = month + i;
    const y = year + Math.floor((m - 1) / 12);
    const mesNum = ((m - 1) % 12) + 1;
    meses.push(`${y}-${String(mesNum).padStart(2, "0")}`);
  }
  return meses;
}

/**
 * GET /api/clientes/:id/facturacion
 * Obtiene la facturación proyectada del cliente (suscripción activa).
 * Retorna [{ mes, estado, factura_id }] - estado: "emitida" | "proyectada"
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getFacturasSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const { id: clienteId } = await params;
    if (!clienteId) {
      return NextResponse.json(errorResponse("cliente_id es obligatorio"), { status: 400 });
    }


    const { data: suscripcion, error: errSusc } = await supabase
      .from("suscripciones")
      .select("*")
      .eq("cliente_id", clienteId)
      .eq("empresa_id", auth.empresa_id)
      .eq("estado", "activa")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (errSusc) {
      return NextResponse.json(errorResponse(errSusc.message), { status: 400 });
    }

    if (!suscripcion) {
      return NextResponse.json(
        successResponse({ facturacion: [], suscripcion: null })
      );
    }

    const meses = generarMeses(
      suscripcion.fecha_inicio,
      suscripcion.duracion_meses ?? 12
    );

    const hoy = new Date().toISOString().slice(0, 10);
    const { data: facturas, error: errFact } = await supabase
      .from("facturas")
      .select("id, fecha, fecha_vencimiento, saldo, estado")
      .eq("cliente_id", clienteId)
      .eq("suscripcion_id", suscripcion.id)
      .eq("empresa_id", auth.empresa_id);

    if (errFact) {
      return NextResponse.json(errorResponse(errFact.message), { status: 400 });
    }

    const facturasPorMes = new Map<string, { id: string; saldo: number; fecha_vencimiento: string; estado: string }>();
    for (const f of facturas ?? []) {
      const mes = (f.fecha as string).slice(0, 7);
      if (!facturasPorMes.has(mes)) {
        const saldo = Number(f.saldo ?? 0);
        const estaVencida = saldo > 0 && (f.fecha_vencimiento as string) < hoy;
        facturasPorMes.set(mes, {
          id: f.id,
          saldo,
          fecha_vencimiento: f.fecha_vencimiento as string,
          estado: estaVencida ? "Vencido" : (f.estado as string),
        });
      }
    }

    const facturacion = meses.map((mes) => {
      const factura = facturasPorMes.get(mes);
      const estadoBase = factura ? "emitida" : "proyectada";
      let badgeEstado = estadoBase;
      if (factura) {
        if (factura.estado === "Pagado" || factura.estado === "Corregida NC" || factura.saldo === 0) {
          badgeEstado = "emitida";
        }
        else if (factura.estado === "Vencido") badgeEstado = "vencida";
        else badgeEstado = "pendiente";
      }
      return {
        mes,
        estado: estadoBase,
        badge_estado: badgeEstado,
        factura_id: factura?.id ?? null,
      };
    });

    return NextResponse.json(
      successResponse({
        facturacion,
        suscripcion: {
          id: suscripcion.id,
          precio: suscripcion.precio,
          moneda: suscripcion.moneda,
          fecha_inicio: suscripcion.fecha_inicio,
          duracion_meses: suscripcion.duracion_meses,
        },
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
