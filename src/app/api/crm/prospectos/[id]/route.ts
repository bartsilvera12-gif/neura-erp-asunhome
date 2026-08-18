import { NextRequest, NextResponse } from "next/server";
import { getProspectoForEmpresa } from "@/lib/crm/storage";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { isLikelyUnexposedTenantChatSchema } from "@/lib/supabase/chat-data-schema";
import {
  deleteProspectoForEmpresaPg,
  getProspectoForEmpresaPg,
  prospectoExistsForEmpresaPg,
  resolveCrmProspectosSchemaForTenant,
  updateProspectoForEmpresaPg,
} from "@/lib/crm/crm-prospectos-pg";

/**
 * GET /api/crm/prospectos/:id
 * Detalle + notas en el schema de datos de la empresa (service role).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { id } = await params;
    if (!id) {
      return NextResponse.json(errorResponse("id es obligatorio"), { status: 400 });
    }

    const dataSchema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const pool = getChatPostgresPool();
    if (pool && isLikelyUnexposedTenantChatSchema(dataSchema)) {
      const resolved = await resolveCrmProspectosSchemaForTenant(pool, dataSchema);
      if (!resolved) {
        return NextResponse.json(
          errorResponse("No se pudo resolver schema CRM para este tenant (PG)"),
          { status: 500 }
        );
      }
      const prospectoPg = await getProspectoForEmpresaPg(pool, dataSchema, ctx.auth.empresa_id, id);
      if (!prospectoPg) {
        return NextResponse.json(errorResponse("Prospecto no encontrado"), { status: 404 });
      }
      return NextResponse.json(successResponse(prospectoPg));
    }

    const prospecto = await getProspectoForEmpresa(ctx.supabase, ctx.auth.empresa_id, id);
    if (!prospecto) {
      return NextResponse.json(errorResponse("Prospecto no encontrado"), { status: 404 });
    }
    return NextResponse.json(successResponse(prospecto));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    console.error("[api/crm/prospectos/[id]] GET:", err);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * PATCH /api/crm/prospectos/:id
 * Actualiza campos del prospecto (solo si pertenece a la empresa).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { id } = await params;
    const empresaId = ctx.auth.empresa_id;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const dataSchema = await fetchDataSchemaForEmpresaId(empresaId);
    const pool = getChatPostgresPool();
    const usePg = Boolean(pool && isLikelyUnexposedTenantChatSchema(dataSchema));

    if (usePg && pool) {
      const exists = await prospectoExistsForEmpresaPg(pool, dataSchema, empresaId, id);
      if (!exists) {
        return NextResponse.json(errorResponse("Prospecto no encontrado"), { status: 404 });
      }

      const patch: Record<string, unknown> = {};
      if (typeof body.empresa === "string") patch.empresa = body.empresa.trim();
      if (typeof body.contacto === "string") patch.contacto = body.contacto.trim();
      if (body.email !== undefined) {
        patch.email =
          typeof body.email === "string" && body.email.trim() ? body.email.trim().toLowerCase() : null;
      }
      if (body.telefono !== undefined) {
        patch.telefono = typeof body.telefono === "string" && body.telefono.trim() ? body.telefono.trim() : null;
      }
      if (typeof body.servicio === "string") patch.servicio = body.servicio.trim();
      if (body.valor_estimado !== undefined) {
        patch.valor_estimado =
          typeof body.valor_estimado === "number" ? body.valor_estimado : Number(body.valor_estimado) || 0;
      }
      if (typeof body.etapa === "string" && body.etapa.trim()) patch.etapa = body.etapa.trim();
      if (body.proxima_accion !== undefined) {
        patch.proxima_accion =
          typeof body.proxima_accion === "string" && body.proxima_accion.trim()
            ? body.proxima_accion.trim()
            : null;
      }
      if (body.fecha_proxima_accion !== undefined) {
        patch.fecha_proxima_accion =
          typeof body.fecha_proxima_accion === "string" && body.fecha_proxima_accion.trim()
            ? body.fecha_proxima_accion.trim()
            : null;
      }
      if (body.responsable !== undefined) {
        patch.responsable =
          typeof body.responsable === "string" && body.responsable.trim() ? body.responsable.trim() : null;
      }
      if (body.observaciones !== undefined) {
        patch.observaciones =
          typeof body.observaciones === "string" && body.observaciones.trim() ? body.observaciones.trim() : null;
      }
      if (body.cliente_creado !== undefined) patch.cliente_creado = Boolean(body.cliente_creado);

      patch.fecha_actualizacion = new Date().toISOString();

      if (Object.keys(patch).length <= 1) {
        const p = await getProspectoForEmpresaPg(pool, dataSchema, empresaId, id);
        if (!p) {
          return NextResponse.json(errorResponse("Prospecto no encontrado"), { status: 404 });
        }
        return NextResponse.json(successResponse(p));
      }

      const ok = await updateProspectoForEmpresaPg(pool, dataSchema, empresaId, id, patch);
      if (!ok) {
        return NextResponse.json(errorResponse("No se pudo actualizar prospecto"), { status: 400 });
      }

      const prospecto = await getProspectoForEmpresaPg(pool, dataSchema, empresaId, id);
      if (!prospecto) {
        return NextResponse.json(errorResponse("No se pudo leer el prospecto actualizado"), { status: 500 });
      }
      return NextResponse.json(successResponse(prospecto));
    }

    const { data: exists, error: errE } = await ctx.supabase
      .from("crm_prospectos")
      .select("id")
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (errE) {
      return NextResponse.json(errorResponse(errE.message), { status: 400 });
    }
    if (!exists) {
      return NextResponse.json(errorResponse("Prospecto no encontrado"), { status: 404 });
    }

    const patch: Record<string, unknown> = {};
    if (typeof body.empresa === "string") patch.empresa = body.empresa.trim();
    if (typeof body.contacto === "string") patch.contacto = body.contacto.trim();
    if (body.email !== undefined) {
      patch.email =
        typeof body.email === "string" && body.email.trim() ? body.email.trim().toLowerCase() : null;
    }
    if (body.telefono !== undefined) {
      patch.telefono = typeof body.telefono === "string" && body.telefono.trim() ? body.telefono.trim() : null;
    }
    if (typeof body.servicio === "string") patch.servicio = body.servicio.trim();
    if (body.valor_estimado !== undefined) {
      patch.valor_estimado =
        typeof body.valor_estimado === "number" ? body.valor_estimado : Number(body.valor_estimado) || 0;
    }
    if (typeof body.etapa === "string" && body.etapa.trim()) patch.etapa = body.etapa.trim();
    if (body.proxima_accion !== undefined) {
      patch.proxima_accion =
        typeof body.proxima_accion === "string" && body.proxima_accion.trim()
          ? body.proxima_accion.trim()
          : null;
    }
    if (body.fecha_proxima_accion !== undefined) {
      patch.fecha_proxima_accion =
        typeof body.fecha_proxima_accion === "string" && body.fecha_proxima_accion.trim()
          ? body.fecha_proxima_accion.trim()
          : null;
    }
    if (body.responsable !== undefined) {
      patch.responsable =
        typeof body.responsable === "string" && body.responsable.trim() ? body.responsable.trim() : null;
    }
    if (body.observaciones !== undefined) {
      patch.observaciones =
        typeof body.observaciones === "string" && body.observaciones.trim() ? body.observaciones.trim() : null;
    }
    if (body.cliente_creado !== undefined) patch.cliente_creado = Boolean(body.cliente_creado);

    patch.fecha_actualizacion = new Date().toISOString();

    if (Object.keys(patch).length <= 1) {
      const p = await getProspectoForEmpresa(ctx.supabase, empresaId, id);
      return NextResponse.json(successResponse(p));
    }

    const { error: errU } = await ctx.supabase
      .from("crm_prospectos")
      .update(patch)
      .eq("id", id)
      .eq("empresa_id", empresaId);

    if (errU) {
      return NextResponse.json(errorResponse(errU.message), { status: 400 });
    }

    const prospecto = await getProspectoForEmpresa(ctx.supabase, empresaId, id);
    if (!prospecto) {
      return NextResponse.json(errorResponse("No se pudo leer el prospecto actualizado"), { status: 500 });
    }
    return NextResponse.json(successResponse(prospecto));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    console.error("[api/crm/prospectos/[id]] PATCH:", err);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * DELETE /api/crm/prospectos/:id
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { id } = await params;

    const dataSchema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const pool = getChatPostgresPool();
    if (pool && isLikelyUnexposedTenantChatSchema(dataSchema)) {
      const deleted = await deleteProspectoForEmpresaPg(pool, dataSchema, ctx.auth.empresa_id, id);
      if (!deleted) {
        return NextResponse.json(errorResponse("Prospecto no encontrado"), { status: 404 });
      }
      return NextResponse.json(successResponse({ ok: true }));
    }

    const { error } = await ctx.supabase
      .from("crm_prospectos")
      .delete()
      .eq("id", id)
      .eq("empresa_id", ctx.auth.empresa_id);

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    console.error("[api/crm/prospectos/[id]] DELETE:", err);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
