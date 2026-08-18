import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth, getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { isAdmin } from "@/lib/middleware/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { isLikelyUnexposedTenantChatSchema } from "@/lib/supabase/chat-data-schema";
import { CRM_ETAPAS_INICIALES } from "@/lib/crm/crm-etapas-defaults";
import {
  ensureDefaultCrmEtapasPg,
  listCrmEtapasActivasPg,
  listCrmEtapasTodasPg,
} from "@/lib/crm/crm-prospectos-pg";

/**
 * GET /api/crm/etapas
 * Etapas CRM activas del tenant (columnas Kanban del funnel).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;
    const dataSchema = await fetchDataSchemaForEmpresaId(empresaId);
    const pool = getChatPostgresPool();
    const modoConfig = request.nextUrl.searchParams.get("config") === "1";

    const usePg = Boolean(pool && isLikelyUnexposedTenantChatSchema(dataSchema));

    console.info("[crm-funnel][board]", "request", {
      empresa_id: empresaId,
      data_schema: dataSchema,
      modo: usePg ? "postgres_directo" : "postgrest",
      config: modoConfig,
    });

    if (usePg && pool) {
      await ensureDefaultCrmEtapasPg(pool, dataSchema, empresaId);
      const rows = modoConfig
        ? await listCrmEtapasTodasPg(pool, dataSchema, empresaId)
        : await listCrmEtapasActivasPg(pool, dataSchema, empresaId);
      if (rows !== null) {
        console.info("[crm-funnel][board-data]", {
          empresa_id: empresaId,
          data_schema: dataSchema,
          modo: "postgres_directo",
          config: modoConfig,
          etapas_count: rows.length,
          codigos: rows.map((r) => String((r as { codigo?: string }).codigo ?? "")),
        });
        console.info("[crm-funnel][board]", "postgres_ok", {
          empresa_id: empresaId,
          data_schema: dataSchema,
          modo: "postgres_directo",
          etapas: rows.length,
        });
        return NextResponse.json(successResponse(rows));
      }
      return NextResponse.json(
        errorResponse("No se pudieron listar etapas CRM vía Postgres"),
        { status: 500 }
      );
    }

    const { count: etapaCount } = await supabase
      .from("crm_etapas")
      .select("*", { count: "exact", head: true })
      .eq("empresa_id", empresaId);

    if ((etapaCount ?? 0) === 0) {
      const defaults = CRM_ETAPAS_INICIALES.map((r) => ({
        empresa_id: empresaId,
        codigo: r.codigo,
        nombre: r.nombre,
        color: r.color,
        orden: r.orden,
        activo: true,
      }));
      const { error: seedErr } = await supabase.from("crm_etapas").insert(defaults);
      if (seedErr) {
        console.warn("[crm-funnel]", "crm_etapas_seed_postgrest_failed", seedErr.message);
      } else {
        console.info("[crm-funnel]", "crm_etapas_seed_postgrest", { empresa_id: empresaId });
      }
    }

    let q = supabase
      .from("crm_etapas")
      .select("*")
      .eq("empresa_id", empresaId)
      .order("orden", { ascending: true });
    if (!modoConfig) {
      q = q.eq("activo", true);
    }
    const { data, error } = await q;

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    const list = data ?? [];
    console.info("[crm-funnel][board-data]", {
      empresa_id: empresaId,
      data_schema: dataSchema,
      modo: "postgrest_schema",
      config: modoConfig,
      etapas_count: list.length,
      codigos: list.map((r) => String((r as { codigo?: string }).codigo ?? "")),
    });
    console.info("[crm-funnel][board]", "postgrest_ok", {
      empresa_id: empresaId,
      data_schema: dataSchema,
      modo: "postgrest",
      etapas: list.length,
    });
    return NextResponse.json(successResponse(list));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

type BodyCreaEtapa = { codigo?: string; nombre?: string; color?: string; orden?: number };

/**
 * POST /api/crm/etapas — crear etapa (misma capa de datos que GET; solo admin).
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(errorResponse("Sólo administradores"), { status: 403 });
    }
    const { supabase, auth } = ctx;
    const body = (await request.json().catch(() => ({}))) as BodyCreaEtapa;
    const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
    if (!nombre) {
      return NextResponse.json(errorResponse("nombre es obligatorio"), { status: 400 });
    }
    const codRaw = typeof body.codigo === "string" ? body.codigo.trim() : "";
    const codigo = (codRaw || nombre.replace(/\s+/g, "_")).toUpperCase();
    const color = typeof body.color === "string" && body.color.trim() ? body.color.trim() : "gray";
    const orden =
      typeof body.orden === "number" && Number.isFinite(body.orden) ? Math.trunc(body.orden) : 0;

    const { data, error } = await supabase
      .from("crm_etapas")
      .insert([
        {
          empresa_id: auth.empresa_id,
          codigo: codigo.replace(/\s+/g, "_"),
          nombre,
          color,
          orden,
          activo: true,
        },
      ])
      .select()
      .single();

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    return NextResponse.json(successResponse(data), { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
