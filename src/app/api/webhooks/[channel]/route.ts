import { NextRequest, NextResponse } from "next/server";
import { isChatChannelType } from "@/lib/chat/incoming-message-service";
import {
  handleWhatsAppWebhookGet,
  handleWhatsAppWebhookPost,
} from "@/lib/chat/webhooks/meta-whatsapp-webhook-handlers";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ channel: string }> };

export async function GET(request: NextRequest, ctx: RouteCtx) {
  const { channel } = await ctx.params;
  const ch = channel?.trim().toLowerCase() ?? "";
  if (ch === "whatsapp") {
    return handleWhatsAppWebhookGet(request);
  }
  if (!isChatChannelType(ch)) {
    return NextResponse.json({ ok: false, error: "Canal desconocido" }, { status: 404 });
  }
  return NextResponse.json(
    { ok: false, error: `Verificación GET no implementada para el canal "${ch}"` },
    { status: 501 }
  );
}

export async function POST(request: NextRequest, ctx: RouteCtx) {
  const { channel } = await ctx.params;
  const ch = channel?.trim().toLowerCase() ?? "";
  if (ch === "whatsapp") {
    return handleWhatsAppWebhookPost(request);
  }
  if (!isChatChannelType(ch)) {
    return NextResponse.json({ ok: false, error: "Canal desconocido" }, { status: 404 });
  }
  return NextResponse.json(
    {
      ok: false,
      error: `Webhook entrante para "${ch}" aún no configurado. Solo WhatsApp está activo.`,
    },
    { status: 501 }
  );
}
