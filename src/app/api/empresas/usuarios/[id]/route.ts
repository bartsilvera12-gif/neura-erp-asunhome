import { supabaseServiceRoleClientOptions } from "@/lib/supabase/schema";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getServiceAuthUsuario } from "@/lib/auth/get-service-auth-usuario";
import {
  esRolAdminEmpresa,
  filterModuloIdsForEmpresa,
} from "@/lib/modulos/resolve-effective-modules";
import {
  filterDashboardViewIdsForEmpresa,
} from "@/lib/dashboard/resolve-effective-dashboard-views";
import { syncUsuarioDashboardViews } from "@/lib/dashboard/sync-usuario-dashboard-views";
import { createServiceRoleClientForEmpresa } from "@/lib/supabase/empresa-data-schema";
import {
  isUsuariosOmnicanalTenantUnavailableError,
  sanitizePostgrestErrorForLog,
} from "@/lib/chat/postgrest-schema-error";

const ERP_ROLES = ["usuario", "supervisor", "administrador"] as const;

const OMNICANAL_PATCH_UNAVAILABLE_MSG =
  "La configuración omnicanal no se pudo guardar porque el schema tenant no está disponible por PostgREST.";

type OmnicanalPack = {
  agent_enabled: boolean;
  work_schedule_id: string | null;
  schedules: {
    id: string;
    nombre: string;
    time_start: string;
    time_end: string;
    days_of_week: number[];
    is_active: boolean;
  }[];
};

const EMPTY_OMNICANAL: OmnicanalPack = {
  agent_enabled: false,
  work_schedule_id: null,
  schedules: [],
};

/**
 * Preferencias omnicanal en schema tenant (chat_*). Si PostgREST no expone el schema o falla la tabla, no rompe el GET.
 */
async function loadOmnicanalPackForUsuarioDetail(empresaId: string, usuarioId: string): Promise<OmnicanalPack> {
  try {
    const tenant = await createServiceRoleClientForEmpresa(empresaId);
    const prefsRes = await tenant
      .from("chat_usuario_omnicanal")
      .select("omnicanal_agent_enabled, work_schedule_id")
      .eq("empresa_id", empresaId)
      .eq("usuario_id", usuarioId)
      .maybeSingle();
    const schedRes = await tenant
      .from("chat_omnicanal_work_schedules")
      .select("id, nombre, time_start, time_end, days_of_week, is_active")
      .eq("empresa_id", empresaId)
      .order("nombre", { ascending: true });

    const errMsg = prefsRes.error?.message ?? schedRes.error?.message ?? "";
    if (prefsRes.error || schedRes.error) {
      console.warn("[usuarios_omnicanal_get_fallback]", {
        context: "usuarios_omnicanal_get_fallback",
        empresa_id: empresaId,
        usuario_id: usuarioId,
        error: sanitizePostgrestErrorForLog(errMsg),
      });
      return EMPTY_OMNICANAL;
    }

    const pr = prefsRes.data as {
      omnicanal_agent_enabled?: boolean;
      work_schedule_id?: string | null;
    } | null;
    return {
      agent_enabled: Boolean(pr?.omnicanal_agent_enabled),
      work_schedule_id: (pr?.work_schedule_id as string | null | undefined) ?? null,
      schedules: (schedRes.data ?? []) as OmnicanalPack["schedules"],
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[usuarios_omnicanal_get_fallback]", {
      context: "usuarios_omnicanal_get_fallback",
      empresa_id: empresaId,
      usuario_id: usuarioId,
      error: sanitizePostgrestErrorForLog(msg),
    });
    return EMPTY_OMNICANAL;
  }
}

function patchOptionalDecimal(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : null;
}

function patchNullableDate(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  return String(v);
}

function patchNullableContrato(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const s = String(v).trim().toLowerCase();
  const ok = ["salario", "comision", "mixto", "prestador_servicio"].includes(s);
  return ok ? s : null;
}

