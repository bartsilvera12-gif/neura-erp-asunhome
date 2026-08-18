import { NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { listCompras } from "@/lib/compras/server/compras-pg";
import { buildXlsxBuffer, xlsxResponseHeaders, nowStamp } from "@/lib/excel/export";

export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const empresaId = ctx.auth.empresa_id;
  const schema = await fetchDataSchemaForEmpresaId(empresaId);

  try {
    const rows = await listCompras(schema, empresaId);
    const buf = buildXlsxBuffer(rows, [
      { header: "NUMERO_CONTROL", value: (r) => r.numero_control, width: 16 },
      { header: "FECHA", value: (r) => r.fecha ? new Date(r.fecha) : "", width: 18 },
      { header: "PROVEEDOR", value: (r) => r.proveedor_nombre, width: 30 },
      { header: "PRODUCTO", value: (r) => r.producto_nombre, width: 30 },
      { header: "CANTIDAD", value: (r) => Number(r.cantidad), width: 10 },
      { header: "MONEDA", value: (r) => r.moneda, width: 8 },
      { header: "TIPO_CAMBIO", value: (r) => Number(r.tipo_cambio), width: 10 },
      { header: "COSTO_UNITARIO_ORIGINAL", value: (r) => Number(r.costo_unitario_original), width: 14 },
      { header: "COSTO_UNITARIO_PYG", value: (r) => Number(r.costo_unitario), width: 14 },
      { header: "IVA_TIPO", value: (r) => r.iva_tipo, width: 8 },
      { header: "SUBTOTAL", value: (r) => Number(r.subtotal), width: 14 },
      { header: "MONTO_IVA", value: (r) => Number(r.monto_iva), width: 14 },
      { header: "TOTAL", value: (r) => Number(r.total), width: 14 },
      { header: "PRECIO_VENTA", value: (r) => Number(r.precio_venta), width: 14 },
      { header: "MARGEN_VENTA", value: (r) => r.margen_venta != null ? Number(r.margen_venta) : "", width: 10 },
      { header: "TIPO_PAGO", value: (r) => r.tipo_pago, width: 10 },
      { header: "PLAZO_DIAS", value: (r) => r.plazo_dias ?? "", width: 8 },
      { header: "NRO_TIMBRADO", value: (r) => r.nro_timbrado, width: 18 },
      { header: "ESTADO", value: (r) => r.estado, width: 10 },
      { header: "USUARIO", value: (r) => r.usuario_nombre ?? "", width: 24 },
    ], { sheetName: "Compras" });

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: xlsxResponseHeaders(`compras-${nowStamp()}`),
    });
  } catch (err) {
    console.error("[/api/compras/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
