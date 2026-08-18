import { buildXlsxBuffer, xlsxResponseHeaders } from "@/lib/excel/export";
import { PRODUCTOS_TEMPLATE_ROW } from "@/lib/imports/productos-importer";

export async function GET() {
  const cols = Object.keys(PRODUCTOS_TEMPLATE_ROW).map((k) => ({
    header: k,
    value: (r: typeof PRODUCTOS_TEMPLATE_ROW) => r[k as keyof typeof PRODUCTOS_TEMPLATE_ROW],
    width: 18,
  }));
  const buf = buildXlsxBuffer([PRODUCTOS_TEMPLATE_ROW], cols, { sheetName: "Productos" });
  return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders("plantilla-productos") });
}
