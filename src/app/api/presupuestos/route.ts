import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { crearPresupuesto, type PresupuestoItemInput } from "@/lib/presupuestos/server/presupuestos-pg";

const PRESU_COLS =
  "id, cliente_id, cliente_nombre, cliente_ruc, cliente_telefono, cliente_direccion, " +
  "numero_control, estado, moneda, subtotal, monto_iva, descuento_total, total, validez_dias, " +
  "fecha, fecha_vencimiento, forma_pago, plazo_entrega, observaciones, " +
  "convertido_pedido_id, convertido_venta_id, created_at, updated_at";

function asIva(v: unknown): "EXENTA" | "5%" | "10%" {
  return v === "EXENTA" || v === "5%" || v === "10%" ? v : "10%";
}

function parseItems(raw: unknown): PresupuestoItemInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: PresupuestoItemInput[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") return null;
    const r = x as Record<string, unknown>;
    const nombre = String(r.producto_nombre ?? "").trim();
    const cantidad = Number(r.cantidad);
    const precio = Number(r.precio_unitario);
    if (!nombre || !(cantidad > 0) || !(precio >= 0)) return null;
    out.push({
      producto_id: r.producto_id ? String(r.producto_id) : null,
      producto_nombre: nombre,
      sku: r.sku ? String(r.sku) : null,
      cantidad,
      unidad_medida: r.unidad_medida ? String(r.unidad_medida) : null,
      precio_unitario: precio,
      iva_tipo: asIva(r.iva_tipo),
      descuento: Math.max(0, Number(r.descuento) || 0),
    });
  }
  return out;
}

/** GET /api/presupuestos — listado (opcional ?estado=). */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const estado = new URL(request.url).searchParams.get("estado");
    let q = ctx.supabase
      .from("presupuestos")
      .select(PRESU_COLS)
      .eq("empresa_id", ctx.auth.empresa_id)
      .order("fecha", { ascending: false })
      .limit(500);
    if (estado) q = q.eq("estado", estado);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return NextResponse.json(successResponse({ presupuestos: data ?? [] }));
  } catch (err) {
    console.error("[/api/presupuestos GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los presupuestos."), { status: 500 });
  }
}

/** POST /api/presupuestos — crear. NO descuenta stock. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const items = parseItems(body.items);
    if (!items) {
      return NextResponse.json(errorResponse("El presupuesto debe tener al menos un ítem válido."), { status: 400 });
    }
    const clienteNombre = String(body.cliente_nombre ?? "").trim();
    if (!clienteNombre) {
      return NextResponse.json(errorResponse("El nombre del cliente es obligatorio."), { status: 400 });
    }
    const validezRaw = body.validez_dias;
    const validez =
      validezRaw === null || validezRaw === undefined || String(validezRaw).trim() === ""
        ? null
        : Math.max(0, parseInt(String(validezRaw), 10) || 0) || null;

    // Auto-alta de cliente cuando se escribe a mano (sin seleccionar del catalogo).
    // - Si el RUC coincide con uno existente, se linkea (evita duplicados).
    // - Si no, se crea un nuevo cliente con los datos del presupuesto.
    let clienteId: string | null = body.cliente_id ? String(body.cliente_id) : null;
    const rucInput = body.cliente_ruc ? String(body.cliente_ruc).trim() : "";
    const telInput = body.cliente_telefono ? String(body.cliente_telefono).trim() : "";
    const dirInput = body.cliente_direccion ? String(body.cliente_direccion).trim() : "";
    if (!clienteId) {
      if (rucInput) {
        const { data: existente } = await ctx.supabase
          .from("clientes")
          .select("id")
          .eq("empresa_id", ctx.auth.empresa_id)
          .eq("ruc", rucInput)
          .maybeSingle();
        if (existente?.id) clienteId = String(existente.id);
      }
      if (!clienteId) {
        const nombreCreador =
          (typeof ctx.auth.nombre === "string" ? ctx.auth.nombre.trim() : "") ||
          (typeof ctx.auth.user?.email === "string" ? ctx.auth.user.email.trim() : "") ||
          null;
        const { data: nuevo, error: eNuevo } = await ctx.supabase
          .from("clientes")
          .insert([{
            empresa_id: ctx.auth.empresa_id,
            created_by_user_id: ctx.auth.user.id,
            created_by_nombre: nombreCreador,
            tipo_cliente: "empresa",
            nombre: clienteNombre,
            nombre_contacto: clienteNombre,
            ruc: rucInput || null,
            telefono: telInput || null,
            direccion: dirInput || null,
            moneda_preferida: body.moneda === "USD" ? "USD" : "GS",
            estado: "activo",
            usa_nota_remision: false,
          }])
          .select("id")
          .single();
        if (eNuevo) throw new Error(`No se pudo crear el cliente: ${eNuevo.message}`);
        clienteId = String(nuevo.id);
      }
    }

    const { id, numero_control } = await crearPresupuesto(ctx.supabase, ctx.auth.empresa_id, {
      cliente_id: clienteId,
      cliente_nombre: clienteNombre,
      cliente_ruc: body.cliente_ruc ? String(body.cliente_ruc) : null,
      cliente_telefono: body.cliente_telefono ? String(body.cliente_telefono) : null,
      cliente_direccion: body.cliente_direccion ? String(body.cliente_direccion) : null,
      moneda: body.moneda === "USD" ? "USD" : "PYG",
      validez_dias: validez,
      forma_pago: body.forma_pago ? String(body.forma_pago) : null,
      plazo_entrega: body.plazo_entrega ? String(body.plazo_entrega) : null,
      observaciones: body.observaciones ? String(body.observaciones).slice(0, 4000) : null,
      items,
    });

    return NextResponse.json(successResponse({ id, numero_control }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo crear el presupuesto.";
    const status = /obligatorio|al menos un|inválid/i.test(msg) ? 400 : 500;
    console.error("[/api/presupuestos POST]", msg);
    return NextResponse.json(errorResponse(msg), { status });
  }
}
