import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getContactHistory, normalizePhone } from "@/lib/chat/history-service";
import { getAuthWithRol } from "@/lib/middleware/auth";

export async function GET(
  request: Request,
  context: { params: Promise<{ phone: string }> }
) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }

    const params = await context.params;
    const phone = normalizePhone(params.phone ?? "");
    if (!phone) {
      return NextResponse.json({ ok: false, error: "phone inválido" }, { status: 400 });
    }

    const supabase = await getChatServiceClientForEmpresa(auth.empresa_id);
    const { data: contact } = await supabase
      .from("chat_contacts")
      .select("id")
      .eq("empresa_id", auth.empresa_id)
      .or(`phone_normalized.eq.${phone},phone_number.eq.${phone}`)
      .maybeSingle();

    if (!contact?.id) {
      return NextResponse.json({ ok: false, error: "Contacto no encontrado" }, { status: 404 });
    }

    const detail = await getContactHistory(supabase, auth.empresa_id, contact.id as string);
    if (!detail) {
      return NextResponse.json({ ok: false, error: "Contacto no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, detail });
  } catch (e) {
    console.error("[api/chat/history/phone]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
