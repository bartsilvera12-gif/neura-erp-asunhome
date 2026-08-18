import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

const PERIODICIDAD = new Set(["mensual", "anual", "unico"]);
const MONEDA = new Set(["GS", "USD"]);
const ESTADO = new Set(["activo", "inactivo"]);

async function nextCodigoPlan(supabase: AppSupabaseClient, empresaId: string): Promise<string> {
  const { data } = await supabase
    .from("planes")
    .select("codigo_plan")
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false })
    .limit(1);

  const last = data?.[0] as { codigo_plan?: string } | undefined;
  const match = last?.codigo_plan?.match(/PLAN-(\d+)/);
  const next = parseInt(match?.[1] ?? "0", 10) + 1;
  return `PLAN-${String(next).padStart(4, "0")}`;
}

/**
 * GET /api/planes
 * Planes comerciales del tenant (service role; evita RLS del navegador en erp_*).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, auth } = ctx;
    const { data, error } = await supabase
      .from("planes")
      .select("*")
      .eq("empresa_id", auth.empresa_id)
      .order("codigo_plan", { ascending: true });

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    return NextResponse.json(successResponse(data ?? []));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * POST /api/planes
 * Alta de plan con service role (mismo patrón que GET; el cliente directo suele fallar por RLS).
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, auth } = ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
    if (!nombre) {
      return NextResponse.json(errorResponse("El nombre del plan es obligatorio."), { status: 400 });
    }

    const precioRaw = body.precio;
    const precio =
      typeof precioRaw === "number"
        ? precioRaw
        : typeof precioRaw === "string"
          ? parseFloat(precioRaw)
          : NaN;
    if (!Number.isFinite(precio) || precio <= 0) {
      return NextResponse.json(errorResponse("El precio debe ser un número mayor a 0."), { status: 400 });
    }

    const moneda = typeof body.moneda === "string" ? body.moneda.trim().toUpperCase() : "GS";
    if (!MONEDA.has(moneda)) {
      return NextResponse.json(errorResponse("moneda debe ser GS o USD."), { status: 400 });
    }

    const periodicidad = typeof body.periodicidad === "string" ? body.periodicidad.trim().toLowerCase() : "";
    if (!PERIODICIDAD.has(periodicidad)) {
      return NextResponse.json(errorResponse("periodicidad inválida."), { status: 400 });
    }

    const estado = typeof body.estado === "string" ? body.estado.trim().toLowerCase() : "activo";
    if (!ESTADO.has(estado)) {
      return NextResponse.json(errorResponse("estado inválido."), { status: 400 });
    }

    const descripcion =
      typeof body.descripcion === "string" && body.descripcion.trim() ? body.descripcion.trim() : null;

    const lim = (v: unknown): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : parseInt(String(v), 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    const codigoPlan = await nextCodigoPlan(supabase, auth.empresa_id);

    const insert: Record<string, unknown> = {
      empresa_id: auth.empresa_id,
      codigo_plan: codigoPlan,
      nombre,
      descripcion,
      precio,
      moneda,
      periodicidad,
      limite_usuarios: lim(body.limite_usuarios),
      limite_clientes: lim(body.limite_clientes),
      limite_facturas: lim(body.limite_facturas),
      estado,
    };

    if (typeof body.es_plan_marketing === "boolean") {
      insert.es_plan_marketing = body.es_plan_marketing;
    }
    if (body.plantilla_operativa !== undefined) {
      insert.plantilla_operativa = body.plantilla_operativa;
    }

    const { data, error } = await supabase.from("planes").insert([insert]).select().single();

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
