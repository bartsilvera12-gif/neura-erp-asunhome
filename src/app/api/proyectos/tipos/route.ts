import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";

const DEFAULT_PROYECTO_TIPOS = [
  { nombre: "Proyecto Web", codigo: "web", descripcion: "Sitios y landings vendidos por comercial" },
  { nombre: "SaaS / ERP", codigo: "saas", descripcion: "Implementaciones SaaS y ERP para clientes" },
] as const;

export async function GET(request: Request) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    // Antes: un upsert por tipo en serie. Ahora upsert batch en una sola query
    // (upsert acepta array). 2 round-trips => 1.
    const { error: seedError } = await sb.from("proyecto_tipos").upsert(
      DEFAULT_PROYECTO_TIPOS.map((tipo) => ({
        empresa_id: auth.empresaId,
        nombre: tipo.nombre,
        codigo: tipo.codigo,
        descripcion: tipo.descripcion,
        activo: true,
      })),
      { onConflict: "empresa_id,codigo", ignoreDuplicates: true }
    );
    if (seedError) {
      return NextResponse.json(errorResponse(seedError.message), { status: 400 });
    }

    const { data, error } = await sb
      .from("proyecto_tipos")
      .select("id, nombre, codigo, descripcion, config, activo")
      .eq("empresa_id", auth.empresaId)
      .eq("activo", true)
      .order("nombre", { ascending: true });

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }
    return NextResponse.json(successResponse(data ?? []));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
