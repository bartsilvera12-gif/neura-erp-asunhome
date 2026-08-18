/**
 * Sistema de Webhooks para integraciones externas (n8n, Zapier, etc.).
 * Envía POST a WEBHOOK_URL cuando se emiten eventos.
 */

import type { EventType } from "./events";

export type WebhookResult = {
  sent: boolean;
  statusCode?: number;
  error?: string;
};

/**
 * Envía un webhook HTTP POST con el evento y payload.
 * Requiere WEBHOOK_URL en variables de entorno.
 */
export async function sendWebhook(event: EventType, payload: Record<string, unknown>): Promise<WebhookResult> {
  const url = process.env.WEBHOOK_URL;

  if (!url?.trim()) {
    console.warn("[Webhook] WEBHOOK_URL no configurada. Agregá WEBHOOK_URL en Vercel → Settings → Environment Variables");
    return { sent: false, error: "WEBHOOK_URL no configurada" };
  }

  const body = {
    event,
    payload,
    source: "neura_erp",
    timestamp: new Date().toISOString(),
  };

  try {
    console.log("[Webhook] Enviando a:", url.replace(/\/[^/]+$/, "/***"));
    console.log("[Webhook] Evento:", event);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[Webhook] Error HTTP", res.status, text);
      return { sent: false, statusCode: res.status, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    console.log("[Webhook] OK - Status", res.status);
    return { sent: true, statusCode: res.status };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Webhook] Error de red:", msg);
    return { sent: false, error: msg };
  }
}
