import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getAuthWithRol } from "@/lib/middleware/auth";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { isLikelyUnexposedTenantChatSchema } from "@/lib/supabase/chat-data-schema";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }
    const empresaId = auth.empresa_id;
    const dataSchema = await fetchDataSchemaForEmpresaId(empresaId);
    const pool = getChatPostgresPool();
    const modo =
      pool && isLikelyUnexposedTenantChatSchema(dataSchema) ? "postgres_shim" : "postgrest_schema";

    console.info("[bot-config][flow-list]", {
      empresa_id: empresaId,
      data_schema: dataSchema,
      modo,
    });

    const supabase = await getChatServiceClientForEmpresa(empresaId);

    /** Sin embed PostgREST (el shim Postgres no interpreta `sorteos(nombre)`). */
    const { data: flows, error: fErr } = await supabase
      .from("chat_flows")
      .select("id, flow_code, label, channel, activo, updated_at, sorteo_id")
      .eq("empresa_id", empresaId)
      .order("updated_at", { ascending: false });
    if (fErr) return NextResponse.json({ ok: false, error: fErr.message }, { status: 400 });

    const sorteoIds = [
      ...new Set(
        (flows ?? [])
          .map((f) => (f.sorteo_id as string | null) ?? null)
          .filter((x): x is string => typeof x === "string" && x.length > 0)
      ),
    ];
    const nombrePorSorteo: Record<string, string> = {};
    if (sorteoIds.length > 0) {
      const { data: sorteosRows, error: sErr } = await supabase
        .from("sorteos")
        .select("id, nombre")
        .eq("empresa_id", empresaId)
        .in("id", sorteoIds);
      if (!sErr) {
        for (const s of sorteosRows ?? []) {
          const id = (s as { id?: string }).id;
          const nombre = (s as { nombre?: string }).nombre;
          if (id) nombrePorSorteo[id] = nombre ?? "";
        }
      }
    }

    const codes = (flows ?? []).map((f) => f.flow_code as string);
    let counts: Array<{ flow_code: string; node_count: number }> = [];
    if (codes.length > 0) {
      const { data: nodes } = await supabase
        .from("chat_flow_nodes")
        .select("flow_code")
        .eq("empresa_id", empresaId)
        .in("flow_code", codes);
      const byCode: Record<string, number> = {};
      for (const n of nodes ?? []) {
        const code = n.flow_code as string;
        byCode[code] = (byCode[code] ?? 0) + 1;
      }
      counts = Object.entries(byCode).map(([flow_code, node_count]) => ({ flow_code, node_count }));
    }
    const byFlow = new Map(counts.map((c) => [c.flow_code, c.node_count]));

    return NextResponse.json({
      ok: true,
      items: (flows ?? []).map((f) => {
        const sid = (f.sorteo_id as string | null) ?? null;
        return {
          id: f.id,
          flow_code: f.flow_code,
          label: f.label,
          channel: f.channel,
          activo: f.activo !== false,
          updated_at: f.updated_at,
          sorteo_id: sid,
          sorteo_nombre: sid ? nombrePorSorteo[sid] ?? null : null,
          node_count: byFlow.get(f.flow_code as string) ?? 0,
        };
      }),
    });
  } catch (e) {
    console.error("[api/chat/flows][GET]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthWithRol(request);
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }
    const empresaId = auth.empresa_id;
    const dataSchema = await fetchDataSchemaForEmpresaId(empresaId);
    const pool = getChatPostgresPool();
    const modo =
      pool && isLikelyUnexposedTenantChatSchema(dataSchema) ? "postgres_shim" : "postgrest_schema";

    const body = (await request.json().catch(() => ({}))) as {
      flow_code?: string;
      label?: string;
      channel?: string;
      duplicate_from?: string;
    };
    const flowCode = (body.flow_code ?? "").trim();
    if (!flowCode) {
      return NextResponse.json({ ok: false, error: "flow_code requerido" }, { status: 400 });
    }
    const supabase = await getChatServiceClientForEmpresa(empresaId);

    const { error: iErr } = await supabase.from("chat_flows").insert({
      empresa_id: empresaId,
      flow_code: flowCode,
      label: body.label?.trim() || flowCode,
      channel: body.channel?.trim() || "whatsapp",
      activo: true,
    });
    if (iErr) return NextResponse.json({ ok: false, error: iErr.message }, { status: 400 });

    const source = body.duplicate_from?.trim();
    if (source) {
      const { data: sourceNodes } = await supabase
        .from("chat_flow_nodes")
        .select(
          "node_code, message_text, node_type, is_active, save_as_field, next_node_code, crm_action_type, crm_action_config"
        )
        .eq("empresa_id", empresaId)
        .eq("flow_code", source);
      if (sourceNodes?.length) {
        const insertRows = sourceNodes.map((n) => ({
          empresa_id: empresaId,
          flow_code: flowCode,
          node_code: n.node_code,
          message_text: n.message_text,
          node_type: n.node_type,
          is_active: n.is_active !== false,
          save_as_field: n.save_as_field,
          next_node_code: n.next_node_code,
          crm_action_type: n.crm_action_type ?? null,
          crm_action_config:
            typeof n.crm_action_config === "object" && n.crm_action_config
              ? n.crm_action_config
              : {},
        }));
        await supabase.from("chat_flow_nodes").insert(insertRows);

        const { data: newNodes } = await supabase
          .from("chat_flow_nodes")
          .select("id, node_code")
          .eq("empresa_id", empresaId)
          .eq("flow_code", flowCode);
        const { data: oldNodes } = await supabase
          .from("chat_flow_nodes")
          .select("id, node_code")
          .eq("empresa_id", empresaId)
          .eq("flow_code", source);
        const newByCode = new Map((newNodes ?? []).map((n) => [n.node_code as string, n.id as string]));
        const oldByCode = new Map((oldNodes ?? []).map((n) => [n.id as string, n.node_code as string]));
        const oldIds = (oldNodes ?? []).map((n) => n.id as string);
        if (oldIds.length) {
          const { data: oldOptions } = await supabase
            .from("chat_flow_options")
            .select("node_id, label, option_value, meta_button_id, next_node_code, sort_order")
            .in("node_id", oldIds);
          const optionsInsert = (oldOptions ?? []).flatMap((opt) => {
            const oldCode = oldByCode.get(opt.node_id as string);
            if (!oldCode) return [];
            const newNodeId = newByCode.get(oldCode);
            if (!newNodeId) return [];
            return [
              {
                node_id: newNodeId,
                label: opt.label,
                option_value: opt.option_value,
                meta_button_id: opt.meta_button_id,
                next_node_code: opt.next_node_code,
                sort_order: opt.sort_order ?? 0,
              },
            ];
          });
          if (optionsInsert.length) await supabase.from("chat_flow_options").insert(optionsInsert);
        }
      }
    }

    console.info("[bot-config][flow-save]", {
      empresa_id: empresaId,
      data_schema: dataSchema,
      modo,
      action: "create",
      flow_code: flowCode,
      duplicated_from: source ?? null,
    });

    return NextResponse.json({ ok: true, flow_code: flowCode });
  } catch (e) {
    console.error("[api/chat/flows][POST]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
