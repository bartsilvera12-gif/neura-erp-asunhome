/**
 * Definición única de filas iniciales para `crm_etapas`.
 * La semilla perezosa (GET etapas / `ensureDefaultCrmEtapasPg`, etc.) solo llena
 * la tabla la primera vez; a partir de ahí la **fuente maestra** es
 * `crm_etapas` (editada en Configuración → CRM). Funnel y dashboard **leen**
 * esa tabla vía `GET /api/crm/etapas` — el dashboard no define etapas.
 */
export const CRM_ETAPAS_INICIALES = [
  { codigo: "LEAD", nombre: "Lead", color: "gray", orden: 1 },
  { codigo: "CONTACTADO", nombre: "Contactado", color: "blue", orden: 2 },
  { codigo: "NEGOCIACION", nombre: "Negociación", color: "amber", orden: 3 },
  { codigo: "GANADO", nombre: "Ganado", color: "green", orden: 4 },
  { codigo: "PERDIDO", nombre: "Perdido", color: "red", orden: 5 },
] as const;

function escapeSqlLiteral(s: string) {
  return s.replace(/'/g, "''");
}

/**
 * Bloque `VALUES` para `INSERT ... FROM (VALUES ...) v(codigo, nombre, color, orden)` en SQL.
 * Los códigos son fijos; el contenido de `CRM_ETAPAS_INICIALES` es el único origen.
 */
export function sqlCrmEtapasDefaultsValuesBlock(): string {
  return CRM_ETAPAS_INICIALES.map(
    (r) =>
      `('${r.codigo}'::text, '${escapeSqlLiteral(r.nombre)}'::text, '${r.color}'::text, ${r.orden})`
  ).join(",\n         ");
}
