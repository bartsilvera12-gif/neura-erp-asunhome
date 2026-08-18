import { buildXlsxBuffer, xlsxResponseHeaders } from "@/lib/excel/export";
import { CATEGORIAS_TEMPLATE_ROW } from "@/lib/imports/catalogos-importer";

export async function GET() {
  const cols = Object.keys(CATEGORIAS_TEMPLATE_ROW).map((k) => ({
    header: k,
    value: (r: typeof CATEGORIAS_TEMPLATE_ROW) => r[k as keyof typeof CATEGORIAS_TEMPLATE_ROW],
    width: 18,
  }));
  const buf = buildXlsxBuffer([CATEGORIAS_TEMPLATE_ROW], cols, { sheetName: "Categorias" });
  return new Response(new Uint8Array(buf), { status: 200, headers: xlsxResponseHeaders("plantilla-categorias") });
}
