import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { loadValidatedSifenPayload } from "@/lib/sifen/load-factura-payload";
import { buildOfficialRdeFacturaElectronicaXml } from "@/lib/sifen/rde-xml";
import {
  buildSifenXmlObjectPath,
  ensureSifenStorageBucket,
  removeSifenObject,
  SIFEN_STORAGE_BUCKET,
  uploadSifenXml,
} from "@/lib/sifen/sifen-storage";
import type {
  FacturaElectronicaDTO,
  SifenApiXmlGeneracionDetalle,
  SifenXmlGeneracionResponseData,
} from "@/lib/sifen/types";


/**
 * Solo `aprobado` bloquea regeneración. `enviado` permite corregir y volver a firmar si el lote falla
 * (p. ej. 1858) sin depender de que la consulta-lote haya actualizado ya el estado en BD.
 */
const ESTADOS_BLOQUEADOS_XML = new Set<string>(["aprobado", "cancelado"]);

/**
 * POST /api/facturas/[id]/sifen/xml
 * Genera XML rDE oficial (SIFEN v150, factura electrónica), lo sube a Storage y actualiza factura_electronica (sin firma ni SET).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getFacturasSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const { id: facturaId } = await params;
    if (!facturaId?.trim()) {
      return NextResponse.json(errorResponse("id de factura es obligatorio"), { status: 400 });
    }

    const debugXml = request.nextUrl.searchParams.get("debug") === "1";

    const fid = facturaId.trim();

    const { data: feSnapshot, error: errSnap } = await supabase
      .from("factura_electronica")
      .select(
        "id, xml_path, xml_firmado_path, estado_sifen, sifen_regeneracion_seq, error, cdc, sifen_d_prot_cons_lote, sifen_ultima_respuesta_consulta_lote, sifen_ultima_respuesta_recibe_lote"
      )
      .eq("factura_id", fid)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errSnap) {
      return NextResponse.json(errorResponse(errSnap.message), { status: 400 });
    }
    if (!feSnapshot) {
      return NextResponse.json(
        errorResponse(
          "No existe registro electrónico para esta factura. Cree primero el borrador con POST /api/facturas/{id}/sifen/borrador."
        ),
        { status: 400 }
      );
    }

    if (ESTADOS_BLOQUEADOS_XML.has(String(feSnapshot.estado_sifen))) {
      return NextResponse.json(
        errorResponse(
          `No se puede regenerar el XML: el documento está en estado "${feSnapshot.estado_sifen}".`
        ),
        { status: 409 }
      );
    }

    const previousEstado = String(feSnapshot.estado_sifen ?? "borrador");
    const rawPrev = feSnapshot.sifen_regeneracion_seq;
    const previousRegSeq = Number.isFinite(Number(rawPrev)) ? Math.max(0, Math.floor(Number(rawPrev))) : 0;
    let bumpRechazoAplicado = false;

    if (previousEstado === "rechazado") {
      const nextSeq = previousRegSeq + 1;
      const { data: bumped, error: bumpErr } = await supabase
        .from("factura_electronica")
        .update({ sifen_regeneracion_seq: nextSeq })
        .eq("id", feSnapshot.id)
        .eq("empresa_id", auth.empresa_id)
        .eq("estado_sifen", "rechazado")
        .eq("sifen_regeneracion_seq", previousRegSeq)
        .select("sifen_regeneracion_seq")
        .maybeSingle();

      if (bumpErr) {
        return NextResponse.json(errorResponse(bumpErr.message), { status: 500 });
      }
      if (!bumped) {
        return NextResponse.json(
          errorResponse(
            "No se pudo reservar una nueva revisión del documento (el estado pudo cambiar). Actualizá la página e intentá de nuevo."
          ),
          { status: 409 }
        );
      }
      bumpRechazoAplicado = true;
    }

    const revertBumpRegSeq = async () => {
      if (!bumpRechazoAplicado) return;
      bumpRechazoAplicado = false;
      await supabase
        .from("factura_electronica")
        .update({ sifen_regeneracion_seq: previousRegSeq })
        .eq("id", feSnapshot.id)
        .eq("empresa_id", auth.empresa_id);
    };

    const loaded = await loadValidatedSifenPayload(supabase, auth.empresa_id, fid);
    if (!loaded.ok) {
      await revertBumpRegSeq();
      return NextResponse.json(errorResponse(loaded.error.message), {
        status: loaded.error.status,
      });
    }

    if (loaded.payload.sifen.factura_electronica_id !== feSnapshot.id) {
      await revertBumpRegSeq();
      return NextResponse.json(errorResponse("Inconsistencia entre factura electrónica y payload."), {
        status: 500,
      });
    }

    const fecha = loaded.payload.documento.fecha.trim();
    const yAnio = /^(\d{4})/.exec(fecha)?.[1] ?? String(new Date().getFullYear());
    let xmlString: string;
    try {
      xmlString = buildOfficialRdeFacturaElectronicaXml(loaded.payload, {
        timbradoFechaInicio: loaded.payload.emisor.timbrado_fecha_inicio_vigencia,
        timbradoFechaFin: `${yAnio}-12-31`,
        ambiente: loaded.ambiente,
        emisorTelefono: "021000000",
        emisorEmail: "facturacion@configurar-empresa.com.py",
        emisorDireccion: loaded.payload.emisor.direccion_fiscal.trim(),
        emisorNumCasa: 0,
        actividadEconomicaCodigo: loaded.payload.emisor.actividad_economica_codigo,
        actividadEconomicaDescripcion: loaded.payload.emisor.actividad_economica_descripcion,
      });
    } catch (e) {
      await revertBumpRegSeq();
      const msg = e instanceof Error ? e.message : "Error al generar XML SIFEN";
      return NextResponse.json(errorResponse(msg), { status: 400 });
    }

    const cdcMatch = /\bId="(\d{44})"/.exec(xmlString);
    const cdc = cdcMatch?.[1] ?? null;
    const objectPath = buildSifenXmlObjectPath(auth.empresa_id, fid);

    const bucketOk = await ensureSifenStorageBucket(supabase);
    if (!bucketOk.ok) {
      await revertBumpRegSeq();
      return NextResponse.json(errorResponse(`Storage SIFEN: ${bucketOk.message}`), { status: 500 });
    }

    const up = await uploadSifenXml(supabase, objectPath, xmlString);
    if (!up.ok) {
      await revertBumpRegSeq();
      return NextResponse.json(
        errorResponse(`No se pudo guardar el XML en storage: ${up.message}`),
        { status: 500 }
      );
    }

    const previousXmlPath =
      feSnapshot.xml_path === null || feSnapshot.xml_path === undefined
        ? null
        : String(feSnapshot.xml_path);
    const previousSignedPath =
      feSnapshot.xml_firmado_path === null || feSnapshot.xml_firmado_path === undefined
        ? null
        : String(feSnapshot.xml_firmado_path).trim() || null;

    const { data: updatedRow, error: errUpdate } = await supabase
      .from("factura_electronica")
      .update({
        xml_path: objectPath,
        estado_sifen: "generado",
        xml_firmado_path: null,
        ...(cdc ? { cdc } : {}),
        ...(previousEstado === "rechazado"
          ? {
              error: null,
              sifen_d_prot_cons_lote: null,
              sifen_ultima_respuesta_consulta_lote: null,
              sifen_ultima_respuesta_recibe_lote: null,
            }
          : {}),
      })
      .eq("id", feSnapshot.id)
      .eq("empresa_id", auth.empresa_id)
      .select()
      .single();

    if (errUpdate || !updatedRow) {
      await removeSifenObject(supabase, objectPath);
      await revertBumpRegSeq();
      return NextResponse.json(
        errorResponse(
          errUpdate?.message ??
            "No se pudo actualizar factura_electronica; el archivo subido fue eliminado."
        ),
        { status: 500 }
      );
    }

    bumpRechazoAplicado = false;

    const detalle: SifenApiXmlGeneracionDetalle = {
      origen: "api_xml",
      factura_id: fid,
      xml_path: objectPath,
      ...(previousEstado === "rechazado" ? { sifen_regeneracion_seq: previousRegSeq + 1 } : {}),
    };

    const { error: errEvento } = await supabase.from("factura_electronica_evento").insert({
      empresa_id: auth.empresa_id,
      factura_electronica_id: feSnapshot.id,
      tipo: "generacion",
      detalle,
    });

    if (errEvento) {
      await supabase
        .from("factura_electronica")
        .update({
          xml_path: previousXmlPath,
          estado_sifen: previousEstado,
          xml_firmado_path: previousSignedPath,
          ...(previousEstado === "rechazado"
            ? {
                sifen_regeneracion_seq: previousRegSeq,
                error: feSnapshot.error ?? null,
                cdc: feSnapshot.cdc ?? null,
                sifen_d_prot_cons_lote: feSnapshot.sifen_d_prot_cons_lote ?? null,
                sifen_ultima_respuesta_consulta_lote: feSnapshot.sifen_ultima_respuesta_consulta_lote ?? null,
                sifen_ultima_respuesta_recibe_lote: feSnapshot.sifen_ultima_respuesta_recibe_lote ?? null,
              }
            : {}),
        })
        .eq("id", feSnapshot.id)
        .eq("empresa_id", auth.empresa_id);
      await removeSifenObject(supabase, objectPath);
      return NextResponse.json(
        errorResponse(`No se pudo registrar el evento; se revirtió el estado y el archivo: ${errEvento.message}`),
        { status: 500 }
      );
    }

    if (previousSignedPath) {
      await removeSifenObject(supabase, previousSignedPath);
    }

    const data: SifenXmlGeneracionResponseData = {
      factura_electronica: updatedRow as FacturaElectronicaDTO,
      xml_path: objectPath,
      storage_bucket: SIFEN_STORAGE_BUCKET,
    };
    if (debugXml) {
      data.xml = xmlString;
    }

    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
