import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getFacturacionModo, getAutoimpresor } from "@/lib/facturacion/server/facturacion-modo-pg";
import {
  emitirFacturaAutoimpresor,
  liquidarIva,
  EmisionBloqueadaError,
  type LiquidacionIva,
} from "@/lib/facturacion/autoimpresor/emitir-factura";
import { renderFacturaTicketHTML } from "@/lib/facturacion/autoimpresor/render-factura-ticket";
import { EMPRESA_DOC } from "@/lib/documentos/membrete";

/**
 * GET /api/ventas/[id]/factura?w=58|80&auto=1&preview=1
 *
 * Devuelve la FACTURA AUTOIMPRESOR de la venta en formato TICKET (58/80 mm), con
 * el mismo aspecto que el ticket interno pero con los datos fiscales (timbrado,
 * número correlativo, liquidación de IVA).
 *
 * - modo=autoimpresor + config activa + rango disponible → EMITE número real
 *   (idempotente por venta) y renderiza la factura legal.
 * - En otro caso (o ?preview=1) → BORRADOR con aviso "SIN VALIDEZ FISCAL", sin
 *   consumir la numeración. Sirve para ver el formato antes de activar.
 *
 * No toca SIFEN ni el ticket interno.
 */

interface ItemRow {
  producto_nombre: string;
  cantidad: number | string;
  precio_venta: number | string;
  total_linea: number | string;
  monto_iva: number | string;
  tipo_iva: string;
}

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  const { id } = await ctxParams.params;
  const url = new URL(request.url);
  const forcePreview = url.searchParams.get("preview") === "1";
  const autoPrint = url.searchParams.get("auto") === "1";
  const widthMm: 58 | 80 = url.searchParams.get("w") === "58" ? 58 : 80;
  const origin = url.origin;

  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });
  const empresaId = ctx.auth.empresa_id;
  const schema = await fetchDataSchemaForEmpresaId(empresaId);

  // Venta
  const vQ = await ctx.supabase
    .from("ventas")
    .select("id, numero_control, fecha, tipo_venta, cliente_id")
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (vQ.error) return new NextResponse(`Error: ${vQ.error.message}`, { status: 500 });
  if (!vQ.data) return new NextResponse("Venta no encontrada", { status: 404 });
  const venta = vQ.data as {
    id: string; numero_control: string; fecha: string; tipo_venta: string | null; cliente_id: string | null;
  };

  // Ítems
  const iQ = await ctx.supabase
    .from("ventas_items")
    .select("producto_nombre, cantidad, precio_venta, total_linea, monto_iva, tipo_iva")
    .eq("venta_id", id)
    .eq("empresa_id", empresaId);
  if (iQ.error) return new NextResponse(`Error items: ${iQ.error.message}`, { status: 500 });
  const itemsRaw = (iQ.data ?? []) as unknown as ItemRow[];
  const items = itemsRaw.map((it) => ({
    cantidad: Number(it.cantidad),
    descripcion: it.producto_nombre,
    precioUnitario: Number(it.precio_venta),
    totalLinea: Number(it.total_linea),
    tipo_iva: it.tipo_iva,
  }));

  // Cliente
  let cliente: { nombre: string; ruc: string | null } | null = null;
  if (venta.cliente_id) {
    const cQ = await ctx.supabase
      .from("clientes")
      .select("empresa, nombre, nombre_contacto, ruc, documento")
      .eq("id", venta.cliente_id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    const c = cQ.data as Record<string, string | null> | null;
    if (c) {
      const s = (v: string | null | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null);
      cliente = {
        nombre: s(c.empresa) || s(c.nombre_contacto) || s(c.nombre) || "SIN NOMBRE",
        ruc: s(c.ruc) || s(c.documento),
      };
    }
  }

  // Config fiscal
  const [modo, cfg] = await Promise.all([
    getFacturacionModo(schema, empresaId),
    getAutoimpresor(schema, empresaId),
  ]);

  const emisor = {
    razon_social: cfg.razon_social_emisor?.trim() || EMPRESA_DOC.nombre,
    ruc: cfg.ruc_emisor?.trim() || "—",
    direccion: cfg.direccion_matriz?.trim() || "",
    telefono: cfg.telefono?.trim() || EMPRESA_DOC.telefono || "",
    logoUrl: EMPRESA_DOC.logoUrl,
  };

  const puedeEmitir =
    !forcePreview &&
    modo.modo === "autoimpresor" &&
    cfg.activo === true &&
    !!cfg.timbrado_numero &&
    !!cfg.establecimiento_codigo &&
    !!cfg.punto_expedicion_codigo &&
    cfg.numero_inicial != null &&
    cfg.numero_final != null &&
    cfg.numero_actual != null;

  function ticket(opts: {
    borrador: boolean;
    motivo?: string | null;
    numeroCompleto: string;
    fechaEmision: string;
    condicion: "contado" | "credito";
    timbrado: { numero: string; inicio: string | null; fin: string | null };
    liq: LiquidacionIva;
  }) {
    const html = renderFacturaTicketHTML({
      borrador: opts.borrador,
      motivoBorrador: opts.motivo,
      widthMm,
      emisor,
      origin,
      timbrado: opts.timbrado,
      numeroCompleto: opts.numeroCompleto,
      fechaEmision: opts.fechaEmision,
      condicion: opts.condicion,
      cliente,
      ventaNumeroControl: venta.numero_control,
      items,
      liq: opts.liq,
      autoPrint,
    });
    return new NextResponse(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (puedeEmitir) {
    try {
      const f = await emitirFacturaAutoimpresor(schema, empresaId, id);
      return ticket({
        borrador: false,
        numeroCompleto: f.numero_completo,
        fechaEmision: f.emitida_at,
        condicion: f.condicion,
        timbrado: { numero: f.timbrado_numero, inicio: f.timbrado_inicio_vigencia, fin: f.timbrado_fin_vigencia },
        liq: { gravado_10: f.gravado_10, iva_10: f.iva_10, gravado_5: f.gravado_5, iva_5: f.iva_5, exentas: f.exentas, total: f.total },
      });
    } catch (e) {
      if (!(e instanceof EmisionBloqueadaError)) throw e;
      // cae a borrador con el motivo
      return borrador(e.message);
    }
  }

  function borrador(motivo: string) {
    const est = cfg.establecimiento_codigo?.trim() || "001";
    const punto = cfg.punto_expedicion_codigo?.trim() || "002";
    return ticket({
      borrador: true,
      motivo,
      numeroCompleto: `${est.padStart(3, "0").slice(-3)}-${punto.padStart(3, "0").slice(-3)}-XXXXXXX`,
      fechaEmision: venta.fecha,
      condicion: String(venta.tipo_venta).toUpperCase() === "CREDITO" ? "credito" : "contado",
      timbrado: { numero: cfg.timbrado_numero?.trim() || "—", inicio: cfg.timbrado_inicio_vigencia, fin: cfg.timbrado_fin_vigencia },
      liq: liquidarIva(itemsRaw),
    });
  }

  const motivo =
    modo.modo !== "autoimpresor"
      ? "El modo de facturación no es autoimpresor."
      : cfg.activo !== true
        ? "El autoimpresor no está activo todavía."
        : "Falta cargar el número actual del timbrado.";
  return borrador(forcePreview ? "Vista previa del formato." : motivo);
}
