import { createClient } from "@supabase/supabase-js";
import { supabaseServiceRoleClientOptions } from "@/lib/supabase/schema";
import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import { NextResponse } from "next/server";
import { esRolAdminEmpresa } from "@/lib/modulos/resolve-effective-modules";
import { ensureOmnicanalDashboardEmpresaModulos } from "@/lib/empresas/ensure-omnicanal-dashboard-empresa-modulos";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json({ error: "Config no disponible" }, { status: 500 });
    }

    const supabase = createClient(url, key, { ...supabaseServiceRoleClientOptions });

    // 1. Empresa
    const { data: empresa, error: errEmpresa } = await supabase
      .from("empresas")
      .select("*")
      .eq("id", id)
      .single();

    if (errEmpresa || !empresa) {
      return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    }

    const { data: emData } = await supabase
      .from("empresa_modulos")
      .select("modulo_id")
      .eq("empresa_id", id)
      .eq("activo", true);

    const empresaModuloIds = (emData ?? []).map((r) => r.modulo_id).filter(Boolean) as string[];

    const { data: edvData } = await supabase
      .from("empresa_dashboard_views")
      .select("dashboard_view_id")
      .eq("empresa_id", id)
      .eq("activo", true);
    const empresaDashboardViewIds = (edvData ?? [])
      .map((r) => (r as { dashboard_view_id?: string }).dashboard_view_id)
      .filter(Boolean) as string[];

    // 2. Usuarios de la empresa (incluye estado y módulos si existe)
    const { data: usuariosRaw } = await supabase
      .from("usuarios")
      .select("id, nombre, email, rol, estado, created_at")
      .eq("empresa_id", id)
      .order("created_at", { ascending: false });

    const usuarios = usuariosRaw ?? [];
    const userIds = usuarios.map((u) => u.id);

    const usuarioModulosMap: Record<string, string[]> = {};
    const usuarioDashboardMap: Record<string, string[]> = {};
    if (userIds.length > 0) {
      const { data: umData } = await supabase
        .from("usuario_modulos")
        .select("usuario_id, modulo_id")
        .in("usuario_id", userIds);
      if (umData) {
        for (const row of umData) {
          const uid = (row as { usuario_id: string }).usuario_id;
          const mid = (row as { modulo_id: string }).modulo_id;
          if (!usuarioModulosMap[uid]) usuarioModulosMap[uid] = [];
          usuarioModulosMap[uid].push(mid);
        }
      }

      const { data: udvData } = await supabase
        .from("usuario_dashboard_views")
        .select("usuario_id, dashboard_view_id")
        .in("usuario_id", userIds);
      if (udvData) {
        for (const row of udvData) {
          const uid = (row as { usuario_id: string }).usuario_id;
          const vid = (row as { dashboard_view_id: string }).dashboard_view_id;
          if (!usuarioDashboardMap[uid]) usuarioDashboardMap[uid] = [];
          usuarioDashboardMap[uid].push(vid);
        }
      }
    }

    const usuariosConModulos = usuarios.map((u) => ({
      ...u,
      modulo_ids: esRolAdminEmpresa(u.rol) ? [...empresaModuloIds] : usuarioModulosMap[u.id] ?? [],
      dashboard_view_ids: esRolAdminEmpresa(u.rol)
        ? [...empresaDashboardViewIds]
        : usuarioDashboardMap[u.id] ?? [],
    }));

    // 3. Módulos habilitados (empresa_modulos + modulos)
    const moduloIds = empresaModuloIds;
    let modulos: { id: string; nombre: string; slug: string }[] = [];

    if (moduloIds.length > 0) {
      const { data: mod } = await supabase
        .from("modulos")
        .select("id, nombre, slug")
        .in("id", moduloIds);
      modulos = (mod ?? []).map((m) => ({
        id: m.id,
        nombre: (m.nombre ?? m.id) as string,
        slug: (m.slug ?? "") as string,
      }));
    }

    let dashboard_views: { id: string; nombre: string; slug: string; orden: number }[] = [];
    if (empresaDashboardViewIds.length > 0) {
      const { data: dvRows } = await supabase
        .from("dashboard_views")
        .select("id, nombre, slug, orden")
        .in("id", empresaDashboardViewIds)
        .order("orden", { ascending: true });
      dashboard_views = (dvRows ?? []).map((m) => ({
        id: m.id as string,
        nombre: (m.nombre ?? "") as string,
        slug: (m.slug ?? "") as string,
        orden: Number((m as { orden?: unknown }).orden) || 0,
      }));
    }

    return NextResponse.json({
      empresa,
      usuarios: usuariosConModulos,
      modulos,
      dashboard_views,
      dashboard_view_ids: empresaDashboardViewIds,
    });
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
    const { nombre_empresa, ruc, plan, estado, modulo_ids, dashboard_view_ids } = body;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json({ error: "Config no disponible" }, { status: 500 });
    }

    const supabase = createClient(url, key, { ...supabaseServiceRoleClientOptions });

    // 1. Actualizar empresa
    const updateEmpresa: Record<string, unknown> = {};
    if (nombre_empresa !== undefined) updateEmpresa.nombre_empresa = nombre_empresa;
    if (ruc !== undefined) updateEmpresa.ruc = ruc;
    if (plan !== undefined) updateEmpresa.plan = plan;
    if (estado !== undefined) updateEmpresa.estado = estado;

    if (Object.keys(updateEmpresa).length > 0) {
      const { error: errUpdate } = await supabase
        .from("empresas")
        .update(updateEmpresa)
        .eq("id", id);

      if (errUpdate) {
        return NextResponse.json({ error: errUpdate.message }, { status: 400 });
      }
    }

    // 2. Actualizar módulos habilitados
    if (Array.isArray(modulo_ids)) {
      await supabase.from("empresa_modulos").delete().eq("empresa_id", id);

      if (modulo_ids.length > 0) {
        const rows = modulo_ids.map((modulo_id: string) => ({
          empresa_id: id,
          modulo_id,
          activo: true,
        }));
        const { error: errMod } = await supabase.from("empresa_modulos").insert(rows);
        if (errMod) {
          return NextResponse.json(
            { error: `Empresa actualizada pero error en módulos: ${errMod.message}` },
            { status: 400 }
          );
        }
      }

      const ensured = await ensureOmnicanalDashboardEmpresaModulos(supabase, id);
      if (!ensured.ok) {
        return NextResponse.json(
          { error: `Módulos omnicanal: ${ensured.error}` },
          { status: 400 }
        );
      }

      const { data: emActive } = await supabase
        .from("empresa_modulos")
        .select("modulo_id")
        .eq("empresa_id", id)
        .eq("activo", true);
      const allowed = new Set(
        (emActive ?? []).map((r) => String((r as { modulo_id: string }).modulo_id)).filter(Boolean)
      );
      const { data: userRows } = await supabase.from("usuarios").select("id").eq("empresa_id", id);
      const uids = (userRows ?? []).map((r) => r.id as string);
      if (uids.length > 0) {
        const { data: ums } = await supabase
          .from("usuario_modulos")
          .select("id, modulo_id")
          .in("usuario_id", uids);
        // Antes: un DELETE por fila huerfana (N round-trips).
        // Ahora: un solo DELETE con .in(ids). Si no hay huerfanas, no se ejecuta nada.
        const orphanIds = (ums ?? [])
          .filter((row) => !allowed.has(row.modulo_id as string))
          .map((row) => row.id as string);
        if (orphanIds.length > 0) {
          await supabase.from("usuario_modulos").delete().in("id", orphanIds);
        }
      }
    }

    // 3. Vistas de dashboard habilitadas para la empresa
    if (Array.isArray(dashboard_view_ids)) {
      await supabase.from("empresa_dashboard_views").delete().eq("empresa_id", id);

      if (dashboard_view_ids.length > 0) {
        const rows = dashboard_view_ids.map((dashboard_view_id: string) => ({
          empresa_id: id,
          dashboard_view_id,
          activo: true,
        }));
        const { error: errDv } = await supabase.from("empresa_dashboard_views").insert(rows);
        if (errDv) {
          return NextResponse.json(
            { error: `Empresa actualizada pero error en vistas de dashboard: ${errDv.message}` },
            { status: 400 }
          );
        }
      }

      const { data: edActive } = await supabase
        .from("empresa_dashboard_views")
        .select("dashboard_view_id")
        .eq("empresa_id", id)
        .eq("activo", true);
      const allowedDv = new Set(
        (edActive ?? []).map((r) => String((r as { dashboard_view_id: string }).dashboard_view_id)).filter(Boolean)
      );
      const { data: userRows2 } = await supabase.from("usuarios").select("id").eq("empresa_id", id);
      const uids2 = (userRows2 ?? []).map((r) => r.id as string);
      if (uids2.length > 0) {
        const { data: udvs } = await supabase
          .from("usuario_dashboard_views")
          .select("id, dashboard_view_id")
          .in("usuario_id", uids2);
        // Mismo patron que con usuario_modulos: batch DELETE en vez de N round-trips.
        const orphanDvIds = (udvs ?? [])
          .filter((row) => !allowedDv.has(row.dashboard_view_id as string))
          .map((row) => row.id as string);
        if (orphanDvIds.length > 0) {
          await supabase.from("usuario_dashboard_views").delete().in("id", orphanDvIds);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Elimina la empresa, sus filas en catálogo (CASCADE) y el schema tenant (`BEFORE DELETE` en empresas).
 * Luego borra usuarios en GoTrue para no dejar sesiones huérfanas.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json({ error: "Config no disponible" }, { status: 500 });
    }

    const user = await getAuthUserForApiRoute(request);
    if (!user?.id) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const supabase = createClient(url, key, { ...supabaseServiceRoleClientOptions });
    const usuario = await resolveUsuarioErpFromAuthUser(supabase, user);
    const rolSuper = (usuario?.rol ?? "").trim() === "super_admin";
    const bootstrapSuper = isBootstrapSuperAdminEmail(user.email);
    if (!rolSuper && !bootstrapSuper) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const { data: empresa, error: errEmpresa } = await supabase
      .from("empresas")
      .select("id, nombre_empresa")
      .eq("id", id)
      .maybeSingle();

    if (errEmpresa) {
      return NextResponse.json({ error: errEmpresa.message }, { status: 400 });
    }
    if (!empresa?.id) {
      return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
    }

    const { data: usuariosAuth, error: errU } = await supabase
      .from("usuarios")
      .select("auth_user_id")
      .eq("empresa_id", id);

    if (errU) {
      return NextResponse.json({ error: errU.message }, { status: 400 });
    }

    const authUserIds = [
      ...new Set(
        (usuariosAuth ?? [])
          .map((r) => (r as { auth_user_id?: string | null }).auth_user_id)
          .filter((x): x is string => typeof x === "string" && x.length > 0)
      ),
    ];

    const { error: errDel } = await supabase.from("empresas").delete().eq("id", id);
    if (errDel) {
      return NextResponse.json(
        { error: errDel.message },
        { status: 400 }
      );
    }

    // Antes: M llamadas seriales a GoTrue (una por usuario). M usuarios = M * latencia.
    // Ahora: paralelas con Promise.allSettled. Sigue siendo M llamadas (no hay batch upstream)
    // pero la latencia total pasa de O(M) a O(max(latencias)). Cada error se ignora
    // individualmente (idempotencia: el usuario puede haber sido borrado por otra via).
    await Promise.allSettled(
      authUserIds.map((authUid) => supabase.auth.admin.deleteUser(authUid)),
    );

    return NextResponse.json({
      ok: true,
      nombre_empresa: (empresa as { nombre_empresa?: string }).nombre_empresa ?? null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
