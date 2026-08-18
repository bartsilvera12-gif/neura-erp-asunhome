/**
 * Permite usar endpoints SIFEN `*-test` (recibe-lote / consulta-lote en SET TEST)
 * aunque `empresa_sifen_config.ambiente` esté en `produccion`.
 *
 * Seguridad: solo activar en servidor con variable explícita; nunca inferir desde el cliente.
 *
 * @see ALLOW_TEST_MODE en documentación / despliegue.
 */
export function isExplicitSifenTestOverrideEnabled(): boolean {
  const raw = process.env.ALLOW_TEST_MODE?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}
