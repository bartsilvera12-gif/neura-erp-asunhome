import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getAuthWithRol } from "@/lib/middleware/auth";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import {
  insertFlowNodeBetweenAuto,
  type InsertFlowNodeBetweenParams,
} from "@/lib/chat/flow-insert-node-between";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ flowCode: string }> }
) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }

    const params = await context.params;
    const flowCode = decodeURIComponent(params.flowCode ?? "").trim();
    if (!flowCode) {
      return NextResponse.json({ ok: false, error: "flow_code inválido" }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      sourceType?: string;
      sourceNodeCode?: string;
      sourceOptionId?: string | null;
      newNode?: {
        node_code?: string;
        node_type?: string;
        message_text?: string | null;
        save_as_field?: string | null;
        is_active?: boolean;
        crm_action_type?: string | null;
        crm_action_config?: Record<string, unknown> | null;
      };
    };

    const st = body.sourceType?.trim();
    if (st !== "node" && st !== "option") {
      return NextResponse.json({ ok: false, error: "sourceType debe ser node u option" }, { status: 400 });
    }

    const srcNode = (body.sourceNodeCode ?? "").trim();
    if (!srcNode) {
      return NextResponse.json({ ok: false, error: "sourceNodeCode requerido" }, { status: 400 });
    }

    if (st === "option" && !(body.sourceOptionId ?? "").trim()) {
      return NextResponse.json(
        { ok: false, error: "sourceOptionId requerido cuando sourceType es option" },
        { status: 400 }
      );
    }

    const nn = body.newNode;
    if (!nn?.node_code?.trim() || !nn?.node_type?.trim()) {
      return NextResponse.json(
        { ok: false, error: "newNode.node_code y newNode.node_type son requeridos" },
        { status: 400 }
      );
    }

    const payload: InsertFlowNodeBetweenParams = {
      empresaId: auth.empresa_id,
      flowCode,
      sourceType: st,
      sourceNodeCode: srcNode,
      sourceOptionId: st === "option" ? (body.sourceOptionId ?? "").trim() : undefined,
      newNode: {
        node_code: nn.node_code.trim(),
        node_type: nn.node_type.trim(),
        message_text: nn.message_text ?? null,
        save_as_field: nn.save_as_field ?? null,
        is_active: nn.is_active,
        crm_action_type: nn.crm_action_type ?? null,
        crm_action_config: nn.crm_action_config ?? {},
      },
    };

    const schema = await fetchDataSchemaForEmpresaId(auth.empresa_id);
    const pool = getChatPostgresPool();
    const supabase = await getChatServiceClientForEmpresa(auth.empresa_id);

    const result = await insertFlowNodeBetweenAuto(pool, schema, payload, supabase);

    return NextResponse.json({
      ok: true,
      result: {
        new_node_id: result.newNodeId,
        new_node_code: result.newNodeCode,
        previous_next_node_code: result.previousNextNodeCode,
        new_node_next_node_code: result.wiredTo,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error interno";
    console.error("[api/chat/flows/.../insert-between][POST]", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
