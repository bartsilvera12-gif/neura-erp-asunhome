/**
 * Feature flag server-side del modulo de devoluciones de ventas.
 *
 *   DEVOLUCIONES_VENTAS_ENABLED=true   -> modulo habilitado
 *   (ausente | cualquier otro valor)   -> modulo DESHABILITADO (default seguro)
 *
 * - APIs: llamar `assertDevolucionesEnabled()` al inicio de cada handler.
 * - UI: se expone por GET /api/devoluciones/flag para ocultar botones y enlaces.
 *
 * Se lee en cada llamada (no se cachea en modulo) para que el rollback por
 * variable de entorno tenga efecto al reiniciar el proceso sin rebuild.
 */

export const DEVOLUCIONES_FLAG_ENV = "DEVOLUCIONES_VENTAS_ENABLED";

/** En Ferrecolor viene habilitado por defecto. Solo se apaga con DEVOLUCIONES_VENTAS_ENABLED=false. */
export function devolucionesEnabled(): boolean {
  const v = (process.env[DEVOLUCIONES_FLAG_ENV] ?? "").trim().toLowerCase();
  return v !== "false";
}

/** Error de modulo deshabilitado (las rutas lo traducen a HTTP 404). */
export class DevolucionesDeshabilitadasError extends Error {
  constructor() {
    super("El modulo de devoluciones no esta habilitado.");
    this.name = "DevolucionesDeshabilitadasError";
  }
}

/** Lanza si el modulo esta apagado. Usar al inicio de cada API de devoluciones. */
export function assertDevolucionesEnabled(): void {
  if (!devolucionesEnabled()) throw new DevolucionesDeshabilitadasError();
}
