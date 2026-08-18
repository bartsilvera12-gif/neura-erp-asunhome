import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getAuthWithRol } from "@/lib/middleware/auth";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ optionId: string }> }
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
    const patch: Record<string, unknown> = {};
    if (typeof body.label === "string") patch.label = body.label.trim();
    if (typeof body.meta_button_id === "string") {
      const id = body.meta_button_id.trim();
      patch.meta_button_id = id;
      patch.option_value = id;
    }
    if ("next_node_code" in body) patch.next_node_code = body.next_node_code?.trim() || null;
    if (Number.isFinite(body.sort_order)) patch.sort_order = Math.trunc(body.sort_order as number);
    if ("group_title" in body) {
      const gt = body.group_title?.trim() ?? "";
      patch.group_title = gt.length ? gt : null;
    }
    if (Number.isFinite(body.group_order)) patch.group_order = Math.trunc(body.group_order as number);
    if ("option_payload" in body) {
      patch.option_payload =
        typeof body.option_payload === "object" && body.option_payload
          ? body.option_payload
          : {};
    }

    console.info("[flow-api]", "patch_chat_flow_option_in", {
      empresa_id: auth.empresa_id,
      option_id: params.optionId,
      patch_keys: Object.keys(patch),
      label_in_patch: patch.label,
      has_option_payload: "option_payload" in patch,
    });

    const supabase = await getChatServiceClientForEmpresa(auth.empresa_id);
    const { data: currentOption, error: currentErr } = await supabase
      .from("chat_flow_options")
      .select("node_id, next_node_code")
      .eq("id", params.optionId)
      .maybeSingle();
    if (currentErr) return NextResponse.json({ ok: false, error: currentErr.message }, { status: 400 });
    if (!currentOption) return NextResponse.json({ ok: false, error: "Opción no encontrada" }, { status: 404 });

    const { data: parentNode, error: parentErr } = await supabase
      .from("chat_flow_nodes")
      .select("node_type")
      .eq("id", currentOption.node_id as string)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();
    if (parentErr) return NextResponse.json({ ok: false, error: parentErr.message }, { status: 400 });
    if (!parentNode) return NextResponse.json({ ok: false, error: "Nodo padre no encontrado" }, { status: 404 });

    const targetNextNodeCode =
      "next_node_code" in patch
        ? ((patch.next_node_code as string | null | undefined)?.trim() || null)
        : ((currentOption.next_node_code as string | null | undefined)?.trim() || null);
    if ((parentNode.node_type === "buttons" || parentNode.node_type === "list") && !targetNextNodeCode) {
      return NextResponse.json(
        { ok: false, error: "Seleccioná 'Siguiente paso' para esta opción." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("chat_flow_options")
      .update(patch)
      .eq("id", params.optionId)
      .select(
        "id, node_id, label, option_value, meta_button_id, next_node_code, sort_order, option_payload, group_title, group_order"
      )
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ ok: false, error: "Opción no encontrada" }, { status: 404 });
    const row = data as Record<string, unknown>;
    const pl = row.option_payload;
    const opcionLabelOut =
      pl && typeof pl === "object" && pl !== null && "opcion_label" in pl
        ? (pl as Record<string, unknown>).opcion_label
        : undefined;
    console.info("[flow-db]", "patch_chat_flow_option_after_update", {
      option_id: row.id,
      label: row.label,
      opcion_label: opcionLabelOut,
    });
    return NextResponse.json({ ok: true, item: data });
  } catch (e) {
    console.error("[api/chat/flows/.../options/:optionId][PATCH]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ optionId: string }> }
) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }
    const params = await context.params;
    const optionId = params.optionId?.trim();
    if (!optionId) {
      return NextResponse.json({ ok: false, error: "optionId requerido" }, { status: 400 });
    }
    const supabase = await getChatServiceClientForEmpresa(auth.empresa_id);

    const { data: optRow, error: optErr } = await supabase
      .from("chat_flow_options")
      .select("id, node_id")
      .eq("id", optionId)
      .maybeSingle();
    if (optErr) {
      console.warn("[flow-api]", "delete_chat_flow_option_load_failed", optErr.message);
      return NextResponse.json({ ok: false, error: optErr.message }, { status: 400 });
    }
    if (!optRow) {
      return NextResponse.json({ ok: false, error: "Opción no encontrada" }, { status: 404 });
    }

    const { data: nodeRow, error: nodeErr } = await supabase
      .from("chat_flow_nodes")
      .select("id, empresa_id, node_type")
      .eq("id", optRow.node_id as string)
      .maybeSingle();
    if (nodeErr) {
      return NextResponse.json({ ok: false, error: nodeErr.message }, { status: 400 });
    }
    if (!nodeRow || nodeRow.empresa_id !== auth.empresa_id) {
      return NextResponse.json({ ok: false, error: "Opción no encontrada" }, { status: 404 });
    }

    const { data: siblingRows, error: sibErr } = await supabase
      .from("chat_flow_options")
      .select("id")
      .eq("node_id", optRow.node_id as string);
    if (sibErr) {
      return NextResponse.json({ ok: false, error: sibErr.message }, { status: 400 });
    }
    const siblingCount = Array.isArray(siblingRows) ? siblingRows.length : 0;
    if (
      siblingCount <= 1 &&
      (nodeRow.node_type === "buttons" || nodeRow.node_type === "list")
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Este paso debe tener al menos una opción. Agregá otra opción antes de eliminar esta.",
        },
        { status: 400 }
      );
    }

    console.info("[flow-api]", "delete_chat_flow_option", {
      empresa_id: auth.empresa_id,
      option_id: optionId,
      node_id: optRow.node_id,
    });
    const { error } = await supabase.from("chat_flow_options").delete().eq("id", optionId);
    if (error) {
      console.warn("[flow-api]", "delete_chat_flow_option_failed", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/chat/flows/.../options/:optionId][DELETE]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
