/**
 * Sistema de eventos para integraciones externas.
 * Base para Webhooks y automatizaciones futuras.
 */

import { sendWebhook } from "./webhooks";

export const EVENT_TYPES = {
  cliente_creado: "cliente_creado",
  factura_creada: "factura_creada",
  pago_registrado: "pago_registrado",
  suscripcion_creada: "suscripcion_creada",
  suscripcion_plan_cambiada: "suscripcion_plan_cambiada",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

/**
 * Emite un evento. Registra en consola y envía webhook si WEBHOOK_URL está configurada.
 * No escribe en base de datos. Para trazas persistentes (p. ej. cambio de plan)
 * usar además `cliente_historial` desde la capa de negocio.
 */
export async function emitEvent(eventName: EventType, payload: Record<string, unknown>) {
  console.log(`[ERP Event] ${eventName}`, payload);

  const result = await sendWebhook(eventName, payload);

  if (result.sent) {
    console.log("[ERP Event] Webhook enviado OK");
  } else {
    console.warn("[ERP Event] Webhook no enviado:", result.error);
  }
}
