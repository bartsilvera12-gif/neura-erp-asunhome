import { NextRequest, NextResponse } from "next/server";
import { saveProspectoFromWebhook } from "@/lib/crm/storage";
import { successResponse, errorResponse } from "@/lib/api/response";

/**
 * POST /api/crm/leads
 * Crea un lead desde webhook (WhatsApp, n8n, etc.).
 * Requiere autenticación por header X-Webhook-Secret.
 *
 * Body:
 * {
 *   empresa_id: string (uuid de la empresa)
 *   telefono: string (número del contacto)
 *   mensaje?: string (primer mensaje, se guarda como nota)
 *   contacto?: string (nombre, default "Contacto WhatsApp")
 *   empresa_nombre?: string (nombre empresa, default "Sin nombre")
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const secret = request.headers.get("x-webhook-secret");
    const expectedSecret = process.env.WEBHOOK_SECRET;

    if (!expectedSecret?.trim()) {
      return NextResponse.json(
        errorResponse("WEBHOOK_SECRET no configurado en el servidor"),
        { status: 500 }
      );
    }

    if (secret !== expectedSecret) {
      return NextResponse.json(errorResponse("No autorizado"), { status: 401 });
    }

    const body = await request.json();
    const { empresa_id, telefono, mensaje, contacto, empresa_nombre } = body;

    const empresaId = empresa_id?.trim() || process.env.CRM_WEBHOOK_EMPRESA_ID?.trim();
    if (!empresaId) {
      return NextResponse.json(
        errorResponse("empresa_id es obligatorio (o configurá CRM_WEBHOOK_EMPRESA_ID en Vercel)"),
        { status: 400 }
      );
    }

    if (!telefono?.trim()) {
      return NextResponse.json(
        errorResponse("telefono es obligatorio"),
        { status: 400 }
      );
    }

    const prospecto = await saveProspectoFromWebhook({
      empresa_id: empresaId,
      telefono: telefono.trim(),
      mensaje: mensaje?.trim(),
      contacto: contacto?.trim(),
      empresa_nombre: empresa_nombre?.trim(),
    });

    if (!prospecto) {
      return NextResponse.json(
        errorResponse("Error al crear el lead"),
        { status: 500 }
      );
    }

    return NextResponse.json(
      successResponse({
        id: prospecto.id,
        numero_control: prospecto.numero_control,
        mensaje: "Lead creado correctamente",
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
