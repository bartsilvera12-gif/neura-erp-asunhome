import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";


export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const inicioMes = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const nextM = m === 11 ? 0 : m + 1;
    const nextY = m === 11 ? y + 1 : y;
    const inicioMesSiguiente = `${nextY}-${String(nextM + 1).padStart(2, "0")}-01`;


    const [facturasRes, pagosRes, inactivosRes] = await Promise.all([
      supabase
        .from("facturas")
        .select("monto, fecha")
        .eq("empresa_id", auth.empresa_id)
        .neq("estado", "Anulado")
        .gte("fecha", inicioMes)
        .lt("fecha", inicioMesSiguiente),
      supabase
        .from("pagos")
        .select("monto, fecha_pago")
        .eq("empresa_id", auth.empresa_id)
        .gte("fecha_pago", inicioMes)
        .lt("fecha_pago", inicioMesSiguiente),
      supabase.from("clientes").select("id").eq("empresa_id", auth.empresa_id).eq("estado", "inactivo"),
    ]);

    if (facturasRes.error) {
      return NextResponse.json(errorResponse(facturasRes.error.message), { status: 400 });
    }
    if (pagosRes.error) {
      return NextResponse.json(errorResponse(pagosRes.error.message), { status: 400 });
    }
    if (inactivosRes.error) {
      return NextResponse.json(errorResponse(inactivosRes.error.message), { status: 400 });
    }

    const facturadoMes = (facturasRes.data ?? []).reduce((s, f) => s + Number(f.monto), 0);
    const cobradoMes = (pagosRes.data ?? []).reduce((s, p) => s + Number(p.monto), 0);

    const inactivos = new Set((inactivosRes.data ?? []).map((c: { id: string }) => c.id));

    const { data: facturasPendientes } = await supabase
      .from("facturas")
      .select("saldo, cliente_id")
      .eq("empresa_id", auth.empresa_id)
      .neq("estado", "Anulado")
      .gt("saldo", 0);

    const pendienteCobro = (facturasPendientes ?? [])
      .filter((f: { cliente_id: string }) => !inactivos.has(f.cliente_id))
      .reduce((s, f) => s + Number(f.saldo), 0);

    const data = {
      facturado_mes: facturadoMes,
      cobrado_mes: cobradoMes,
      pendiente_cobro: pendienteCobro,
    };

    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
