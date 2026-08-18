import { NextResponse } from "next/server";
import { getUserAndEmpresa } from "@/lib/middleware/auth";
import { sendWebhook } from "@/lib/integrations/webhooks";
import { EVENT_TYPES } from "@/lib/integrations/events";

/**
 * GET /api/webhook-test
 * Envía un webhook de prueba para verificar la configuración.
 * Requiere autenticación.
 */
export async function GET(request: Request) {
  try {
    const auth = await getUserAndEmpresa(request);
    if (!auth) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const url = process.env.WEBHOOK_URL;
    if (!url?.trim()) {
      return NextResponse.json({
        ok: false,
        error: "WEBHOOK_URL no configurada",
        hint: "Agregá WEBHOOK_URL en Vercel → Settings → Environment Variables con la URL del webhook de n8n",
      });
    }

    const result = await sendWebhook(EVENT_TYPES.cliente_creado, {
      test: true,
      mensaje: "Webhook de prueba desde Neura ERP",
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: result.sent,
      statusCode: result.statusCode,
      error: result.error,
      url_configured: true,
      url_preview: url.replace(/\/[^/]+$/, "/***"),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
