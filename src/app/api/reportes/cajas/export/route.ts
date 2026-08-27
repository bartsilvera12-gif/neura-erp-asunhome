import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { getReporteCajas } from "@/lib/caja/server";
import { resolverRangoCajas } from "@/lib/caja/reporte-rango";
import { xlsxResponseHeaders } from "@/lib/excel/export";
import { addTitle, styleHeader, styleBody, styleTotals, FMT } from "@/lib/excel/styled";

export const runtime = "nodejs";

const ESTADO_LBL: Record<string, string> = { abierta: "Abierta", cerrada: "Cerrada", en_cierre: "En cierre" };

function fFecha(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(ymd)) return ymd;
  const [y, m, d] = ymd.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

type Caja = Record<string, unknown>;
const n = (v: unknown) => (v == null || v === "" ? null : Number(v));

type Col = {
  header: string;
  width: number;
  fmt?: string;
  total?: boolean;
  value: (c: Caja) => string | number | Date | null;
};

const COLS: Col[] = [
  { header: "Apertura", width: 18, fmt: FMT.datetime, value: (c) => (c.fecha_apertura ? new Date(String(c.fecha_apertura)) : null) },
  { header: "Cierre", width: 18, fmt: FMT.datetime, value: (c) => (c.fecha_cierre ? new Date(String(c.fecha_cierre)) : null) },
  { header: "Estado", width: 11, value: (c) => ESTADO_LBL[String(c.estado)] ?? String(c.estado ?? "") },
  { header: "Abrió", width: 20, value: (c) => String(c.abierta_por_nombre ?? "") },
  { header: "Cerró", width: 20, value: (c) => String(c.cerrada_por_nombre ?? "") },
  { header: "Monto apertura", width: 15, fmt: FMT.money, total: true, value: (c) => n(c.monto_apertura) },
  { header: "Ventas", width: 9, fmt: FMT.int, total: true, value: (c) => n(c.cantidad_ventas) },
  { header: "Total vendido", width: 15, fmt: FMT.money, total: true, value: (c) => n(c.total_vendido) },
  { header: "Efectivo", width: 14, fmt: FMT.money, total: true, value: (c) => n(c.total_efectivo) },
  { header: "Tarjeta", width: 13, fmt: FMT.money, total: true, value: (c) => n(c.total_tarjeta) },
  { header: "Transferencia", width: 14, fmt: FMT.money, total: true, value: (c) => n(c.total_transferencia) },
  { header: "Ingresos ef.", width: 13, fmt: FMT.money, total: true, value: (c) => n(c.ingresos_efectivo) },
  { header: "Egresos ef.", width: 13, fmt: FMT.money, total: true, value: (c) => n(c.egresos_efectivo) },
  { header: "Retiros ef.", width: 13, fmt: FMT.money, total: true, value: (c) => n(c.retiros_efectivo) },
  { header: "Efectivo esperado", width: 16, fmt: FMT.money, total: true, value: (c) => n(c.efectivo_esperado) },
  { header: "Contado al cierre", width: 16, fmt: FMT.money, total: true, value: (c) => n(c.monto_cierre_contado) },
  { header: "Diferencia", width: 14, fmt: FMT.money, total: true, value: (c) => n(c.diferencia) },
  { header: "Observación cierre", width: 34, value: (c) => String(c.observacion_cierre ?? "") },
];

/** GET /api/reportes/cajas/export?desde=YYYY-MM-DD&hasta=YYYY-MM-DD → XLSX estilizado. */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const rango = resolverRangoCajas(
      new URL(request.url).searchParams.get("desde"),
      new URL(request.url).searchParams.get("hasta")
    );
    const r = await getReporteCajas(ctx.supabase, ctx.auth.empresa_id, rango);
    const t = r.totales;
    const cajas = (r.cajas ?? []) as unknown as Caja[];

    const wb = new ExcelJS.Workbook();
    wb.creator = "ASUNHOME";
    wb.created = new Date();

    // ── Hoja 1: Cierres ──────────────────────────────────────────────────────
    const ws = wb.addWorksheet("Cierres", {
      views: [{ state: "frozen", ySplit: 3 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    COLS.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width;
      if (c.fmt) col.numFmt = c.fmt;
    });
    addTitle(ws, 1, COLS.length, "Cierres de caja", `Del ${fFecha(r.desde)} al ${fFecha(r.hasta)}`);
    COLS.forEach((c, i) => { ws.getCell(3, i + 1).value = c.header; });
    styleHeader(ws, 3, COLS.length);

    let row = 4;
    for (const caja of cajas) {
      COLS.forEach((c, i) => { ws.getCell(row, i + 1).value = c.value(caja); });
      row++;
    }
    const lastData = Math.max(4, row - 1);
    if (cajas.length > 0) styleBody(ws, 4, lastData, COLS.length);

    // Fila de totales (suma de columnas monetarias / de conteo).
    const totRow = cajas.length > 0 ? lastData + 1 : 4;
    ws.getCell(totRow, 1).value = "TOTALES";
    COLS.forEach((c, i) => {
      if (!c.total) return;
      const suma = cajas.reduce((s, caja) => s + (Number(c.value(caja)) || 0), 0);
      ws.getCell(totRow, i + 1).value = suma;
    });
    styleTotals(ws, totRow, COLS.length);
    if (cajas.length > 0) {
      ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: lastData, column: COLS.length } };
    }

    // ── Hoja 2: Resumen ──────────────────────────────────────────────────────
    const rs = wb.addWorksheet("Resumen");
    rs.getColumn(1).width = 30;
    rs.getColumn(2).width = 22;
    addTitle(rs, 1, 2, "Resumen de cierres de caja", `Del ${fFecha(r.desde)} al ${fFecha(r.hasta)}`);
    rs.getCell(3, 1).value = "Concepto";
    rs.getCell(3, 2).value = "Valor";
    styleHeader(rs, 3, 2);
    const resumen: [string, number | string, boolean][] = [
      ["Cantidad de cajas", t.cantidad_cajas, false],
      ["Cerradas", t.cajas_cerradas, false],
      ["Abiertas", t.cajas_abiertas, false],
      ["Total vendido", t.total_vendido, true],
      ["Total efectivo", t.total_efectivo, true],
      ["Total tarjeta", t.total_tarjeta, true],
      ["Total transferencia", t.total_transferencia, true],
      ["Cajas con diferencia", t.cajas_con_diferencia, false],
      ["Faltantes (acumulado)", t.faltantes, true],
      ["Sobrantes (acumulado)", t.sobrantes, true],
      ["Diferencia neta", t.total_diferencia, true],
    ];
    let rr = 4;
    for (const [concepto, valor, money] of resumen) {
      rs.getCell(rr, 1).value = concepto;
      const vc = rs.getCell(rr, 2);
      vc.value = valor;
      if (money) vc.numFmt = FMT.money;
      rr++;
    }
    styleBody(rs, 4, rr - 1, 2);
    rs.getColumn(2).alignment = { horizontal: "right" };

    const buf = await wb.xlsx.writeBuffer();
    return new Response(new Uint8Array(buf as ArrayBuffer), {
      status: 200,
      headers: xlsxResponseHeaders(`cajas-${r.desde}_${r.hasta}`),
    });
  } catch (err) {
    console.error("[/api/reportes/cajas/export]", err instanceof Error ? err.message : err);
    return new Response("No se pudo generar el Excel", { status: 500 });
  }
}
