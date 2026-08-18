import { NextRequest, NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { getAuthWithRol } from "@/lib/middleware/auth";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { isLikelyUnexposedTenantChatSchema } from "@/lib/supabase/chat-data-schema";

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
    const dataSchema = await fetchDataSchemaForEmpresaId(empresaId);
    const pool = getChatPostgresPool();
    const modo =
      pool && isLikelyUnexposedTenantChatSchema(dataSchema) ? "postgres_shim" : "postgrest_schema";

    const params = await context.params;
    const supabase = await getChatServiceClientForEmpresa(empresaId);
    const { data, error } = await supabase
      .from("chat_flows")
      .select("flow_code, label, channel, activo, sorteo_id, sorteo_datos_incompletos_message, updated_at")
      .eq("empresa_id", empresaId)
      .eq("flow_code", params.flowCode)
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ ok: false, error: "Flow no encontrado" }, { status: 404 });

    let sorteoNombre: string | null = null;
    const sid = (data.sorteo_id as string | null) ?? null;
    if (sid) {
      const { data: srow } = await supabase
        .from("sorteos")
        .select("nombre")
        .eq("empresa_id", empresaId)
        .eq("id", sid)
        .maybeSingle();
      sorteoNombre = (srow as { nombre?: string } | null)?.nombre ?? null;
    }

    console.info("[bot-config][flow-list]", {
      empresa_id: empresaId,
      data_schema: dataSchema,
      modo,
      flow_code: params.flowCode,
      detail: true,
    });

    return NextResponse.json({
      ok: true,
      item: {
        flow_code: data.flow_code,
        label: data.label,
        channel: data.channel,
        activo: data.activo !== false,
        sorteo_id: sid,
        sorteo_nombre: sorteoNombre,
        sorteo_datos_incompletos_message:
          (data as { sorteo_datos_incompletos_message?: string | null })
            .sorteo_datos_incompletos_message ?? null,
        updated_at: data.updated_at,
      },
    });
  } catch (e) {
    console.error("[api/chat/flows/:flowCode][GET]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ flowCode: string }> }
) {
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

    const params = await context.params;
    const flowCode = params.flowCode;
    const body = (await request.json().catch(() => ({}))) as {
      label?: string;
      channel?: string;
      activo?: boolean;
      sorteo_id?: string | null;
    };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.label === "string") patch.label = body.label.trim();
    if (typeof body.channel === "string") patch.channel = body.channel.trim() || "whatsapp";
    if (typeof body.activo === "boolean") patch.activo = body.activo;
    const supabase = await getChatServiceClientForEmpresa(empresaId);

    if ("sorteo_id" in body) {
      if (body.sorteo_id === null || body.sorteo_id === "") {
        patch.sorteo_id = null;
      } else if (typeof body.sorteo_id === "string") {
        const sid = body.sorteo_id.trim();
        const { data: sorteoOk, error: se } = await supabase
          .from("sorteos")
          .select("id")
          .eq("empresa_id", empresaId)
          .eq("id", sid)
          .maybeSingle();
        if (se || !sorteoOk) {
          return NextResponse.json(
            { ok: false, error: "sorteo_id inválido o no pertenece a la empresa" },
            { status: 400 }
          );
        }
        patch.sorteo_id = sid;
      }
    }
    if ("sorteo_datos_incompletos_message" in body) {
      const b = body as { sorteo_datos_incompletos_message?: string | null };
      if (b.sorteo_datos_incompletos_message === null) {
        patch.sorteo_datos_incompletos_message = null;
      } else if (typeof b.sorteo_datos_incompletos_message === "string") {
        const t = b.sorteo_datos_incompletos_message.trim();
        patch.sorteo_datos_incompletos_message = t.length ? t.slice(0, 4000) : null;
      }
    }
    const { data, error } = await supabase
      .from("chat_flows")
      .update(patch)
      .eq("empresa_id", empresaId)
      .eq("flow_code", flowCode)
      .select("flow_code, label, channel, activo, sorteo_id, sorteo_datos_incompletos_message, updated_at")
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ ok: false, error: "Flow no encontrado" }, { status: 404 });

    let sorteoNombre: string | null = null;
    const outSid = (data.sorteo_id as string | null) ?? null;
    if (outSid) {
      const { data: srow } = await supabase
        .from("sorteos")
        .select("nombre")
        .eq("empresa_id", empresaId)
        .eq("id", outSid)
        .maybeSingle();
      sorteoNombre = (srow as { nombre?: string } | null)?.nombre ?? null;
    }

    console.info("[bot-config][flow-save]", {
      empresa_id: empresaId,
      data_schema: dataSchema,
      modo,
      action: "patch",
      flow_code: flowCode,
    });

    return NextResponse.json({
      ok: true,
      item: {
        flow_code: data.flow_code,
        label: data.label,
        channel: data.channel,
        activo: data.activo !== false,
        sorteo_id: outSid,
        sorteo_nombre: sorteoNombre,
        sorteo_datos_incompletos_message:
          (data as { sorteo_datos_incompletos_message?: string | null })
            .sorteo_datos_incompletos_message ?? null,
        updated_at: data.updated_at,
      },
    });
  } catch (e) {
    console.error("[api/chat/flows/:flowCode][PATCH]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
