import type { EstadoSifen, FacturaElectronicaDTO, SifenConsultaLoteUltimaPersistida } from "./types";

/** Mapea fila BD → DTO público (mismas columnas que expone la API SIFEN). */
export function toFacturaElectronicaDto(row: Record<string, unknown>): FacturaElectronicaDTO {
  return {
    id: String(row.id),
    empresa_id: String(row.empresa_id),
    factura_id: String(row.factura_id),
    estado_sifen: row.estado_sifen as EstadoSifen,
    cdc: row.cdc == null ? null : String(row.cdc),
    xml_path: row.xml_path == null ? null : String(row.xml_path),
    xml_firmado_path: row.xml_firmado_path == null ? null : String(row.xml_firmado_path),
    kuDE_url: row.kuDE_url == null ? null : String(row.kuDE_url),
    qr_data: row.qr_data == null ? null : String(row.qr_data),
    error: row.error == null ? null : String(row.error),
    sifen_d_prot_cons_lote:
      row.sifen_d_prot_cons_lote == null ? null : String(row.sifen_d_prot_cons_lote),
    sifen_ultima_respuesta_recibe_lote:
      row.sifen_ultima_respuesta_recibe_lote == null || typeof row.sifen_ultima_respuesta_recibe_lote !== "object"
        ? null
        : (row.sifen_ultima_respuesta_recibe_lote as Record<string, unknown>),
    sifen_ultima_respuesta_consulta_lote:
      row.sifen_ultima_respuesta_consulta_lote == null ||
      typeof row.sifen_ultima_respuesta_consulta_lote !== "object"
        ? null
        : (row.sifen_ultima_respuesta_consulta_lote as SifenConsultaLoteUltimaPersistida),
    sifen_aprobado_at: row.sifen_aprobado_at == null ? null : String(row.sifen_aprobado_at),
    sifen_cancelado_at: row.sifen_cancelado_at == null ? null : String(row.sifen_cancelado_at),
    sifen_cancelacion_motivo:
      row.sifen_cancelacion_motivo == null ? null : String(row.sifen_cancelacion_motivo),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}
