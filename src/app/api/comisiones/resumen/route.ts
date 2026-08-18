import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireComisionesModuleAccess } from "@/lib/comisiones/comisiones-auth";

const TZ_DEFAULT = "America/Asuncion";

/** Vista inicial del módulo: período etiquetado + política activa (sin liquidaciones). */
export async function GET(request: Request) {
  const auth = await requireComisionesModuleAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const { data: politica } = await sb
      .from("comision_politicas")
      .select("*")
      .eq("empresa_id", auth.empresaId)
      .maybeSingle();

    const tz =
      politica &&
      typeof (politica as { timezone?: string }).timezone === "string" &&
      (politica as { timezone: string }).timezone.trim()
        ? (politica as { timezone: string }).timezone.trim()
        : TZ_DEFAULT;

    let periodoEtiqueta: string;
    try {
      periodoEtiqueta = new Intl.DateTimeFormat("es-PY", {
        month: "long",
        year: "numeric",
        timeZone: tz,
      }).format(new Date());
    } catch {
      periodoEtiqueta = new Intl.DateTimeFormat("es-PY", {
        month: "long",
        year: "numeric",
        timeZone: TZ_DEFAULT,
      }).format(new Date());
    }

    const politicaActiva =
      politica && (politica as { activo?: boolean }).activo === true ? politica : null;

    let periodoDb: Record<string, unknown> | null = null;
    if (politicaActiva && typeof (politicaActiva as { id: string }).id === "string") {
      const pid = (politicaActiva as { id: string }).id;
      const nowIso = new Date().toISOString();
      const { data: per } = await sb
        .from("comision_periodos")
        .select("*")
        .eq("empresa_id", auth.empresaId)
        .eq("politica_id", pid)
        .lte("fecha_inicio", nowIso)
        .gte("fecha_fin", nowIso)
        .maybeSingle();
      if (per) periodoDb = per as Record<string, unknown>;
    }

    return NextResponse.json(
      successResponse({
        periodo_actual_etiqueta: periodoEtiqueta,
        timezone_usado: tz,
        politica_activa: politicaActiva,
        periodo_calendario: periodoDb,
        mensaje_calculo:
          "El cálculo productivo de liquidaciones se habilitará en el siguiente paso del módulo.",
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
