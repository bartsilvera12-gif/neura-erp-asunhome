import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getAuthWithRol } from "@/lib/middleware/auth";
import {
  assertFlowBelongsToEmpresa,
  fetchNodeCodesForFlow,
  normalizeCreatePayload,
  type RecontactRuleRowOut,
} from "@/lib/chat/recontact-rules-validation";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ flowCode: string }> }
) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }
    const empresaId = auth.empresa_id;
    const params = await context.params;
    const flowCode = decodeURIComponent(params.flowCode ?? "").trim();
    if (!flowCode) return NextResponse.json({ ok: false, error: "flowCode inválido" }, { status: 400 });

    const supabase = await getChatServiceClientForEmpresa(empresaId);
    await assertFlowBelongsToEmpresa(supabase, empresaId, flowCode);

    const { data, error } = await supabase
      .from("chat_flow_recontact_rules")
      .select(
        "id, empresa_id, flow_code, nombre, descripcion, activo, prioridad, included_node_codes, excluded_node_codes, idle_after_seconds, max_attempts, cooldown_seconds, schedule_config, guard_config, message_config, created_at, updated_at"
      )
      .eq("empresa_id", empresaId)
      .eq("flow_code", flowCode)
      .order("prioridad", { ascending: true })
      .order("nombre", { ascending: true });

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

    return NextResponse.json({
      ok: true,
      items: (data ?? []) as RecontactRuleRowOut[],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error interno";
    console.error("[api/chat/flows/:flowCode/recontact-rules][GET]", e);
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("Flujo") ? 404 : 500 });
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ flowCode: string }> }
) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }
    const empresaId = auth.empresa_id;
    const params = await context.params;
    const flowCode = decodeURIComponent(params.flowCode ?? "").trim();
    if (!flowCode) return NextResponse.json({ ok: false, error: "flowCode inválido" }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const supabase = await getChatServiceClientForEmpresa(empresaId);
    await assertFlowBelongsToEmpresa(supabase, empresaId, flowCode);

    const validCodes = await fetchNodeCodesForFlow(supabase, empresaId, flowCode);
    const validSet = new Set(validCodes);
    const normalized = normalizeCreatePayload(body, validSet);

    const insertRow = {
      empresa_id: empresaId,
      flow_code: flowCode,
      nombre: normalized.nombre,
      descripcion: normalized.descripcion,
      activo: normalized.activo,
      prioridad: normalized.prioridad,
      included_node_codes: normalized.included_node_codes,
      excluded_node_codes: normalized.excluded_node_codes,
      idle_after_seconds: normalized.idle_after_seconds,
      max_attempts: normalized.max_attempts,
      cooldown_seconds: normalized.cooldown_seconds,
      schedule_config: normalized.schedule_config,
      guard_config: normalized.guard_config,
      message_config: normalized.message_config,
    };

    const { data, error } = await supabase
      .from("chat_flow_recontact_rules")
      .insert(insertRow)
      .select(
        "id, empresa_id, flow_code, nombre, descripcion, activo, prioridad, included_node_codes, excluded_node_codes, idle_after_seconds, max_attempts, cooldown_seconds, schedule_config, guard_config, message_config, created_at, updated_at"
      )
      .maybeSingle();

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ ok: false, error: "No se pudo crear la regla" }, { status: 400 });

    return NextResponse.json({ ok: true, item: data as RecontactRuleRowOut });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error interno";
    console.error("[api/chat/flows/:flowCode/recontact-rules][POST]", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
