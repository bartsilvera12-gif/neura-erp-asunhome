import { createClient } from "@supabase/supabase-js";
import { supabaseServiceRoleClientOptions } from "@/lib/supabase/schema";
import { NextResponse } from "next/server";
import {
  esRolAdminEmpresa,
  filterModuloIdsForEmpresa,
} from "@/lib/modulos/resolve-effective-modules";
import { filterDashboardViewIdsForEmpresa } from "@/lib/dashboard/resolve-effective-dashboard-views";
import { syncUsuarioDashboardViews } from "@/lib/dashboard/sync-usuario-dashboard-views";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Config no disponible");
  return createClient(url, key, { ...supabaseServiceRoleClientOptions });
}

/** Obtiene el auth user id: usa auth_user_id si existe, sino busca por email en listUsers (con paginación). */
async function getAuthUserId(supabase: ReturnType<typeof getSupabase>, usuario: { auth_user_id?: string | null; email?: string }) {
  if (usuario.auth_user_id) return usuario.auth_user_id;
  const emailBuscado = (usuario.email ?? "").trim().toLowerCase();
  if (!emailBuscado) return null;
  let page = 1;
  while (true) {
    const { data } = await supabase.auth.admin.listUsers({ page, perPage: 500 });
    const users = data?.users ?? [];
    const found = users.find((u) => (u.email ?? "").toLowerCase() === emailBuscado);
    if (found) return found.id;
    if (users.length < 500) break;
    page++;
  }
  return null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = getSupabase();
    const { data: usuario, error } = await supabase
      .from("usuarios")
      .select("id, nombre, email, telefono, fecha_nacimiento, rol, estado, created_at")
      .eq("id", id)
      .single();
    if (error || !usuario) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }
    return NextResponse.json(usuario);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const {
      nombre,
      email,
      telefono,
      fecha_nacimiento,
      estado,
      modulo_ids,
      dashboard_view_ids,
      default_dashboard_view_id,
    } = body;

    const supabase = getSupabase();

    const { data: usuario, error: errGet } = await supabase
      .from("usuarios")
      .select("id, email, nombre, estado, auth_user_id, empresa_id, rol")
      .eq("id", id)
      .single();

    if (errGet || !usuario) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    const authUserId = await getAuthUserId(supabase, usuario);

    const updates: Record<string, unknown> = {};
    if (nombre !== undefined) updates.nombre = nombre;
    if (estado !== undefined) updates.estado = estado;
    if (telefono !== undefined) updates.telefono = telefono || null;
    if (fecha_nacimiento !== undefined) updates.fecha_nacimiento = fecha_nacimiento || null;

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
          { error: "No se puede cambiar el email: usuario de autenticación no encontrado. Ejecutá la migración para poblar auth_user_id." },
          { status: 400 }
        );
      }
      const { error: errAuth } = await supabase.auth.admin.updateUserById(authUserId, {
        email: nuevoEmail,
        email_confirm: true,
      });
      if (errAuth) {
        return NextResponse.json({ error: `Error al actualizar email en autenticación: ${errAuth.message}` }, { status: 400 });
      }
      updates.email = nuevoEmail;
      if (!usuario.auth_user_id) {
        updates.auth_user_id = authUserId;
      }
    }

    if (Object.keys(updates).length > 0) {
      const { error: errUpdate } = await supabase
        .from("usuarios")
        .update(updates)
        .eq("id", id);
      if (errUpdate) {
        return NextResponse.json({ error: errUpdate.message }, { status: 400 });
      }
    }

    if (Array.isArray(modulo_ids) && !esRolAdminEmpresa(usuario.rol)) {
      if (!usuario.empresa_id) {
        return NextResponse.json(
          { error: "El usuario no tiene empresa; no se pueden asignar módulos." },
          { status: 400 }
        );
      }
      const validIds = await filterModuloIdsForEmpresa(supabase, usuario.empresa_id, modulo_ids);
      const { error: errDel } = await supabase.from("usuario_modulos").delete().eq("usuario_id", id);
      if (errDel) {
        return NextResponse.json({ error: `Error al guardar módulos. Ejecutá las migraciones: ${errDel.message}` }, { status: 400 });
      }
      if (validIds.length > 0) {
        const rows = validIds.map((modulo_id: string) => ({ usuario_id: id, modulo_id }));
        const { error: errMod } = await supabase.from("usuario_modulos").insert(rows);
        if (errMod) {
          return NextResponse.json({ error: `Error al guardar módulos: ${errMod.message}` }, { status: 400 });
        }
      }
    }

    const dashProvided = Object.prototype.hasOwnProperty.call(body, "dashboard_view_ids");
    if (dashProvided && Array.isArray(dashboard_view_ids) && !esRolAdminEmpresa(usuario.rol)) {
      if (!usuario.empresa_id) {
        return NextResponse.json(
          { error: "El usuario no tiene empresa; no se pueden asignar vistas de dashboard." },
          { status: 400 }
        );
      }
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

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
