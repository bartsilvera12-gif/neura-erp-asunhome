import type { Pool } from "pg";
import {
  SORTEO_COMPROBANTE_ESTADO_VALIDACION_FIELD,
  SORTEO_COMPROBANTE_MOTIVO_VALIDACION_FIELD,
  type ComprobanteValidacionListRow,
} from "@/lib/chat/comprobante-validation-types";
import { quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";

function isoPg(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapRowToComprobanteListRow(row: Record<string, unknown>): ComprobanteValidacionListRow {
  return {
    id: String(row.id ?? ""),
    estado_validacion: String(row.estado_validacion ?? ""),
    motivo_validacion: row.motivo_validacion != null ? String(row.motivo_validacion) : null,
    comprobante_url: row.comprobante_url != null ? String(row.comprobante_url) : null,
    sorteo_entrada_id: row.sorteo_entrada_id != null ? String(row.sorteo_entrada_id) : null,
    manual_approval_at: row.manual_approval_at != null ? isoPg(row.manual_approval_at) : null,
    flow_code: String(row.flow_code ?? ""),
    created_at: isoPg(row.created_at),
    ocr_referencia: row.ocr_referencia != null ? String(row.ocr_referencia) : null,
    ocr_monto: row.ocr_monto != null ? String(row.ocr_monto) : null,
    monto_validacion_esperado_gs: numOrNull(row.monto_validacion_esperado_gs),
    monto_validacion_ocr_gs: numOrNull(row.monto_validacion_ocr_gs),
    monto_validacion_diferencia_gs: numOrNull(row.monto_validacion_diferencia_gs),
    monto_validacion_status: row.monto_validacion_status != null ? String(row.monto_validacion_status) : null,
    bank_val_titular_esperado: row.bank_val_titular_esperado != null ? String(row.bank_val_titular_esperado) : null,
    bank_val_cuenta_esperada: row.bank_val_cuenta_esperada != null ? String(row.bank_val_cuenta_esperada) : null,
    bank_val_alias_esperado: row.bank_val_alias_esperado != null ? String(row.bank_val_alias_esperado) : null,
    bank_val_titular_ocr: row.bank_val_titular_ocr != null ? String(row.bank_val_titular_ocr) : null,
    bank_val_cuenta_ocr: row.bank_val_cuenta_ocr != null ? String(row.bank_val_cuenta_ocr) : null,
    bank_val_alias_ocr: row.bank_val_alias_ocr != null ? String(row.bank_val_alias_ocr) : null,
    bank_val_coincidencias: numOrNull(row.bank_val_coincidencias),
    bank_val_min_requeridas: numOrNull(row.bank_val_min_requeridas),
    bank_val_status: row.bank_val_status != null ? String(row.bank_val_status) : null,
  };
}

function isPgUndefinedColumn(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  if (e?.code === "42703") return true;
  return /column .* does not exist/i.test(String(e?.message ?? ""));
}

const COLS_FULL = `
  id, estado_validacion, motivo_validacion, comprobante_url, flow_code, created_at,
  sorteo_entrada_id, manual_approval_at,
  ocr_referencia, ocr_monto,
  monto_validacion_esperado_gs, monto_validacion_ocr_gs, monto_validacion_diferencia_gs, monto_validacion_status,
  bank_val_titular_esperado, bank_val_cuenta_esperada, bank_val_alias_esperado,
  bank_val_titular_ocr, bank_val_cuenta_ocr, bank_val_alias_ocr,
  bank_val_coincidencias, bank_val_min_requeridas, bank_val_status
`;

/** Sin columnas datos bancarios (tenants sin migración 20260403100000). */
const COLS_MONTO_ONLY = `
  id, estado_validacion, motivo_validacion, comprobante_url, flow_code, created_at,
  sorteo_entrada_id,
  ocr_referencia, ocr_monto,
  monto_validacion_esperado_gs, monto_validacion_ocr_gs, monto_validacion_diferencia_gs, monto_validacion_status
`;

/** Mínimo para UI básica (tenants muy viejos). */
const COLS_MIN = `
  id, estado_validacion, motivo_validacion, comprobante_url, flow_code, created_at,
  sorteo_entrada_id,
  ocr_referencia, ocr_monto
`;

export async function pgConversationBelongsToEmpresa(
  pool: Pool,
  schema: string,
  empresaId: string,
  conversationId: string
): Promise<boolean> {
  const qt = quoteSchemaTable(schema, "chat_conversations");
  const r = await pool.query(
    `SELECT 1 AS one FROM ${qt} WHERE id = $1::uuid AND empresa_id = $2::uuid LIMIT 1`,
    [conversationId.trim(), empresaId]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function pgFetchComprobanteValidacionesForConversation(
  pool: Pool,
  schema: string,
  empresaId: string,
  conversationId: string
): Promise<ComprobanteValidacionListRow[]> {
  const qt = quoteSchemaTable(schema, "chat_comprobante_validaciones");
  const cid = conversationId.trim();
  const baseWhere = `conversation_id = $1::uuid AND empresa_id = $2::uuid`;

  const trySelect = async (cols: string): Promise<ComprobanteValidacionListRow[]> => {
    const q = `
      SELECT ${cols}
      FROM ${qt}
      WHERE ${baseWhere}
      ORDER BY created_at DESC
    `;
    const r = await pool.query(q, [cid, empresaId]);
    return (r.rows ?? []).map((row) => mapRowToComprobanteListRow(row as Record<string, unknown>));
  };

  try {
    return await trySelect(COLS_FULL);
  } catch (e) {
    if (!isPgUndefinedColumn(e)) throw e;
  }
  try {
    return await trySelect(COLS_MONTO_ONLY);
  } catch (e) {
    if (!isPgUndefinedColumn(e)) throw e;
  }
  return trySelect(COLS_MIN);
}

type ValidacionApproveRow = {
  id: string;
  conversation_id: string;
  flow_code: string;
  flow_session_id: string;
};

export async function pgApproveComprobanteValidacion(
  pool: Pool,
  schema: string,
  empresaId: string,
  validacionId: string
): Promise<void> {
  const vt = quoteSchemaTable(schema, "chat_comprobante_validaciones");
  const id = validacionId.trim();

  const sel = await pool.query(
    `
    SELECT id::text, conversation_id::text, btrim(flow_code)::text AS flow_code, flow_session_id::text
    FROM ${vt}
    WHERE id = $1::uuid AND empresa_id = $2::uuid
    LIMIT 1
    `,
    [id, empresaId]
  );
  const raw = sel.rows?.[0] as Record<string, unknown> | undefined;
  if (!raw?.conversation_id || !raw.flow_session_id || raw.flow_code == null) {
    throw new Error("Validación no encontrada");
  }

  const r: ValidacionApproveRow = {
    id: String(raw.id ?? ""),
    conversation_id: String(raw.conversation_id),
    flow_code: String(raw.flow_code ?? ""),
    flow_session_id: String(raw.flow_session_id),
  };

  const now = new Date().toISOString();
  await pool.query(
    `
    UPDATE ${vt}
    SET estado_validacion = 'valido',
        motivo_validacion = 'aprobado_manual_erp',
        updated_at = $3::timestamptz
    WHERE id = $1::uuid AND empresa_id = $2::uuid
    `,
    [id, empresaId, now]
  );

  const dt = quoteSchemaTable(schema, "chat_flow_data");
  const upsertSql = `
    INSERT INTO ${dt} (empresa_id, conversation_id, flow_code, flow_session_id, field_name, field_value)
    VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6)
    ON CONFLICT (flow_session_id, field_name)
    DO UPDATE SET field_value = EXCLUDED.field_value
  `;

  await pool.query(upsertSql, [
    empresaId,
    r.conversation_id,
    r.flow_code.trim(),
    r.flow_session_id,
    SORTEO_COMPROBANTE_ESTADO_VALIDACION_FIELD,
    "valido",
  ]);
  await pool.query(upsertSql, [
    empresaId,
    r.conversation_id,
    r.flow_code.trim(),
    r.flow_session_id,
    SORTEO_COMPROBANTE_MOTIVO_VALIDACION_FIELD,
    "aprobado_manual_erp",
  ]);
}
