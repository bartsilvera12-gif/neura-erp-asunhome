/** Valores permitidos en POST /api/facturas (body.tipo). */
export const FACTURA_POST_TIPOS = ["contado", "credito", "suscripcion"] as const;
export type FacturaPostTipo = (typeof FACTURA_POST_TIPOS)[number];

/**
 * Valida `tipo` del body: solo contado | credito | suscripcion (minúsculas).
 * No hay fallback silencioso a credito.
 */
/** Descripción de línea por defecto cuando el cliente no envía `descripcion_linea` (SIFEN exige al menos un ítem). */
export function descripcionLineaFacturaPorDefecto(tipo: FacturaPostTipo): string {
  if (tipo === "contado") return "Venta al contado";
  if (tipo === "suscripcion") return "Suscripción";
  return "Venta a crédito";
}

export function parseFacturaPostTipo(tipo: unknown): { ok: true; tipo: FacturaPostTipo } | { ok: false; error: string } {
  if (tipo === null || tipo === undefined) {
    return {
      ok: false,
      error:
        'El campo "tipo" es obligatorio. Valores permitidos: contado, credito, suscripcion.',
    };
  }
  if (typeof tipo !== "string") {
    return {
      ok: false,
      error: `El campo "tipo" debe ser un string. Recibido: ${typeof tipo}. Permitidos: contado, credito, suscripcion.`,
    };
  }
  const normalized = tipo.trim().toLowerCase();
  if (normalized === "") {
    return {
      ok: false,
      error:
        'El campo "tipo" no puede estar vacío. Valores permitidos: contado, credito, suscripcion.',
    };
  }
  if (normalized === "contado" || normalized === "credito" || normalized === "suscripcion") {
    return { ok: true, tipo: normalized };
  }
  return {
    ok: false,
    error: `tipo inválido: "${tipo.trim()}". Valores permitidos: contado, credito, suscripcion.`,
  };
}
