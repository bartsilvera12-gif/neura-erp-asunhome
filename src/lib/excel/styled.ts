/**
 * Helpers de estilo para exports Excel lindos con exceljs.
 * Paleta ASUNHOME (teal). Reutilizable por cualquier reporte.
 */
import type ExcelJS from "exceljs";

export const COLORS = {
  accent: "FF3F8E91",      // teal header
  accentDark: "FF2C6A6D",
  headerText: "FFFFFFFF",
  zebra: "FFF1F5F5",       // fila alterna
  totalFill: "FFE3F0F0",
  border: "FFD8E1E2",
  ink: "FF1F2937",
};

export const FMT = {
  money: '#,##0',                 // Gs. sin decimales
  moneyGs: '"Gs. "#,##0',
  int: "#,##0",
  datetime: "dd/mm/yyyy hh:mm",
  date: "dd/mm/yyyy",
};

const thin = (color = COLORS.border) => ({ style: "thin" as const, color: { argb: color } });

/**
 * Título en la fila `row` (y, si hay subtítulo, en `row+1`) sobre `span` columnas.
 * Cada uno en su propia fila combinada — evita que Excel muestre el texto pegado/cortado.
 */
export function addTitle(ws: ExcelJS.Worksheet, row: number, span: number, titulo: string, subtitulo?: string) {
  ws.mergeCells(row, 1, row, span);
  const c = ws.getCell(row, 1);
  c.value = titulo;
  c.font = { name: "Calibri", size: 15, bold: true, color: { argb: COLORS.accentDark } };
  c.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(row).height = 24;

  if (subtitulo) {
    ws.mergeCells(row + 1, 1, row + 1, span);
    const s = ws.getCell(row + 1, 1);
    s.value = subtitulo;
    s.font = { name: "Calibri", size: 10, color: { argb: "FF6B7280" } };
    s.alignment = { vertical: "middle", horizontal: "left" };
    ws.getRow(row + 1).height = 16;
  }
}

/** Da formato de encabezado (fila `row`) a `cols` columnas: fondo teal, texto blanco, bordes. */
export function styleHeader(ws: ExcelJS.Worksheet, row: number, cols: number) {
  const r = ws.getRow(row);
  r.height = 22;
  for (let i = 1; i <= cols; i++) {
    const cell = r.getCell(i);
    cell.font = { bold: true, color: { argb: COLORS.headerText }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.accent } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { top: thin(), bottom: thin(COLORS.accentDark), left: thin(), right: thin() };
  }
}

/** Bordes finos + zebra en filas de datos [from, to] sobre `cols` columnas. */
export function styleBody(ws: ExcelJS.Worksheet, from: number, to: number, cols: number) {
  for (let row = from; row <= to; row++) {
    const zebra = (row - from) % 2 === 1;
    const r = ws.getRow(row);
    for (let i = 1; i <= cols; i++) {
      const cell = r.getCell(i);
      cell.border = { top: thin(), bottom: thin(), left: thin(), right: thin() };
      if (zebra) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.zebra } };
      if (!cell.alignment) cell.alignment = { vertical: "middle" };
    }
  }
}

/** Fila de totales resaltada (negrita, fondo, borde superior). */
export function styleTotals(ws: ExcelJS.Worksheet, row: number, cols: number) {
  const r = ws.getRow(row);
  r.height = 20;
  for (let i = 1; i <= cols; i++) {
    const cell = r.getCell(i);
    cell.font = { bold: true, color: { argb: COLORS.ink } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.totalFill } };
    cell.border = { top: { style: "medium", color: { argb: COLORS.accent } }, bottom: thin() };
  }
}
