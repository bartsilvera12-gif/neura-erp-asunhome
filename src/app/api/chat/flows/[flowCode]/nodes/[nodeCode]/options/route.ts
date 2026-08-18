import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getAuthWithRol } from "@/lib/middleware/auth";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

async function resolveNodeId(
  supabase: AppSupabaseClient,
  empresaId: string,
  flowCode: string,
  nodeCode: string
) {
  const { data, error } = await supabase
    .from("chat_flow_nodes")
    .select("id, node_type")
    .eq("empresa_id", empresaId)
    .eq("flow_code", flowCode)
    .eq("node_code", nodeCode)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string; node_type: string } | null) ?? null;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ flowCode: string; nodeCode: string }> }
) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }
    const params = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      label?: string;
      meta_button_id?: string;
      next_node_code?: string | null;
      sort_order?: number;
      group_title?: string | null;
      group_order?: number | null;
      option_payload?: Record<string, unknown> | null;
    };
    const label = (body.label ?? "").trim();
    const metaButtonId = (body.meta_button_id ?? "").trim();
    if (!label || !metaButtonId) {
      return NextResponse.json({ ok: false, error: "label y meta_button_id requeridos" }, { status: 400 });
    }
    const supabase = await getChatServiceClientForEmpresa(auth.empresa_id);
    const node = await resolveNodeId(supabase, auth.empresa_id, params.flowCode, params.nodeCode);
    if (!node) return NextResponse.json({ ok: false, error: "Nodo no encontrado" }, { status: 404 });
    const nextNodeCode = body.next_node_code?.trim() || null;
    // Alta: permitir sin siguiente paso; el PATCH al guardar desde el editor exige next_node_code.
    const optionPayload =
      typeof body.option_payload === "object" && body.option_payload
        ? body.option_payload
        : {};
    const gtInsert = typeof body.group_title === "string" ? body.group_title.trim() : "";
    const groupTitleInsert = gtInsert.length ? gtInsert : null;
    const groupOrderInsert = Number.isFinite(body.group_order)
      ? Math.trunc(body.group_order as number)
      : 0;

    const { data, error } = await supabase
      .from("chat_flow_options")
      .insert({
        node_id: node.id,
        label,
        option_value: metaButtonId,
        meta_button_id: metaButtonId,
        next_node_code: nextNodeCode,
        sort_order: Number.isFinite(body.sort_order) ? Math.trunc(body.sort_order as number) : 0,
        option_payload: optionPayload,
        group_title: groupTitleInsert,
        group_order: groupOrderInsert,
      })
      .select(
        "id, node_id, label, option_value, meta_button_id, next_node_code, sort_order, option_payload, group_title, group_order"
      )
      .single();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, item: data });
  } catch (e) {
    console.error("[api/chat/flows/:flowCode/nodes/:nodeCode/options][POST]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