function patchNullableArea(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const s = String(v).trim().toLowerCase();
  const ok = ["ventas", "soporte", "finanzas", "operaciones", "administracion"].includes(s);
  return ok ? s : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getAuthUserId(supabase: any, usuario: { auth_user_id?: string | null; email?: string }): Promise<string | null> {
  if (usuario.auth_user_id) return usuario.auth_user_id;
  const emailBuscado = (usuario.email ?? "").trim().toLowerCase();
  if (!emailBuscado) return null;
  let page = 1;
  while (true) {
    const { data } = await supabase.auth.admin.listUsers({ page, perPage: 500 });
    const users = data?.users ?? [];
    const found = users.find((u: { id: string; email?: string }) => (u.email ?? "").toLowerCase() === emailBuscado);
    if (found) return found.id;
    if (users.length < 500) break;
    page++;
  }
  return null;
}

/** Obtiene un usuario. Solo si pertenece a la empresa del usuario autenticado (o super_admin). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return NextResponse.json({ error: "Config no disponible" }, { status: 500 });
    }

    const authR = await getServiceAuthUsuario(request);
    if (!authR.ok) {
      return NextResponse.json({ error: "No autenticado" }, { status: authR.status });
    }
    if (!authR.catalogUsuario) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    const supabase = createClient(url, serviceKey, { ...supabaseServiceRoleClientOptions });
    const currentUser = {
      empresa_id: authR.catalogUsuario.empresa_id ?? undefined,
      rol: authR.catalogUsuario.rol ?? undefined,
    };

    const { data: usuario, error } = await supabase
      .from("usuarios")
      .select(
        "id, nombre, email, telefono, fecha_nacimiento, fecha_ingreso, tipo_contrato, salario_base, porcentaje_comision, ips, area, rol, estado, created_at, empresa_id"
      )
      .eq("id", id)
      .single();

    if (error || !usuario) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    if (currentUser?.rol !== "super_admin" && usuario.empresa_id !== currentUser?.empresa_id) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }

    let modulo_ids: string[] = [];
    let modulos_empresa: { id: string; nombre: string; slug: string }[] = [];

    if (usuario.empresa_id) {
      const { data: emData } = await supabase
        .from("empresa_modulos")
        .select("modulo_id")
        .eq("empresa_id", usuario.empresa_id)
        .eq("activo", true);
      const mids = (emData ?? []).map((r) => r.modulo_id as string).filter(Boolean);
      if (mids.length > 0) {
        const { data: modRows } = await supabase
          .from("modulos")
          .select("id, nombre, slug")
          .in("id", mids)
          .order("slug");
        modulos_empresa = (modRows ?? []).map((m) => ({
          id: m.id as string,
          nombre: (m.nombre as string) ?? "",
          slug: (m.slug as string) ?? "",
        }));
      }

      const { data: umData } = await supabase
        .from("usuario_modulos")
        .select("modulo_id")
        .eq("usuario_id", id);
      modulo_ids = (umData ?? []).map((r) => (r as { modulo_id: string }).modulo_id);
      if (esRolAdminEmpresa(usuario.rol)) {
        modulo_ids = mids;
      }
    }

    let dashboard_views_empresa: { id: string; nombre: string; slug: string; orden: number }[] = [];
    let dashboard_view_ids: string[] = [];
    let default_dashboard_view_id: string | null = null;

    if (usuario.empresa_id) {
      const { data: edvEmp } = await supabase
        .from("empresa_dashboard_views")
        .select("dashboard_view_id")
        .eq("empresa_id", usuario.empresa_id)
        .eq("activo", true);
      const edvIds = (edvEmp ?? [])
        .map((r) => (r as { dashboard_view_id: string }).dashboard_view_id)
        .filter(Boolean);
      if (edvIds.length > 0) {
        const { data: dvCat } = await supabase
          .from("dashboard_views")
          .select("id, nombre, slug, orden")
          .in("id", edvIds)
          .order("orden", { ascending: true });
        dashboard_views_empresa = (dvCat ?? []).map((m) => ({
          id: m.id as string,
          nombre: (m.nombre ?? "") as string,
          slug: (m.slug ?? "") as string,
          orden: Number((m as { orden?: unknown }).orden) || 0,
        }));
      }

      const { data: udvRows } = await supabase
        .from("usuario_dashboard_views")
        .select("dashboard_view_id, es_default")
        .eq("usuario_id", id);
      dashboard_view_ids = (udvRows ?? []).map((r) => (r as { dashboard_view_id: string }).dashboard_view_id);
      if (esRolAdminEmpresa(usuario.rol)) {
        dashboard_view_ids = edvIds;
      }
      const def = (udvRows ?? []).find(
        (r) => (r as { es_default?: boolean }).es_default === true
      ) as { dashboard_view_id?: string } | undefined;
      default_dashboard_view_id = def?.dashboard_view_id ?? null;
    }

    const es_admin_empresa = esRolAdminEmpresa(usuario.rol);

    const puede_editar_modulos =
      (currentUser?.rol ?? "").trim() === "super_admin" ||
      ["admin", "administrador"].includes((currentUser?.rol ?? "").trim());

    const puede_editar_rol =
      (currentUser?.rol ?? "").trim() === "super_admin" ||
      ["admin", "administrador"].includes((currentUser?.rol ?? "").trim());

    let omnicanal: OmnicanalPack | null = null;
    if (usuario.empresa_id) {
      omnicanal = await loadOmnicanalPackForUsuarioDetail(usuario.empresa_id as string, id);
    }

    const { empresa_id: _e, ...rest } = usuario;
    return NextResponse.json({
      ...rest,
      modulo_ids,
      modulos_empresa,
      dashboard_views_empresa,
      dashboard_view_ids,
      default_dashboard_view_id,
      puede_editar_modulos,
      puede_editar_rol,
      es_admin_empresa,
      omnicanal,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Actualiza un usuario. Solo si pertenece a la empresa del usuario autenticado (o super_admin). */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return NextResponse.json({ error: "Config no disponible" }, { status: 500 });
    }

    const authR = await getServiceAuthUsuario(req);
    if (!authR.ok) {
      return NextResponse.json({ error: "No autenticado" }, { status: authR.status });
    }
    if (!authR.catalogUsuario) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    const supabase = createClient(url, serviceKey, { ...supabaseServiceRoleClientOptions });
    const currentUser = {
      empresa_id: authR.catalogUsuario.empresa_id ?? undefined,
      rol: authR.catalogUsuario.rol ?? undefined,
    };

    const body = await req.json();
    const moduloIdsProvided = Object.prototype.hasOwnProperty.call(body, "modulo_ids");
    const dashIdsProvided = Object.prototype.hasOwnProperty.call(body, "dashboard_view_ids");
    const {
      nombre,
      email,
      telefono,
      fecha_nacimiento,
      fecha_ingreso,
      tipo_contrato,
      salario_base,
      porcentaje_comision,
      ips,
      area,
      estado,
      modulo_ids,
      dashboard_view_ids,
      default_dashboard_view_id,
      rol: rolBody,
    } = body;

    const { data: usuario, error: errGet } = await supabase
      .from("usuarios")
      .select("id, email, estado, auth_user_id, empresa_id, rol")
      .eq("id", id)
      .single();

    if (errGet || !usuario) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    if (currentUser?.rol !== "super_admin" && usuario.empresa_id !== currentUser?.empresa_id) {
      return NextResponse.json({ error: "Sin permiso para editar este usuario" }, { status: 403 });
    }

    const rolEditor = (currentUser?.rol ?? "").trim();
    const puedeModulos =
      rolEditor === "super_admin" || ["admin", "administrador"].includes(rolEditor);

    const puede_editar_rol =
      rolEditor === "super_admin" || ["admin", "administrador"].includes(rolEditor);

    if (Array.isArray(modulo_ids) && !puedeModulos) {
      return NextResponse.json({ error: "Sin permiso para asignar módulos" }, { status: 403 });
    }

    if (rolBody !== undefined && !puede_editar_rol) {
      return NextResponse.json({ error: "Sin permiso para cambiar el nivel de acceso" }, { status: 403 });
    }

    const rolNormalizado =
      rolBody !== undefined ? String(rolBody).trim().toLowerCase() : undefined;
    if (
      rolNormalizado !== undefined &&
      !(ERP_ROLES as readonly string[]).includes(rolNormalizado)
    ) {
      return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
    }

    const finalRol =
      rolNormalizado !== undefined ? rolNormalizado : String(usuario.rol ?? "usuario").trim().toLowerCase();

    const authUserId = await getAuthUserId(supabase, usuario);

    const updates: Record<string, unknown> = {};
    if (nombre !== undefined) updates.nombre = nombre;
    if (estado !== undefined) updates.estado = estado;
    if (telefono !== undefined) updates.telefono = telefono || null;
    if (fecha_nacimiento !== undefined) updates.fecha_nacimiento = fecha_nacimiento || null;

    const pi = patchOptionalDecimal(porcentaje_comision);
    if (pi !== undefined) {
      if (pi !== null && (pi < 0 || pi > 100)) {
        return NextResponse.json({ error: "Comisión debe estar entre 0 y 100." }, { status: 400 });
      }
      updates.porcentaje_comision = pi;
    }

    const sb = patchOptionalDecimal(salario_base);
    if (sb !== undefined) updates.salario_base = sb;

    const fi = patchNullableDate(fecha_ingreso);
    if (fi !== undefined) updates.fecha_ingreso = fi;

    const tc = patchNullableContrato(tipo_contrato);
    if (tc !== undefined) updates.tipo_contrato = tc;

    const ar = patchNullableArea(area);
    if (ar !== undefined) updates.area = ar;

    if (ips !== undefined) updates.ips = Boolean(ips);

    if (rolNormalizado !== undefined) updates.rol = rolNormalizado;

    if (estado !== undefined && authUserId) {
      const banDuration = estado === "inactivo" ? "876000h" : "none";
      await supabase.auth.admin.updateUserById(authUserId, {
        ban_duration: banDuration,
      } as { ban_duration?: string });
    }

    const nuevoEmail = email !== undefined ? email.trim().toLowerCase() : null;
    const emailCambia = nuevoEmail !== null && nuevoEmail !== (usuario.email ?? "");

    if (emailCambia) {
      if (!authUserId) {
        return NextResponse.json(
          { error: "No se puede cambiar el email: usuario de autenticación no encontrado." },
          { status: 400 }
        );
      }
      const { error: errAuth } = await supabase.auth.admin.updateUserById(authUserId, {
        email: nuevoEmail,
        email_confirm: true,
      });
      if (errAuth) {
        return NextResponse.json({ error: `Error al actualizar email: ${errAuth.message}` }, { status: 400 });
      }
      updates.email = nuevoEmail;
      if (!usuario.auth_user_id) updates.auth_user_id = authUserId;
    }

    if (Object.keys(updates).length > 0) {
      const { error: errUpdate } = await supabase.from("usuarios").update(updates).eq("id", id);
      if (errUpdate) {
        return NextResponse.json({ error: errUpdate.message }, { status: 400 });
      }
    }

    if (usuario.empresa_id && rolNormalizado !== undefined) {
      const oldWasAdmin = esRolAdminEmpresa(usuario.rol);
      const newIsAdmin = esRolAdminEmpresa(finalRol);

      if (!oldWasAdmin && newIsAdmin) {
        const { error: errDelA } = await supabase.from("usuario_modulos").delete().eq("usuario_id", id);
        if (errDelA) return NextResponse.json({ error: errDelA.message }, { status: 400 });
      } else if (oldWasAdmin && !newIsAdmin) {
        const { error: errDelD } = await supabase.from("usuario_modulos").delete().eq("usuario_id", id);
        if (errDelD) return NextResponse.json({ error: errDelD.message }, { status: 400 });
        if (!moduloIdsProvided) {
          const { data: emActivos } = await supabase
            .from("empresa_modulos")
            .select("modulo_id")
            .eq("empresa_id", usuario.empresa_id)
            .eq("activo", true);
          const umRows = (emActivos ?? []).map((r) => ({
            usuario_id: id,
            modulo_id: r.modulo_id as string,
          }));
          if (umRows.length > 0) {
            const { error: errInsS } = await supabase.from("usuario_modulos").insert(umRows);
            if (errInsS) return NextResponse.json({ error: errInsS.message }, { status: 400 });
          }
        }
      }
    }

    if (Array.isArray(modulo_ids) && usuario.empresa_id && !esRolAdminEmpresa(finalRol)) {
      const validIds = await filterModuloIdsForEmpresa(supabase, usuario.empresa_id, modulo_ids);
      const { error: errDel } = await supabase.from("usuario_modulos").delete().eq("usuario_id", id);
      if (errDel) {
        return NextResponse.json({ error: errDel.message }, { status: 400 });
      }
      if (validIds.length > 0) {
        const rows = validIds.map((modulo_id: string) => ({ usuario_id: id, modulo_id }));
        const { error: errIns } = await supabase.from("usuario_modulos").insert(rows);
        if (errIns) {
          return NextResponse.json({ error: errIns.message }, { status: 400 });
        }
      }
    }

    if (
      dashIdsProvided &&
      Array.isArray(dashboard_view_ids) &&
      usuario.empresa_id &&
      !esRolAdminEmpresa(finalRol) &&
      puedeModulos
    ) {
      const validDv = await filterDashboardViewIdsForEmpresa(
        supabase,
        usuario.empresa_id,
        dashboard_view_ids
      );
      const defRaw =
        default_dashboard_view_id === null || default_dashboard_view_id === undefined
          ? null
          : String(default_dashboard_view_id).trim();
      let defId = defRaw && validDv.includes(defRaw) ? defRaw : null;
      if (!defId && validDv.length === 1) defId = validDv[0];
      await syncUsuarioDashboardViews(supabase, id, validDv, defId);
    }

    const omnicanalProvided =
      Object.prototype.hasOwnProperty.call(body, "omnicanal_agent_enabled") ||
      Object.prototype.hasOwnProperty.call(body, "omnicanal_work_schedule_id");

    let omnicanal_warning: string | undefined;

    if (omnicanalProvided && usuario.empresa_id) {
      if (!puedeModulos) {
        return NextResponse.json({ error: "Sin permiso para editar preferencias omnicanal" }, { status: 403 });
      }

      const enabledRaw = body.omnicanal_agent_enabled;
      const enabled =
        typeof enabledRaw === "boolean"
          ? enabledRaw
          : enabledRaw === "true" || enabledRaw === true || enabledRaw === 1 || enabledRaw === "1";

      let scheduleId: string | null =
        body.omnicanal_work_schedule_id === null || body.omnicanal_work_schedule_id === ""
          ? null
          : String(body.omnicanal_work_schedule_id).trim();

      if (!enabled) {
        scheduleId = null;
      }

      try {
        const tenant = await createServiceRoleClientForEmpresa(usuario.empresa_id as string);
        let skipOmnicanalWrite = false;

        if (enabled && scheduleId) {
          const schRes = await tenant
            .from("chat_omnicanal_work_schedules")
            .select("id")
            .eq("empresa_id", usuario.empresa_id)
            .eq("id", scheduleId)
            .maybeSingle();
          if (schRes.error) {
            if (isUsuariosOmnicanalTenantUnavailableError(schRes.error.message)) {
              skipOmnicanalWrite = true;
              omnicanal_warning = OMNICANAL_PATCH_UNAVAILABLE_MSG;
              console.warn("[usuarios_omnicanal_patch_fallback]", {
                context: "usuarios_omnicanal_patch_fallback",
                empresa_id: usuario.empresa_id,
                usuario_id: id,
                error: sanitizePostgrestErrorForLog(schRes.error.message),
              });
            } else {
              return NextResponse.json({ error: schRes.error.message }, { status: 400 });
            }
          } else if (!schRes.data) {
            return NextResponse.json(
              { error: "Horario omnicanal inválido para esta empresa." },
              { status: 400 }
            );
          }
        }

        if (!skipOmnicanalWrite) {
          const ts = new Date().toISOString();
          const { error: oe } = await tenant.from("chat_usuario_omnicanal").upsert(
            {
              empresa_id: usuario.empresa_id,
              usuario_id: id,
              omnicanal_agent_enabled: enabled,
              work_schedule_id: scheduleId,
              updated_at: ts,
              created_at: ts,
            },
            { onConflict: "empresa_id,usuario_id" }
          );
          if (oe) {
            if (isUsuariosOmnicanalTenantUnavailableError(oe.message)) {
              omnicanal_warning = OMNICANAL_PATCH_UNAVAILABLE_MSG;
              console.warn("[usuarios_omnicanal_patch_fallback]", {
                context: "usuarios_omnicanal_patch_fallback",
                empresa_id: usuario.empresa_id,
                usuario_id: id,
                error: sanitizePostgrestErrorForLog(oe.message),
              });
            } else {
              const m = (oe.message ?? "").toLowerCase();
              const legacySoft =
                m.includes("does not exist") || m.includes("schema cache") || m.includes("could not find");
              if (legacySoft) {
                omnicanal_warning = OMNICANAL_PATCH_UNAVAILABLE_MSG;
                console.warn("[usuarios_omnicanal_patch_fallback]", {
                  context: "usuarios_omnicanal_patch_fallback",
                  empresa_id: usuario.empresa_id,
                  usuario_id: id,
                  error: sanitizePostgrestErrorForLog(oe.message),
                });
              } else {
                return NextResponse.json({ error: oe.message }, { status: 400 });
              }
            }
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isUsuariosOmnicanalTenantUnavailableError(msg)) {
          omnicanal_warning = OMNICANAL_PATCH_UNAVAILABLE_MSG;
          console.warn("[usuarios_omnicanal_patch_fallback]", {
            context: "usuarios_omnicanal_patch_fallback",
            empresa_id: usuario.empresa_id,
            usuario_id: id,
            error: sanitizePostgrestErrorForLog(msg),
          });
        } else {
          return NextResponse.json({ error: msg }, { status: 500 });
        }
      }
    }

    return NextResponse.json({
      success: true,
      ...(omnicanal_warning ? { omnicanal_warning } : {}),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
