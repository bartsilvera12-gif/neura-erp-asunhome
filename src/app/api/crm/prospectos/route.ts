import { NextRequest, NextResponse } from "next/server";
import { getProspectoForEmpresa, listProspectosForEmpresa } from "@/lib/crm/storage";
import { generarNumeroControlFromSupabase } from "@/lib/crm/numero-control";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { isLikelyUnexposedTenantChatSchema } from "@/lib/supabase/chat-data-schema";
import {
  insertProspectoForEmpresaPg,
  listProspectosForEmpresaPg,
  getProspectoForEmpresaPg,
  logCrmFunnelProspectStageMatch,
} from "@/lib/crm/crm-prospectos-pg";

/**
 * GET /api/crm/prospectos
 * Prospectos + notas del tenant (service role en schema de datos de la empresa).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const dataSchema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const pool = getChatPostgresPool();
    if (pool && isLikelyUnexposedTenantChatSchema(dataSchema)) {
      const pgList = await listProspectosForEmpresaPg(pool, dataSchema, ctx.auth.empresa_id);
      if (pgList !== null) {
        await logCrmFunnelProspectStageMatch(
          pool,
          dataSchema,
          ctx.auth.empresa_id,
          pgList,
          "postgres_directo"
        );
        console.info("[crm-funnel][list]", "postgres_ok", {
          empresa_id: ctx.auth.empresa_id,
          data_schema: dataSchema,
          modo: "postgres_directo",
          count: pgList.length,
        });
        return NextResponse.json(successResponse(pgList));
      }
      return NextResponse.json(
        errorResponse("No se pudieron listar prospectos vía Postgres (tenant no expuesto)"),
        { status: 500 }
      );
    }

    const items = await listProspectosForEmpresa(ctx.supabase, ctx.auth.empresa_id);
    await logCrmFunnelProspectStageMatch(null, undefined, ctx.auth.empresa_id, items, "postgrest_schema");
    console.info("[crm-funnel][list]", "postgrest_ok", {
      empresa_id: ctx.auth.empresa_id,
      data_schema: dataSchema,
      modo: "postgrest",
      count: items.length,
    });
    return NextResponse.json(successResponse(items));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * POST /api/crm/prospectos
 * Alta de prospecto en el schema tenant (misma vía que GET).
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx?.auth?.user) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const empresaId = ctx.auth.empresa_id;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const empresa = typeof body.empresa === "string" ? body.empresa.trim() : "";
    const contacto = typeof body.contacto === "string" ? body.contacto.trim() : "";
    const servicio = typeof body.servicio === "string" ? body.servicio.trim() : "";
    const etapa = typeof body.etapa === "string" ? body.etapa.trim() : "LEAD";

    if (!empresa) {
      return NextResponse.json(errorResponse("empresa es obligatoria"), { status: 400 });
    }
    if (!contacto) {
      return NextResponse.json(errorResponse("contacto es obligatorio"), { status: 400 });
    }
    if (!servicio) {
      return NextResponse.json(errorResponse("servicio es obligatorio"), { status: 400 });
    }

    const sb = ctx.supabase;
    const dataSchema = await fetchDataSchemaForEmpresaId(empresaId);
    const pool = getChatPostgresPool();
    const usePg = Boolean(pool && isLikelyUnexposedTenantChatSchema(dataSchema));

    const creadoPor =
      (typeof ctx.auth.user.email === "string" && ctx.auth.user.email.trim()) || null;

    const insert = {
      empresa_id: empresaId,
      empresa,
      contacto,
      email: typeof body.email === "string" && body.email.trim() ? body.email.trim().toLowerCase() : null,
      telefono: typeof body.telefono === "string" && body.telefono.trim() ? body.telefono.trim() : null,
      servicio,
      valor_estimado: typeof body.valor_estimado === "number" ? body.valor_estimado : Number(body.valor_estimado) || 0,
      etapa,
      proxima_accion: typeof body.proxima_accion === "string" && body.proxima_accion.trim() ? body.proxima_accion.trim() : null,
      fecha_proxima_accion:
        typeof body.fecha_proxima_accion === "string" && body.fecha_proxima_accion.trim()
          ? body.fecha_proxima_accion.trim()
          : null,
      creado_por: creadoPor,
      origen_creacion: "manual",
      origen_detalle: null,
      responsable: typeof body.responsable === "string" && body.responsable.trim() ? body.responsable.trim() : null,
      observaciones: typeof body.observaciones === "string" && body.observaciones.trim() ? body.observaciones.trim() : null,
    };

    if (usePg && pool) {
      const created = await insertProspectoForEmpresaPg(pool, dataSchema, {
        empresa_id: empresaId,
        empresa: insert.empresa,
        contacto: insert.contacto,
        email: insert.email,
        telefono: insert.telefono,
        servicio: insert.servicio,
        valor_estimado: insert.valor_estimado,
        etapa: insert.etapa,
        proxima_accion: insert.proxima_accion,
        fecha_proxima_accion: insert.fecha_proxima_accion,
        creado_por: insert.creado_por,
        origen_creacion: insert.origen_creacion,
        origen_detalle: insert.origen_detalle,
        responsable: insert.responsable,
        observaciones: insert.observaciones,
      });
      if (!created?.id) {
        return NextResponse.json(errorResponse("No se pudo crear prospecto en tenant PG"), { status: 400 });
      }
      const prospectoPg = await getProspectoForEmpresaPg(pool, dataSchema, empresaId, created.id);
      if (!prospectoPg) {
        return NextResponse.json(errorResponse("Prospecto creado pero no se pudo leer"), { status: 500 });
      }
      return NextResponse.json(successResponse(prospectoPg));
    }

    const numeroControl = await generarNumeroControlFromSupabase(sb, empresaId);
    const insertWithNum = { ...insert, numero_control: numeroControl };

    const { data, error } = await sb.from("crm_prospectos").insert([insertWithNum]).select("id").single();

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    const id = (data as { id: string }).id;
    const prospecto = await getProspectoForEmpresa(sb, empresaId, id);
    if (!prospecto) {
      return NextResponse.json(errorResponse("Prospecto creado pero no se pudo leer"), { status: 500 });
    }

    return NextResponse.json(successResponse(prospecto));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    console.error("[api/crm/prospectos] POST:", err);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
