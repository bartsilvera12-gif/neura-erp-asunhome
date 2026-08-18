import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getAuthWithRol } from "@/lib/middleware/auth";
import { runRecontactDryRun } from "@/lib/chat/recontact-dry-run";
import { assertFlowBelongsToEmpresa } from "@/lib/chat/recontact-rules-validation";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

/**
 * Simulación dry-run (FASE 2): lista candidatos y omitidos sin enviar WhatsApp ni mutar datos.
 */
export async function POST(
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

    const { data: rule, error: ruleErr } = await supabase
      .from("chat_flow_recontact_rules")
      .select(
        "id, empresa_id, flow_code, included_node_codes, excluded_node_codes, idle_after_seconds, max_attempts, cooldown_seconds, guard_config"
      )
      .eq("id", ruleId)
      .eq("empresa_id", empresaId)
      .eq("flow_code", flowCode)
      .maybeSingle();

    if (ruleErr) return NextResponse.json({ ok: false, error: ruleErr.message }, { status: 400 });
    if (!rule) return NextResponse.json({ ok: false, error: "Regla no encontrada" }, { status: 404 });

    const dataSchema = await fetchDataSchemaForEmpresaId(empresaId);

    const result = await runRecontactDryRun({
      supabase,
      empresaId,
      dataSchema,
      flowCode,
      rule,
    });

    return NextResponse.json({
      ok: true,
      scanned: result.scanned,
      limit: result.limit,
      limitReached: result.limitReached,
      candidates: result.candidates,
      skipped: result.skipped,
      rows: result.rows,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error interno";
    console.error("[api/chat/flows/:flowCode/recontact-rules/:ruleId/dry-run][POST]", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
