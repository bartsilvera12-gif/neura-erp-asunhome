import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getAuthWithRol } from "@/lib/middleware/auth";
import {
  assertFlowBelongsToEmpresa,
  fetchNodeCodesForFlow,
  mergePatchPayload,
  rowToNormalized,
  type RecontactRuleRowOut,
} from "@/lib/chat/recontact-rules-validation";

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ flowCode: string; ruleId: string }> }
) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }
    const empresaId = auth.empresa_id;
    const params = await context.params;
    const flowCode = decodeURIComponent(params.flowCode ?? "").trim();
    const ruleId = decodeURIComponent(params.ruleId ?? "").trim();
    if (!flowCode) return NextResponse.json({ ok: false, error: "flowCode inválido" }, { status: 400 });
    if (!ruleId || !isUuid(ruleId)) return NextResponse.json({ ok: false, error: "ruleId inválido" }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const supabase = await getChatServiceClientForEmpresa(empresaId);
    await assertFlowBelongsToEmpresa(supabase, empresaId, flowCode);

    const { data: row, error: fetchErr } = await supabase
      .from("chat_flow_recontact_rules")
      .select(
        "id, empresa_id, flow_code, nombre, descripcion, activo, prioridad, included_node_codes, excluded_node_codes, idle_after_seconds, max_attempts, cooldown_seconds, schedule_config, guard_config, message_config, created_at, updated_at"
      )
      .eq("id", ruleId)
      .eq("empresa_id", empresaId)
      .eq("flow_code", flowCode)
      .maybeSingle();

    if (fetchErr) return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 400 });
    if (!row) return NextResponse.json({ ok: false, error: "Regla no encontrada" }, { status: 404 });

    const validCodes = await fetchNodeCodesForFlow(supabase, empresaId, flowCode);
    const validSet = new Set(validCodes);

    const existing = rowToNormalized(row as RecontactRuleRowOut);
    const merged = mergePatchPayload(existing, body, validSet);

    const patch = {
      nombre: merged.nombre,
      descripcion: merged.descripcion,
      activo: merged.activo,
      prioridad: merged.prioridad,
      included_node_codes: merged.included_node_codes,
      excluded_node_codes: merged.excluded_node_codes,
      idle_after_seconds: merged.idle_after_seconds,
      max_attempts: merged.max_attempts,
      cooldown_seconds: merged.cooldown_seconds,
      schedule_config: merged.schedule_config,
      guard_config: merged.guard_config,
      message_config: merged.message_config,
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error } = await supabase
      .from("chat_flow_recontact_rules")
      .update(patch)
      .eq("id", ruleId)
      .eq("empresa_id", empresaId)
      .eq("flow_code", flowCode)
      .select(
        "id, empresa_id, flow_code, nombre, descripcion, activo, prioridad, included_node_codes, excluded_node_codes, idle_after_seconds, max_attempts, cooldown_seconds, schedule_config, guard_config, message_config, created_at, updated_at"
      )
      .maybeSingle();

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    if (!updated) return NextResponse.json({ ok: false, error: "No se pudo actualizar" }, { status: 400 });

    return NextResponse.json({ ok: true, item: updated as RecontactRuleRowOut });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error interno";
    console.error("[api/chat/flows/:flowCode/recontact-rules/:ruleId][PATCH]", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ flowCode: string; ruleId: string }> }
) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }
    const empresaId = auth.empresa_id;
    const params = await context.params;
    const flowCode = decodeURIComponent(params.flowCode ?? "").trim();
    const ruleId = decodeURIComponent(params.ruleId ?? "").trim();
    if (!flowCode) return NextResponse.json({ ok: false, error: "flowCode inválido" }, { status: 400 });
    if (!ruleId || !isUuid(ruleId)) return NextResponse.json({ ok: false, error: "ruleId inválido" }, { status: 400 });

    const supabase = await getChatServiceClientForEmpresa(empresaId);
    await assertFlowBelongsToEmpresa(supabase, empresaId, flowCode);

    const { data: existing, error: exErr } = await supabase
      .from("chat_flow_recontact_rules")
      .select("id")
      .eq("id", ruleId)
      .eq("empresa_id", empresaId)
      .eq("flow_code", flowCode)
      .maybeSingle();
    if (exErr) return NextResponse.json({ ok: false, error: exErr.message }, { status: 400 });
    if (!existing) return NextResponse.json({ ok: false, error: "Regla no encontrada" }, { status: 404 });

    const { error } = await supabase
      .from("chat_flow_recontact_rules")
      .delete()
      .eq("id", ruleId)
      .eq("empresa_id", empresaId)
      .eq("flow_code", flowCode);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/chat/flows/:flowCode/recontact-rules/:ruleId][DELETE]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
