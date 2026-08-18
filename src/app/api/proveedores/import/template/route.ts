import { buildXlsxBuffer, xlsxResponseHeaders } from "@/lib/excel/export";
import { PROVEEDORES_TEMPLATE_ROW } from "@/lib/imports/proveedores-importer";

export async function GET() {
  const cols = Object.keys(PROVEEDORES_TEMPLATE_ROW).map((k) => ({
    header: k,
    value: (r: typeof PROVEEDORES_TEMPLATE_ROW) => r[k as keyof typeof PROVEEDORES_TEMPLATE_ROW],
    width: 22,
  }));
  const buf = buildXlsxBuffer([PROVEEDORES_TEMPLATE_ROW], cols, { sheetName: "Proveedores" });
  return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders("plantilla-proveedores") });
}
