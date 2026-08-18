export type MonedaBase   = "GS" | "USD" | "BRL" | "ARS";
export type Timezone     = "America/Asuncion" | "America/Sao_Paulo" | "America/Buenos_Aires" | "America/Lima" | "America/Bogota";
export type IdiomaDefault = "es" | "en" | "pt";
export type FormatoFecha = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";

export interface ConfigGlobal {
  // ── Facturación ───────────────────────────────────────────────────
  prefijo_factura:            string;   // "FAC-", "FT-", etc.
  numeracion_inicial:         number;   // número desde el que arranca
  dias_vencimiento_default:   number;   // días de crédito por defecto
  interes_moratorio:          number;   // % anual sobre saldo vencido

  // ── Políticas del sistema ─────────────────────────────────────────
  porcentaje_descuento_maximo: number;  // % máx. de descuento permitido
  dias_retencion_cliente:      number;  // días antes de archivar inactivo
  max_clientes_por_empresa:    number;  // 0 = ilimitado
  max_usuarios_por_empresa:    number;  // 0 = ilimitado

  // ── Preferencias del sistema ──────────────────────────────────────
  moneda_base:     MonedaBase;
  timezone:        Timezone;
  idioma_default:  IdiomaDefault;
  formato_fecha:   FormatoFecha;

  // ── Metas / KPIs ─────────────────────────────────────────────────
  meta_ventas_mensuales:    number;  // GS — meta de ingresos por ventas al mes
  meta_clientes_nuevos:     number;  // cantidad — meta de nuevos clientes al mes
  meta_facturacion_mensual: number;  // GS — meta de facturación al mes
  meta_conversion_leads:    number;  // % (0-100) — tasa de conversión objetivo

  // ── Meta ──────────────────────────────────────────────────────────
  updated_at: string;   // ISO string
  updated_by?: string;  // usuario que realizó el último cambio
}
