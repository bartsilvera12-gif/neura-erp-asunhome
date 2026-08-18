import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/middleware/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getClientesSupabaseFromAuthWithRol } from "@/lib/clientes/clientes-service-client";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { fetchPerfilTributarioDetalle } from "@/lib/clientes/tributario-server";
import { construirPatchActualizacionCliente, type ActualizarClienteInput } from "@/lib/clientes/storage";
import { ensureSemillasCatalogoTipos, tipoServicioSlugValido } from "@/lib/clientes/tipo-servicio-catalogo";

/**
 * GET /api/clientes/:id — un cliente de la empresa (mismo schema que el resto de APIs tenant).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getClientesSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;
    const { id: clienteId } = await params;
    if (!clienteId) {
      return NextResponse.json(errorResponse("id es obligatorio"), { status: 400 });
    }

    const incluirEliminados = request.nextUrl.searchParams.get("incluir_eliminados") === "1";

    /** Sin `.is("deleted_at", null)` en PostgREST: en algunos tenants clonados la columna no existe y devolvía 400. */
    const { data, error } = await supabase
      .from("clientes")
      .select("*")
      .eq("id", clienteId)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (error) {
      console.error("[api/clientes/[id]] GET supabase", { clienteId, empresa_id: auth.empresa_id, message: error.message });
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    if (!data) {
      console.warn("[api/clientes/[id]] GET sin fila", { clienteId, empresa_id: auth.empresa_id });
      return NextResponse.json(errorResponse("Cliente no encontrado"), { status: 404 });
    }

    const deletedAt = (data as { deleted_at?: string | null }).deleted_at;
    if (!incluirEliminados && deletedAt != null && String(deletedAt).trim() !== "") {
      return NextResponse.json(errorResponse("Cliente no encontrado"), { status: 404 });
    }

    const row = data as Record<string, unknown>;
    const uid = typeof row.created_by_user_id === "string" ? row.created_by_user_id.trim() : "";
    const nombreGuardado =
      typeof row.created_by_nombre === "string" ? row.created_by_nombre.trim() : "";

    if (!nombreGuardado && uid) {
      try {
        const catalog = createServiceRoleClient();
        const { data: u } = await catalog
          .from("usuarios")
          .select("nombre, email")
          .eq("auth_user_id", uid)
          .maybeSingle();
        const uo = u as { nombre?: string | null; email?: string | null } | null;
        if (uo) {
          const nom = typeof uo.nombre === "string" ? uo.nombre.trim() : "";
          const em = typeof uo.email === "string" ? uo.email.trim() : "";
          if (nom) row.created_by_nombre = nom;
          else if (em) row.created_by_nombre = em;
        }
      } catch (e) {
        console.warn("[api/clientes/[id]] GET enriquecer creador:", e);
      }
    }

    try {
      const perfil = await fetchPerfilTributarioDetalle(supabase, auth.empresa_id, clienteId);
      row.perfil_tributario = perfil;
      row.perfil_tributario_activo = perfil?.perfil_activo === true;
    } catch (e) {
      console.warn("[api/clientes/[id]] GET perfil tributario:", e);
      row.perfil_tributario = null;
      row.perfil_tributario_activo = false;
    }

    return NextResponse.json(successResponse(row));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * PATCH /api/clientes/:id
 * Actualización de ficha. Usa cliente Supabase con rol de servicio en el `data_schema` de la empresa
 * (misma ruta que GET) para no depender de GRANT/PostgREST del `authenticated` en el navegador.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getClientesSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;
    const { id: clienteId } = await params;
    if (!clienteId) {
      return NextResponse.json(errorResponse("id es obligatorio"), { status: 400 });
    }

    const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const datos = raw as ActualizarClienteInput;
    const patch = construirPatchActualizacionCliente(datos);

    const { data: existing, error: errExist } = await supabase
      .from("clientes")
      .select("id, deleted_at")
      .eq("id", clienteId)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errExist || !existing) {
      return NextResponse.json(errorResponse("Cliente no encontrado"), { status: 404 });
    }
    const delAt = (existing as { deleted_at?: string | null }).deleted_at;
    if (delAt != null && String(delAt).trim() !== "") {
      return NextResponse.json(errorResponse("Cliente no encontrado"), { status: 404 });
    }

    if (datos.tipo_servicio_cliente !== undefined) {
      const ts = patch.tipo_servicio_cliente;
      if (ts !== null && ts !== undefined && String(ts).trim() !== "") {
        const slug = String(ts).trim();
        await ensureSemillasCatalogoTipos(supabase, auth.empresa_id);
        const valido = await tipoServicioSlugValido(supabase, auth.empresa_id, slug);
        if (!valido) {
          return NextResponse.json(
            errorResponse(
              "tipo_servicio_cliente no existe en el catálogo de la empresa. Actualizá la lista en Configuración → CRM."
            ),
            { status: 400 }
          );
        }
        patch.tipo_servicio_cliente = slug;
      } else {
        patch.tipo_servicio_cliente = null;
      }
    }

    const { data, error } = await supabase
      .from("clientes")
      .update(patch)
      .eq("id", clienteId)
      .eq("empresa_id", auth.empresa_id)
      .select()
      .single();

    if (error) {
      console.error("[api/clientes/[id]] PATCH", { clienteId, message: error.message });
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    if (!data) {
      return NextResponse.json(errorResponse("Cliente no encontrado"), { status: 404 });
    }

    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * DELETE /api/clientes/:id
 * Eliminación lógica (soft delete). Solo administradores.
 * Body: { deletion_reason: string, cancelar_suscripciones?: boolean, anular_facturas_pendientes?: boolean }
 * Si hay suscripciones activas o facturas con saldo, se exige el flag correspondiente en true.
 * Bloqueo duro: ventas o tipificaciones asociadas.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getClientesSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    if (!isAdmin(auth)) {
      return NextResponse.json(errorResponse("Solo usuarios administradores pueden eliminar clientes"), { status: 403 });
    }

    const { id: clienteId } = await params;
    if (!clienteId) {
      return NextResponse.json(errorResponse("id es obligatorio"), { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const deletionReason = typeof body.deletion_reason === "string" ? body.deletion_reason.trim() : "";
    const cancelarSuscripciones = Boolean(body.cancelar_suscripciones);
    const anularFacturasPendientes = Boolean(body.anular_facturas_pendientes);

    if (!deletionReason) {
      return NextResponse.json(errorResponse("El motivo de eliminación es obligatorio"), { status: 400 });
    }


    /** Sin `.is("deleted_at", null)` en el SELECT: en algunos tenants la columna no existe en PostgREST. */
    const { data: cliente, error: errCliente } = await supabase
      .from("clientes")
      .select("id, empresa_id, deleted_at")
      .eq("id", clienteId)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errCliente || !cliente) {
      return NextResponse.json(errorResponse("Cliente no encontrado o ya eliminado"), { status: 404 });
    }

    const delAt = (cliente as { deleted_at?: string | null }).deleted_at;
    if (delAt != null && String(delAt).trim() !== "") {
      return NextResponse.json(errorResponse("Cliente no encontrado o ya eliminado"), { status: 404 });
    }

    const [ventas, tipif, suscActivas, factPend] = await Promise.all([
      supabase.from("ventas").select("id").eq("cliente_id", clienteId).limit(1),
      supabase.from("tipificaciones").select("id").eq("cliente_id", clienteId).limit(1),
      supabase
        .from("suscripciones")
        .select("id")
        .eq("cliente_id", clienteId)
        .eq("empresa_id", auth.empresa_id)
        .eq("estado", "activa"),
      supabase
        .from("facturas")
        .select("id")
        .eq("cliente_id", clienteId)
        .eq("empresa_id", auth.empresa_id)
        .neq("estado", "Anulado")
        .gt("saldo", 0),
    ]);

    const tieneVentas = (ventas.data?.length ?? 0) > 0;
    const tieneTipificaciones = (tipif.data?.length ?? 0) > 0;

    if (tieneVentas || tieneTipificaciones) {
      const partes: string[] = [];
      if (tieneVentas) partes.push("ventas");
      if (tieneTipificaciones) partes.push("tipificaciones");
      return NextResponse.json(
        errorResponse(`No se puede eliminar: el cliente tiene ${partes.join(" y ")} asociados`),
        { status: 400 }
      );
    }

    const nSuscActivas = suscActivas.data?.length ?? 0;
    const nFactPend = factPend.data?.length ?? 0;

    if (nSuscActivas > 0 && !cancelarSuscripciones) {
      return NextResponse.json(
        errorResponse(
          "Hay suscripciones activas. Confirme cancelarlas (cancelar_suscripciones: true) para continuar con la eliminación."
        ),
        { status: 400 }
      );
    }

    if (nFactPend > 0 && !anularFacturasPendientes) {
      return NextResponse.json(
        errorResponse(
          "Hay facturas con saldo pendiente. Confirme anularlas (anular_facturas_pendientes: true) para no afectar reportería, o gestione el cobro antes de eliminar."
        ),
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    if (cancelarSuscripciones && nSuscActivas > 0) {
      const { error: errSusc } = await supabase
        .from("suscripciones")
        .update({ estado: "cancelada" })
        .eq("cliente_id", clienteId)
        .eq("empresa_id", auth.empresa_id)
        .eq("estado", "activa");

      if (errSusc) {
        return NextResponse.json(errorResponse("Error al cancelar suscripciones: " + errSusc.message), { status: 500 });
      }
    }

    if (anularFacturasPendientes && nFactPend > 0) {
      // Antes: un UPDATE por factura (N round-trips a Postgres).
      // Ahora: un solo UPDATE con .in(ids) — reduce N queries a 1.
      // Mantiene el filtro de empresa_id para no afectar facturas de otros tenants.
      const facturaIds = (factPend.data ?? []).map((f) => f.id);
      if (facturaIds.length > 0) {
        const { error: errF } = await supabase
          .from("facturas")
          .update({ estado: "Anulado", saldo: 0, updated_at: now })
          .in("id", facturaIds)
          .eq("empresa_id", auth.empresa_id);

        if (errF) {
          return NextResponse.json(errorResponse("Error al anular facturas: " + errF.message), { status: 500 });
        }
      }
    }

    const { error: errUpdate } = await supabase
      .from("clientes")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by_user_id: auth.user.id,
        deletion_reason: deletionReason,
        updated_at: now,
      })
      .eq("id", clienteId)
      .eq("empresa_id", auth.empresa_id);

    if (errUpdate) {
      return NextResponse.json(errorResponse(errUpdate.message), { status: 500 });
    }

    return NextResponse.json(
      successResponse({
        deleted: true,
        suscripciones_canceladas: cancelarSuscripciones && nSuscActivas > 0,
        facturas_anuladas: anularFacturasPendientes && nFactPend > 0,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
