import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { computeReporteComisiones } from "@/lib/comisiones/reporte";
import { xlsxResponseHeaders } from "@/lib/excel/export";
import { addTitle, styleHeader, styleBody, styleTotals, FMT } from "@/lib/excel/styled";

export const runtime = "nodejs";

function fFecha(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(ymd)) return ymd;
  const [y, m, d] = ymd.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** GET /api/comisiones/reporte/export?desde&hasta → XLSX estilizado (ventas y comisión por vendedor). */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const sp = request.nextUrl.searchParams;
    const desde = sp.get("desde") || "";
    const hasta = sp.get("hasta") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
      return new Response("Faltan desde/hasta (YYYY-MM-DD).", { status: 400 });
    }
    const r = await computeReporteComisiones(ctx.supabase, ctx.auth.empresa_id, desde, hasta);

    type Fila = typeof r.por_vendedor[number];
    const COLS: { header: string; width: number; fmt?: string; value: (f: Fila) => string | number }[] = [
      { header: "Vendedor", width: 24, value: (f) => f.vendedor },
      { header: "Ventas", width: 10, fmt: FMT.int, value: (f) => f.cantidad_ventas },
      { header: "Total vendido", width: 18, fmt: FMT.money, value: (f) => f.total_vendido },
      { header: "% Comisión", width: 12, fmt: '0.00"%"', value: (f) => f.porcentaje },
      { header: "Comisión", width: 16, fmt: FMT.money, value: (f) => f.comision },
    ];

    const wb = new ExcelJS.Workbook();
    wb.creator = "ASUNHOME";
    const ws = wb.addWorksheet("Comisiones", {
      views: [{ state: "frozen", ySplit: 3 }],
      pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    COLS.forEach((c, i) => { const col = ws.getColumn(i + 1); col.width = c.width; if (c.fmt) col.numFmt = c.fmt; });
    addTitle(ws, 1, COLS.length, "Comisiones por vendedor", `Del ${fFecha(desde)} al ${fFecha(hasta)}`);
    COLS.forEach((c, i) => { ws.getCell(3, i + 1).value = c.header; });
    styleHeader(ws, 3, COLS.length);

    let row = 4;
    for (const f of r.por_vendedor) { COLS.forEach((c, i) => { ws.getCell(row, i + 1).value = c.value(f); }); row++; }
    const lastData = Math.max(4, row - 1);
    if (r.por_vendedor.length > 0) styleBody(ws, 4, lastData, COLS.length);

    const totRow = r.por_vendedor.length > 0 ? lastData + 1 : 4;
    ws.getCell(totRow, 1).value = "TOTAL";
    ws.getCell(totRow, 2).value = r.totales.cantidad_ventas;
    ws.getCell(totRow, 3).value = r.totales.total_vendido;
    ws.getCell(totRow, 5).value = r.totales.comision;
    styleTotals(ws, totRow, COLS.length);
    if (r.por_vendedor.length > 0) ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: lastData, column: COLS.length } };

    const buf = await wb.xlsx.writeBuffer();
    return new Response(new Uint8Array(buf as ArrayBuffer), {
      status: 200,
      headers: xlsxResponseHeaders(`comisiones-${desde}_${hasta}`),
    });
  } catch (err) {
    console.error("[/api/comisiones/reporte/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
