import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/middleware/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getClientesSupabaseFromAuthWithRol } from "@/lib/clientes/clientes-service-client";
import {
  ensureSemillasCatalogoTipos,
  generarSlugDesdeNombre,
} from "@/lib/clientes/tipo-servicio-catalogo";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { SLUGS_TIPOS_CLIENTE_SISTEMA } from "@/lib/clientes/tipo-servicio-catalogo";

type Row = {
  id: string;
  empresa_id: string;
  slug: string;
  nombre: string;
  activo: boolean;
  orden: number;
  es_sistema: boolean;
  created_at: string;
  updated_at: string;
  usos?: number;
};

async function loadRows(
  supabase: AppSupabaseClient,
  empresaId: string,
  soloActivos: boolean
): Promise<Row[]> {
  let q = supabase
    .from("cliente_tipos_servicio_catalogo")
    .select("id, empresa_id, slug, nombre, activo, orden, es_sistema, created_at, updated_at")
    .eq("empresa_id", empresaId)
    .order("orden", { ascending: true });
  if (soloActivos) {
    q = q.eq("activo", true);
  }
  const { data, error } = await q;
  if (error) {
    throw new Error(error.message);
  }
  return (data as Row[]) ?? [];
}

/**
 * GET /api/cliente-tipos-servicio?form=1 — solo activos, lectura (formularios).
 * GET /api/cliente-tipos-servicio?all=1&with_usos=1 — listado de configuración (admin).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getClientesSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;
    const sp = request.nextUrl.searchParams;
    const isForm = sp.get("all") !== "1";
    if (isForm) {
      await ensureSemillasCatalogoTipos(supabase, auth.empresa_id);
      const rows = await loadRows(supabase, auth.empresa_id, true);
      const include = sp.get("include_slug")?.trim();
      if (include) {
        const low = include.toLowerCase();
        if (!rows.some((r) => r.slug === low)) {
          const { data: one } = await supabase
            .from("cliente_tipos_servicio_catalogo")
            .select("id, empresa_id, slug, nombre, activo, orden, es_sistema, created_at, updated_at")
            .eq("empresa_id", auth.empresa_id)
            .eq("slug", low)
            .maybeSingle();
          if (one) {
            return NextResponse.json(successResponse([one as Row, ...rows].sort((a, b) => a.orden - b.orden)));
          }
        }
      }
      return NextResponse.json(successResponse(rows));
    }
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(errorResponse("Sólo administradores"), { status: 403 });
    }
    await ensureSemillasCatalogoTipos(supabase, auth.empresa_id);
    const withUsos = sp.get("with_usos") === "1";
    const rows = await loadRows(supabase, auth.empresa_id, false);
    if (withUsos) {
      // Antes: N count() queries (una por slug del catalogo, tipicamente 10-30 por empresa).
      // Ahora: una sola SELECT que trae solo la columna tipo_servicio_cliente y agrupa en JS.
      // Para empresas con miles de clientes esto es 30x menos round-trips al pool.
      const { data: clientesSlugs, error: errCount } = await supabase
        .from("clientes")
        .select("tipo_servicio_cliente")
        .eq("empresa_id", auth.empresa_id)
        .is("deleted_at", null);
      if (errCount) {
        return NextResponse.json(errorResponse(errCount.message), { status: 400 });
      }
      const counts = new Map<string, number>();
      for (const row of (clientesSlugs ?? []) as { tipo_servicio_cliente: string | null }[]) {
        const s = (row.tipo_servicio_cliente ?? "").trim().toLowerCase();
        if (!s) continue;
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
      const withCounts: Row[] = rows.map((r) => ({ ...r, usos: counts.get(r.slug) ?? 0 }));
      return NextResponse.json(successResponse(withCounts));
    }
    return NextResponse.json(successResponse(rows));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

/**
 * POST { nombre: string, orden?: number } — admin; crea fila no-sistema, slug autogenerado.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getClientesSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    if (!isAdmin(ctx.auth)) {
      return NextResponse.json(errorResponse("Sólo administradores"), { status: 403 });
    }
    const { supabase, auth } = ctx;
    await ensureSemillasCatalogoTipos(supabase, auth.empresa_id);
    const body = await request.json();
    const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
    if (!nombre || nombre.length > 200) {
      return NextResponse.json(errorResponse("nombre inválido"), { status: 400 });
    }
    const { data: exist, error: errList } = await supabase
      .from("cliente_tipos_servicio_catalogo")
      .select("slug")
      .eq("empresa_id", auth.empresa_id);
    if (errList) {
      return NextResponse.json(errorResponse(errList.message), { status: 400 });
    }
    const set = new Set<string>([
      ...((exist as { slug: string }[] | null)?.map((e) => e.slug) ?? []),
      ...SLUGS_TIPOS_CLIENTE_SISTEMA,
    ]);
    const slug = generarSlugDesdeNombre(nombre, set);
    const ordenBody = body.orden;
    const orden = typeof ordenBody === "number" && Number.isFinite(ordenBody) ? Math.trunc(ordenBody) : 0;

    const { data, error } = await supabase
      .from("cliente_tipos_servicio_catalogo")
      .insert({
        empresa_id: auth.empresa_id,
        slug,
        nombre: nombre.length > 200 ? `${nombre.slice(0, 197)}…` : nombre,
        activo: true,
        orden: Math.max(0, Math.min(32000, orden || 0)),
        es_sistema: false,
      })
      .select("id, empresa_id, slug, nombre, activo, orden, es_sistema, created_at, updated_at")
      .single();
    if (error) {
      if (String(error.message).toLowerCase().includes("unique")) {
        return NextResponse.json(errorResponse("Ya existe un tipo con ese identificador"), { status: 400 });
      }
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    return NextResponse.json(successResponse(data), { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
