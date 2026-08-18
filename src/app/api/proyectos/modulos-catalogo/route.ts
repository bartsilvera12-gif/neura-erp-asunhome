import { NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";

export async function GET(request: Request) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const catalog = createServiceRoleClient();
    const { data, error } = await catalog
      .from("modulos")
      .select("id, nombre, slug")
      .order("nombre", { ascending: true });

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    return NextResponse.json(
      successResponse(
        (data ?? []).map((modulo) => ({
          id: String(modulo.id),
          nombre: String(modulo.nombre ?? ""),
          slug: String(modulo.slug ?? ""),
        }))
      )
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
