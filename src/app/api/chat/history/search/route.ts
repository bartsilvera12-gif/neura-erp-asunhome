import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { searchHistoryContacts } from "@/lib/chat/history-service";
import { getAuthWithRol } from "@/lib/middleware/auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }

    const q = request.nextUrl.searchParams.get("q") ?? "";
    const channelId = request.nextUrl.searchParams.get("channel") ?? undefined;
    const from = request.nextUrl.searchParams.get("from") ?? undefined;
    const to = request.nextUrl.searchParams.get("to") ?? undefined;

    if (!q.trim()) return NextResponse.json({ ok: true, items: [] });

    const supabase = await getChatServiceClientForEmpresa(auth.empresa_id);
    const items = await searchHistoryContacts(supabase, auth.empresa_id, q, {
      channelId,
      from,
      to,
    });

    return NextResponse.json({ ok: true, items });
  } catch (e) {
    console.error("[api/chat/history/search]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
