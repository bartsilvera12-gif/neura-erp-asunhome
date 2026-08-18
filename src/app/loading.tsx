/**
 * Loading boundary global de Next.js.
 *
 * Devolvemos null intencionalmente: no queremos un overlay de carga entre
 * navegaciones (rompe la sensación de inmediatez con prefetch on hover).
 * La carga inicial del ERP la cubre ZentraLoader desde AuthGuard, y cada
 * módulo puede mostrar su propio skeleton local mientras espera datos.
 */
export default function Loading() {
  return null;
}
