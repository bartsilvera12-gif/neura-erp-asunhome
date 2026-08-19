/**
 * Lógica reutilizable: estado de facturación de un pedido (proyecto tipo 'pedido').
 *
 * Se persiste dentro de `proyectos.metadata` (JSONB) para no requerir tablas nuevas.
 * Estados:
 *   - sin marca            → el pedido aún no fue enviado a Caja.
 *   - 'pendiente_caja'     → enviado a Caja, esperando cobro/facturación. NO descuenta stock.
 *   - 'facturado'          → Caja confirmó la venta. Tiene venta_id. NO se puede facturar de nuevo.
 *
 * Pensado para ser reutilizable por otras instancias: la forma es genérica.
 */

export type FacturacionEstado = "pendiente_caja" | "facturado";

export interface FacturacionMeta {
  facturacion_estado?: FacturacionEstado;
  enviado_a_caja_at?: string;
  facturado_at?: string;
  venta_id?: string;
  venta_numero?: string;
}

/** Metadata genérica de un proyecto (incluye trazabilidad de origen + facturación). */
export type ProyectoMetadata = Record<string, unknown> & FacturacionMeta;

export function asMetadataObject(raw: unknown): ProyectoMetadata {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? ({ ...(raw as Record<string, unknown>) } as ProyectoMetadata)
    : {};
}

export function getFacturacionEstado(metadata: unknown): FacturacionEstado | null {
  const m = asMetadataObject(metadata);
  return m.facturacion_estado === "pendiente_caja" || m.facturacion_estado === "facturado"
    ? m.facturacion_estado
    : null;
}

export function estaFacturado(metadata: unknown): boolean {
  return getFacturacionEstado(metadata) === "facturado";
}

export function estaPendienteCaja(metadata: unknown): boolean {
  return getFacturacionEstado(metadata) === "pendiente_caja";
}

/** Devuelve la metadata mergeada para marcar el pedido como enviado a Caja. */
export function marcarEnviadoACaja(metadata: unknown, nowIso: string): ProyectoMetadata {
  return {
    ...asMetadataObject(metadata),
    facturacion_estado: "pendiente_caja",
    enviado_a_caja_at: nowIso,
  };
}

/** Devuelve la metadata mergeada para marcar el pedido como facturado por Caja. */
export function marcarFacturado(
  metadata: unknown,
  nowIso: string,
  ventaId: string,
  ventaNumero: string
): ProyectoMetadata {
  return {
    ...asMetadataObject(metadata),
    facturacion_estado: "facturado",
    facturado_at: nowIso,
    venta_id: ventaId,
    venta_numero: ventaNumero,
  };
}
