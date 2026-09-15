/**
 * Factura PREIMPRESA de ASUNHOME: imprime SOLO los datos variables encima de la
 * hoja física preimpresa (216 × 330 mm, 3 copias: Original/Duplicado/Triplicado).
 *
 * GET /api/ventas/[id]/factura-preimpresa
 *   (por defecto) → PDF de 216×330 mm exactos, listo para imprimir a "Tamaño real"
 *                   sin que el navegador lo encoja.
 *   ?calibrar=1   → modo calibración (solo dev): HTML con la plantilla de fondo.
 *
 * Reutiliza la misma obtención de datos que el comprobante A4. NO toca lógica de
 * venta/stock/caja/numeración/impuestos: es exclusivamente maquetación.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import {
  renderFacturaPreimpresa,
  type FacturaPreimpresaData,
  type FacturaPreimpresaItem,
} from "@/lib/facturacion/preimpresa/factura-preimpresa-layout";
import { renderFacturaPreimpresaPdf } from "@/lib/facturacion/preimpresa/factura-preimpresa-pdf";
import { numeroALetras } from "@/lib/documentos/numero-a-letras";

/** Fecha corta dd/mm/aaaa forzada a hora de Paraguay (UTC-3). */
function fechaCorta(iso: string): string {
  try {
    const d = new Date(iso);
    const py = new Date(d.getTime() - 3 * 60 * 60 * 1000);
    const dd = String(py.getUTCDate()).padStart(2, "0");
    const mm = String(py.getUTCMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${py.getUTCFullYear()}`;
  } catch {
    return "";
  }
}

function metodoLabel(m: string | null | undefined): string {
  switch (m) {
    case "efectivo": return "EFECTIVO";
    case "transferencia": return "TRANSFERENCIA";
    case "tarjeta": return "TARJETA";
    case "mixto": return "MIXTO";
    default: return String(m ?? "").toUpperCase();
  }
}

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id: ventaId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return new NextResponse("Unauthorized", { status: 401 });
    const sb = ctx.supabase;
    const empresaId = ctx.auth.empresa_id;

    const url = new URL(request.url);
    const calibrar = url.searchParams.get("calibrar") === "1";
    const ver = url.searchParams.get("ver") === "1";

    // 1) Venta
    const { data: venta } = await sb
      .from("ventas")
      .select("id, numero_control, fecha, subtotal, monto_iva, total, tipo_venta, plazo_dias, metodo_pago, cliente_id, nota_remision_numero, genera_nota_remision, observaciones, estado")
      .eq("id", ventaId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!venta) return new NextResponse("Venta no encontrada", { status: 404 });
    const v = venta as Record<string, unknown>;

    // 2) Ítems
    const { data: items } = await sb
      .from("ventas_items")
      .select("producto_nombre, sku, cantidad, precio_venta, tipo_iva, subtotal, monto_iva, total_linea")
      .eq("venta_id", ventaId)
      .eq("empresa_id", empresaId);

    // 2b) Pagos (para forma de pago)
    const { data: pagosRows } = await sb
      .from("ventas_pagos_detalle")
      .select("metodo_pago, monto")
      .eq("venta_id", ventaId)
      .eq("empresa_id", empresaId);
    const pagos = (pagosRows ?? []) as Array<{ metodo_pago: string; monto: number | string }>;

    // 3) Cliente (opcional)
    let cliente: { nombre: string; ruc: string; direccion: string; telefono: string } = { nombre: "", ruc: "", direccion: "", telefono: "" };
    if (v.cliente_id) {
      const { data: c } = await sb
        .from("clientes")
        .select("empresa, nombre_contacto, nombre, ruc, documento, direccion, telefono")
        .eq("empresa_id", empresaId)
        .eq("id", v.cliente_id as string)
        .maybeSingle();
      if (c) {
        const cc = c as Record<string, string | null>;
        cliente = {
          nombre: cc.empresa || cc.nombre_contacto || cc.nombre || "",
          ruc: cc.ruc || cc.documento || "",
          direccion: cc.direccion || "",
          telefono: (cc.telefono || "").trim(),
        };
      }
    }

    // 4) Ítems → columnas EXENTA / IVA 5% / IVA 10% (misma regla que comprobante-a4)
    const filas: FacturaPreimpresaItem[] = (items ?? []).map((it: Record<string, unknown>) => {
      const total = Number(it.total_linea ?? 0);
      const ivaTipo = String(it.tipo_iva ?? "10%");
      return {
        cantidad: Number(it.cantidad ?? 0),
        descripcion: String(it.producto_nombre ?? ""),
        precioUnitario: Number(it.precio_venta ?? 0),
        exenta: ivaTipo === "EXENTA" ? total : 0,
        iva5: ivaTipo === "5%" ? total : 0,
        iva10: ivaTipo === "10%" ? total : 0,
      };
    });

    const totExenta = filas.reduce((s, f) => s + f.exenta, 0);
    const totIva5 = filas.reduce((s, f) => s + f.iva5, 0);
    const totIva10 = filas.reduce((s, f) => s + f.iva10, 0);
    const totalPagar = totExenta + totIva5 + totIva10;
    // Liquidación del IVA (monto de impuesto incluido en cada tramo)
    const liq5 = Math.round((totIva5 / 1.05) * 0.05);
    const liq10 = Math.round((totIva10 / 1.1) * 0.1);
    const totalIva = liq5 + liq10;

    const notaRem = v.genera_nota_remision === true && v.nota_remision_numero
      ? String(v.nota_remision_numero)
      : "";
    const condicion: "CONTADO" | "CREDITO" = v.tipo_venta === "CREDITO" ? "CREDITO" : "CONTADO";
    const formaPago = pagos.length > 1 ? "MIXTO" : metodoLabel(String(v.metodo_pago ?? pagos[0]?.metodo_pago ?? ""));

    // Observación: se conserva la manual (si hay) y SE AGREGA el teléfono del
    // cliente (de su ficha), para que los choferes puedan contactarlo en la
    // entrega. No reemplaza la observación cargada.
    // NO se imprime la referencia interna de guarda ("Facturación de guarda
    // RES-…"): esa relación se mantiene solo en el registro de la venta para
    // trazabilidad, pero no debe salir en la factura.
    const obsPartes: string[] = [];
    const obsManual = String(v.observaciones ?? "")
      .replace(/facturaci[oó]n de guarda\s+RES-\d+/gi, "")
      .replace(/^[\s·,-]+|[\s·,-]+$/g, "")
      .trim();
    if (obsManual) obsPartes.push(obsManual);
    if (cliente.telefono) obsPartes.push(`Teléfono: ${cliente.telefono}`);
    const observacion = obsPartes.join(" · ");

    const data: FacturaPreimpresaData = {
      fecha: fechaCorta(String(v.fecha ?? "")),
      nombre: cliente.nombre,
      domicilio: cliente.direccion,
      observacion,
      condicion,
      ruc: cliente.ruc,
      formaPago,
      notaRemision: notaRem,
      // numeroFactura queda sin setear: la hoja ya viene numerada (ver CALIB).
      items: filas,
      totExenta, totIva5, totIva10,
      totalPagar,
      totalLetras: `${numeroALetras(totalPagar)} GUARANIES`,
      liq5, liq10, totalIva,
    };

    // Modo calibración (solo dev): HTML con la plantilla de fondo, para verificar
    // en pantalla. En uso real se devuelve un PDF a 216×330 mm exactos, que se
    // imprime a "Tamaño real" sin encogerse (a diferencia del HTML del navegador).
    if (calibrar) {
      const html = renderFacturaPreimpresa(data, { calibrar: true, ver, bgUrl: "/brand/factura-preimpresa-asunhome.png" });
      return new NextResponse(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    const numero = String(v.numero_control ?? "venta").replace(/[^A-Za-z0-9_-]/g, "");
    const pdf = await renderFacturaPreimpresaPdf(data);
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="factura-${numero}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[/api/ventas/[id]/factura-preimpresa]", err instanceof Error ? err.message : err);
    return new NextResponse("Error interno", { status: 500 });
  }
}
