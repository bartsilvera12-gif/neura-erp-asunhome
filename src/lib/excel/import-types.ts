export type PreviewAction = "INSERT" | "UPDATE" | "SKIP" | "ERROR";

export interface PreviewRow {
  row_number: number;
  action: PreviewAction;
  warnings: string[];
  errors: string[];
  /** Vista plana del payload (lo que se intentaria escribir). */
  data: Record<string, unknown>;
}

export interface PreviewSummary {
  total: number;
  insertar: number;
  actualizar: number;
  omitir: number;
  errores: number;
  warnings: number;
  /** Lista de nombres de categorias/proveedores/ubicaciones faltantes. */
  faltantes?: { categorias: string[]; proveedores: string[]; ubicaciones: string[] };
  /** Solo productos: impacto en stock. */
  movimientos_a_generar?: number;
  unidades_entrada?: number;
  unidades_salida?: number;
}

export interface PreviewResponse {
  summary: PreviewSummary;
  rows: PreviewRow[];
  headers: string[];
}

export interface CommitResultSummary {
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  warnings: number;
  movimientos_generados?: number;
  unidades_entrada?: number;
  unidades_salida?: number;
}

export interface CommitResponse {
  summary: CommitResultSummary;
  warnings: string[];
  errors: string[];
  audit_id?: string | null;
}
