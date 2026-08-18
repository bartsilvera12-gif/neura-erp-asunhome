import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

interface NotaRow {
  id: string;
  empresa_id: string;
  prospecto_id: string;
  texto: string;
  fecha: string;
}

/**
 * POST /api/crm/prospectos/:id/notas
 * Crea una nota (timeline) en el tenant.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { id: prospectoId } = await params;
    const empresaId = ctx.auth.empresa_id;
    const body = (await request.json().catch(() => ({}))) as { texto?: string };
    const texto = typeof body.texto === "string" ? body.texto.trim() : "";
    if (!texto) {
      return NextResponse.json(errorResponse("texto es obligatorio"), { status: 400 });
    }

    const { data: pros, error: errP } = await ctx.supabase
      .from("crm_prospectos")
      .select("id")
      .eq("id", prospectoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (errP) {
      return NextResponse.json(errorResponse(errP.message), { status: 400 });
    }
    if (!pros) {
      return NextResponse.json(errorResponse("Prospecto no encontrado"), { status: 404 });
    }

    const { data, error } = await ctx.supabase
      .from("crm_notas")
      .insert([
        {
          empresa_id: empresaId,
          prospecto_id: prospectoId,
          texto,
        },
      ])
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    const row = data as NotaRow;
    return NextResponse.json(
      successResponse({
        id: row.id,
        texto: row.texto,
        fecha: row.fecha,
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    console.error("[api/crm/prospectos/[id]/notas] POST:", err);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
