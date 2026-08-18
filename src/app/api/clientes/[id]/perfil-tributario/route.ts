import { NextRequest, NextResponse } from "next/server";
import { errorResponse, successResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import {
  fetchObligacionesCatalogo,
  fetchPerfilTributarioDetalle,
} from "@/lib/clientes/tributario-server";
import { getGestionTributariaClientes } from "@/lib/empresa/gestion-tributaria-catalog";
import { encryptSecret } from "@/lib/sifen/security";

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseNum(body: Record<string, unknown>, key: string): number | null {
  if (!(key in body)) return null;
  const v = body[key];
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * Día 1-31 o `null` (sin obligación fija). Compat: `fecha_vencimiento_tributario` (YYYY-MM-DD) obsoleto → se toma el día.
 */
function parseDiaVencimientoTributario(
  body: Record<string, unknown>
): { ok: true; value: number | null } | { ok: false; error: string } {
  if ("dia_vencimiento_tributario" in body) {
    const v = body.dia_vencimiento_tributario;
    if (v === null || v === "" || v === undefined) {
      return { ok: true, value: null };
    }
    const n = typeof v === "number" ? v : parseInt(String(v).trim(), 10);
    if (!Number.isFinite(n)) {
      return { ok: false, error: "dia_vencimiento_tributario debe ser un entero entre 1 y 31, o vacío" };
    }
    const t = Math.trunc(n);
    if (t < 1 || t > 31) {
      return { ok: false, error: "dia_vencimiento_tributario debe estar entre 1 y 31" };
    }
    return { ok: true, value: t };
  }
  const legacy = body.fecha_vencimiento_tributario;
  if (legacy === null || legacy === "" || legacy === undefined) {
    return { ok: true, value: null };
  }
  if (typeof legacy === "string" && /^\d{4}-\d{2}-\d{2}$/.test(legacy.trim())) {
    const d = parseInt(legacy.trim().slice(8, 10), 10);
    if (d >= 1 && d <= 31) return { ok: true, value: d };
  }
  return {
    ok: false,
    error:
      "Use dia_vencimiento_tributario (1-31). fecha_vencimiento_tributario (YYYY-MM-DD) es obsoleto.",
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;
    const { id: clienteId } = await params;
    if (!clienteId) return NextResponse.json(errorResponse("id es obligatorio"), { status: 400 });

    const gestionOn = await getGestionTributariaClientes(auth.empresa_id);

    const { data: cliente, error: ec } = await supabase
      .from("clientes")
      .select("id")
      .eq("id", clienteId)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (ec || !cliente) {
      return NextResponse.json(errorResponse("Cliente no encontrado"), { status: 404 });
    }

    const perfil = await fetchPerfilTributarioDetalle(supabase, auth.empresa_id, clienteId);

    let catalogo: Awaited<ReturnType<typeof fetchObligacionesCatalogo>> | null = null;
    if (gestionOn) {
      catalogo = await fetchObligacionesCatalogo(supabase);
    }

    return NextResponse.json(successResponse({ gestion_tributaria_clientes: gestionOn, perfil, catalogo }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const gestionOn = await getGestionTributariaClientes(auth.empresa_id);
    if (!gestionOn) {
      return NextResponse.json(errorResponse("La empresa no tiene activa la gestión tributaria de clientes"), {
        status: 403,
      });
    }

    const { id: clienteId } = await params;
    if (!clienteId) return NextResponse.json(errorResponse("id es obligatorio"), { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const { data: cliente, error: ec } = await supabase
      .from("clientes")
      .select("id")
      .eq("id", clienteId)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (ec || !cliente) {
      return NextResponse.json(errorResponse("Cliente no encontrado"), { status: 404 });
    }

    const perfilActivo = Boolean(body.perfil_activo);

    const dv = typeof body.dv === "string" ? body.dv.trim() || null : null;
    const razonSocial =
      typeof body.razon_social_fiscal === "string" ? body.razon_social_fiscal.trim() || null : null;
    const notas = typeof body.notas_tributarias === "string" ? body.notas_tributarias.trim() || null : null;
    const otroDetalle =
      typeof body.obligacion_otro_detalle === "string" ? body.obligacion_otro_detalle.trim() || null : null;

    const parsedDia = parseDiaVencimientoTributario(body);
    if (!parsedDia.ok) {
      return NextResponse.json(errorResponse(parsedDia.error), { status: 400 });
    }
    const diaVencimientoTribut = parsedDia.value;

    const honorMensual = parseNum(body, "honorario_mensual");
    const honorAnual = parseNum(body, "honorario_anual");

    const idsRaw = body.obligacion_catalogo_ids;
    let obligacionIds: string[] = [];
    if (Array.isArray(idsRaw)) {
      obligacionIds = idsRaw.filter((x): x is string => typeof x === "string" && uuidRe.test(x));
    }

    let claveEncrypted: string | null | undefined;
    if ("clave_tributaria" in body) {
      const c = body.clave_tributaria;
      if (c === null || c === "") {
        claveEncrypted = null;
      } else if (typeof c === "string" && c.trim()) {
        try {
          claveEncrypted = encryptSecret(c.trim());
        } catch {
          return NextResponse.json(
            errorResponse(
              "No se pudo cifrar la clave tributaria (configure SIFEN_SECRETS_KEY en el servidor)."
            ),
            { status: 500 }
          );
        }
      }
    }

    const catalog = await fetchObligacionesCatalogo(supabase);
    const catById = new Map(catalog.map((c) => [c.id, c]));

    if (perfilActivo) {
      for (const oid of obligacionIds) {
        if (!catById.has(oid)) {
          return NextResponse.json(errorResponse("Obligación inválida o desconocida"), { status: 400 });
        }
      }
      const tieneOtro = obligacionIds.some((oid) => catById.get(oid)?.slug === "otro");
      if (tieneOtro && !(otroDetalle && otroDetalle.length > 0)) {
        return NextResponse.json(
          errorResponse('Indique el detalle cuando selecciona la obligación "Otro".'),
          { status: 400 }
        );
      }
    }

    const upsertPayload: Record<string, unknown> = {
      empresa_id: auth.empresa_id,
      cliente_id: clienteId,
      perfil_activo: perfilActivo,
      dv,
      razon_social_fiscal: razonSocial,
      dia_vencimiento_tributario: diaVencimientoTribut,
      honorario_mensual: honorMensual,
      honorario_anual: honorAnual,
      notas_tributarias: notas,
      obligacion_otro_detalle: perfilActivo ? otroDetalle : null,
    };

    if (claveEncrypted !== undefined) {
      upsertPayload.clave_tributaria_encrypted = claveEncrypted;
    }

    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(upsertPayload)) {
      if (v !== undefined) row[k] = v;
    }

    const { data: upserted, error: eu } = await supabase
      .from("cliente_perfil_tributario")
      .upsert(row, { onConflict: "empresa_id,cliente_id" })
      .select("id")
      .single();

    if (eu) {
      return NextResponse.json(errorResponse(eu.message), { status: 400 });
    }

    const perfilRowId = (upserted as { id?: string } | null)?.id;
    if (!perfilRowId) {
      return NextResponse.json(errorResponse("No se pudo guardar el perfil tributario"), { status: 500 });
    }

    await supabase.from("cliente_obligaciones_tributarias").delete().eq("cliente_perfil_id", perfilRowId);

    if (perfilActivo && obligacionIds.length > 0) {
      const rows = obligacionIds.map((obligacion_catalogo_id) => ({
        empresa_id: auth.empresa_id,
        cliente_perfil_id: perfilRowId,
        obligacion_catalogo_id,
      }));
      const { error: ei } = await supabase.from("cliente_obligaciones_tributarias").insert(rows);
      if (ei) {
        return NextResponse.json(errorResponse(ei.message), { status: 400 });
      }
    }

    const perfil = await fetchPerfilTributarioDetalle(supabase, auth.empresa_id, clienteId);

    return NextResponse.json(successResponse({ perfil }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
