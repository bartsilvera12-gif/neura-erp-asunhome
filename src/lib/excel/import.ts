/**
 * Util de parseo de archivos Excel/CSV para importacion.
 * Devuelve filas como Record<NORMALIZED_HEADER, string>.
 */
import * as XLSX from "xlsx";

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5_000;

/** Normaliza un header: trim + upper + sin diacriticos + espacios->_  */
export function normalizeHeader(h: string): string {
  return String(h ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_]/g, "");
}

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, string>[];
}

export async function parseXlsxBuffer(buf: ArrayBuffer): Promise<ParsedSheet> {
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };
  const ws = wb.Sheets[sheetName];
  const rowsRaw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  if (rowsRaw.length === 0) return { headers: [], rows: [] };
  const rawHeaders = Object.keys(rowsRaw[0]);
  const headers = rawHeaders.map(normalizeHeader);
  const rows: Record<string, string>[] = rowsRaw.map((r) => {
    const out: Record<string, string> = {};
    rawHeaders.forEach((rh, i) => {
      const v = r[rh];
      out[headers[i]] = v == null ? "" : String(v);
    });
    return out;
  });
  return { headers, rows };
}

/** Lee `file` (Form-data File) y devuelve filas normalizadas. */
export async function parseUploadFile(file: File): Promise<ParsedSheet | { error: string }> {
  if (file.size > MAX_BYTES) {
    return { error: `Archivo demasiado grande (máx. ${Math.round(MAX_BYTES / 1024 / 1024)} MB).` };
  }
  try {
    const buf = await file.arrayBuffer();
    const parsed = await parseXlsxBuffer(buf);
    if (parsed.rows.length > MAX_ROWS) {
      return { error: `Demasiadas filas (máx. ${MAX_ROWS}).` };
    }
    return parsed;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo leer el archivo." };
  }
}
