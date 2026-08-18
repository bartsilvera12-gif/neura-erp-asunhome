import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data, error } = await sb
      .from("proyecto_comentarios")
      .select("*")
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const rows = (data ?? []) as { usuario_id: string }[];
    const uids = [...new Set(rows.map((r) => r.usuario_id))];
    const catalog = createServiceRoleClient();
    const { data: names } =
      uids.length > 0
        ? await catalog.from("usuarios").select("id, nombre").eq("empresa_id", auth.empresaId).in("id", uids)
        : { data: [] as { id: string; nombre?: string }[] };
    const nameMap = new Map((names ?? []).map((u) => [u.id, u.nombre ?? ""]));

    const rich = rows.map((r) => ({
      ...r,
      usuario_nombre: nameMap.get(r.usuario_id) ?? null,
    }));

    return NextResponse.json(successResponse(rich));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  try {
    const body = (await request.json().catch(() => null)) as { comentario?: string } | null;
    const texto = typeof body?.comentario === "string" ? body.comentario.trim() : "";
    if (!texto) return NextResponse.json(errorResponse("comentario obligatorio"), { status: 400 });

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const insert = {
      empresa_id: auth.empresaId,
      proyecto_id: pid,
      usuario_id: auth.usuarioCatalogId,
      comentario: texto,
    };

    const { data, error } = await sb.from("proyecto_comentarios").insert(insert).select("*");
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    await sb
      .from("proyectos")
      .update({ last_activity_at: new Date().toISOString(), updated_by: auth.usuarioCatalogId })
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid);

    const catalog = createServiceRoleClient();
    const { data: u } = await catalog
      .from("usuarios")
      .select("nombre")
      .eq("id", auth.usuarioCatalogId)
      .maybeSingle();

    const row = Array.isArray(data) ? data[0] : data;
    return NextResponse.json(
      successResponse({
        ...row,
        usuario_nombre: (u as { nombre?: string } | null)?.nombre ?? null,
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
