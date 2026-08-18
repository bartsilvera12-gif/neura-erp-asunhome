import { buildXlsxBuffer, xlsxResponseHeaders } from "@/lib/excel/export";
import { UBICACIONES_TEMPLATE_ROW } from "@/lib/imports/catalogos-importer";

export async function GET() {
  const cols = Object.keys(UBICACIONES_TEMPLATE_ROW).map((k) => ({
    header: k,
    value: (r: typeof UBICACIONES_TEMPLATE_ROW) => r[k as keyof typeof UBICACIONES_TEMPLATE_ROW],
    width: 18,
  }));
  const buf = buildXlsxBuffer([UBICACIONES_TEMPLATE_ROW], cols, { sheetName: "Ubicaciones" });
  return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders("plantilla-ubicaciones") });
}
