/**
 * Util generico para exportar a Excel (.xlsx).
 *
 * Recibe headers (titulos legibles) y filas, construye un workbook con una
 * hoja y devuelve un Buffer listo para servir en una Response.
 *
 * No depende de Campañas — usa la libreria xlsx por su cuenta. NO se debe
 * tocar src/lib/campaigns/campaign-import-service.ts.
 */
import * as XLSX from "xlsx";

export interface ExportColumn<T> {
  header: string;
  /** Funcion para extraer el valor de la fila (string | number | null | undefined | boolean | Date). */
  value: (row: T) => string | number | boolean | null | undefined | Date;
  /** Ancho aproximado en caracteres (opcional). */
  width?: number;
}

export interface ExportOptions {
  /** Nombre de la hoja dentro del libro. Por defecto "Datos". */
  sheetName?: string;
  /** Nombre del archivo sugerido (sin extension). */
  filename?: string;
}

export function buildXlsxBuffer<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  opts: ExportOptions = {}
): Buffer {
  const sheetName = (opts.sheetName ?? "Datos").slice(0, 31); // limite Excel
  // Header row
  const headerRow = columns.map((c) => c.header);
  // Data rows
  const dataRows = rows.map((row) =>
    columns.map((c) => {
      const v = c.value(row);
      if (v == null) return "";
      if (v instanceof Date) return v;
      return v;
    })
  );
  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
  if (columns.some((c) => c.width)) {
    ws["!cols"] = columns.map((c) => ({ wch: c.width ?? 16 }));
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return buf;
}

/** Spec de una hoja ya materializada (header + filas como matriz). */
export interface XlsxSheetSpec {
  sheetName: string;
  aoa: (string | number | boolean | Date)[][];
  colWidths?: number[];
}

/** Convierte filas tipadas + columnas en una hoja (header incluido). */
export function sheetFromRows<T>(
  sheetName: string,
  rows: T[],
  columns: ExportColumn<T>[]
): XlsxSheetSpec {
  const header = columns.map((c) => c.header);
  const data = rows.map((row) =>
    columns.map((c) => {
      const v = c.value(row);
      if (v == null) return "";
      return v;
    })
  );
  return {
    sheetName: sheetName.slice(0, 31),
    aoa: [header, ...data],
    colWidths: columns.map((c) => c.width ?? 16),
  };
}

/** Construye un workbook con varias hojas y devuelve el Buffer. */
export function buildXlsxBufferSheets(sheets: XlsxSheetSpec[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.aoa);
    if (s.colWidths && s.colWidths.length > 0) {
      ws["!cols"] = s.colWidths.map((w) => ({ wch: w }));
    }
    XLSX.utils.book_append_sheet(wb, ws, s.sheetName.slice(0, 31));
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function xlsxResponseHeaders(filename: string): HeadersInit {
  const safe = filename.replace(/[^a-zA-Z0-9_.-]+/g, "_");
  return {
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${safe}.xlsx"`,
    "Cache-Control": "no-store",
  };
}

/** Helper: yyyy-mm-dd-HHMM para sufijos de nombre de archivo. */
export function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
