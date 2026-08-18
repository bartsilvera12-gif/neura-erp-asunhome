import { NextResponse } from "next/server";
import type { UsuarioConEmpresaYRol } from "@/lib/middleware/auth";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { loadValidatedNotaCreditoSifenPayload } from "@/lib/sifen/load-nota-credito-sifen-payload";
import { buildOfficialRdeNotaCreditoElectronicaXml } from "@/lib/sifen/rde-nc-xml";
import type { BuildRdeXmlOptions } from "@/lib/sifen/rde-xml";
import type { AmbienteSifen } from "@/lib/sifen/types";
import {
  buildSifenNcXmlObjectPath,
  ensureSifenStorageBucket,
  removeSifenObject,
  SIFEN_STORAGE_BUCKET,
  uploadSifenXml,
} from "@/lib/sifen/sifen-storage";
import { assertNcSifenSinVentanaCancelacionDe } from "./assert-nc-sifen-cancelacion";
import { extractOrigenFiscalDesdeRdeXml } from "@/lib/sifen/parse-kude-from-signed-xml";
import {
  assertGtimbradoNcCoincideConPayloadOrThrow,
  assertItideNotaCredito,
  MSG_USUARIO_BLOQUEO_NC_TIMBRADO,
} from "@/lib/sifen/gtimb-nc-coherencia";
import { obtenerSifenPrevueloFacturaParaNcs } from "./pre-vuelo-nc-sifen";

/**
 * Igual criterio que FE: `error_envio` permite regenerar y reintentar envío.
 * `rechazado` permite regenerar XML (p. ej. timbrado corregido) antes de firmar de nuevo.
 */
const ESTADOS_BLOQUEADOS_XML = new Set<string>(["firmado", "enviado", "en_proceso", "aprobado", "cancelado"]);

export async function handleNcSifenXmlPost(opts: {
  auth: UsuarioConEmpresaYRol;
  supabase: AppSupabaseClient;
  notaCreditoId: string;
  debugXml: boolean;
  /** Ambiente embebido en el rDE (alinear con SET TEST en pipeline controlado). */
  xmlAmbienteOverride?: AmbienteSifen;
}): Promise<NextResponse> {
  const { auth, supabase, notaCreditoId, debugXml, xmlAmbienteOverride } = opts;
  const nid = notaCreditoId.trim();

  const { data: ncRow, error: errNc } = await supabase
    .from("nota_credito")
    .select("id, factura_id, estado_erp")
    .eq("id", nid)
    .eq("empresa_id", auth.empresa_id)
    .maybeSingle();

  if (errNc) {
    return NextResponse.json(errorResponse(errNc.message), { status: 400 });
  }
  if (!ncRow) {
    return NextResponse.json(errorResponse("Nota de crédito no encontrada."), { status: 404 });
  }
  const facturaId = String((ncRow as { factura_id: string }).factura_id);
  const estadoErp = String((ncRow as { estado_erp: string }).estado_erp);
  if (estadoErp === "anulada_borrador") {
    return NextResponse.json(errorResponse("La nota de crédito está anulada."), { status: 409 });
  }
  if (estadoErp !== "borrador" && estadoErp !== "pendiente_envio_sifen") {
    return NextResponse.json(
      errorResponse(`No se puede generar XML en estado ERP "${estadoErp}".`),
      { status: 409 }
    );
  }

  const gate = await assertNcSifenSinVentanaCancelacionDe(supabase, auth.empresa_id, facturaId);
  if (!gate.ok) {
    return NextResponse.json(errorResponse(gate.message), { status: gate.status });
  }

  const prev = await obtenerSifenPrevueloFacturaParaNcs(supabase, auth.empresa_id, facturaId);
  if (!prev.ok) {
    await supabase.from("nota_credito_evento").insert({
      empresa_id: auth.empresa_id,
      nota_credito_id: nid,
      actor_user_id: auth.user.id,
      tipo_evento: "validacion",
      detalle_json: {
        subtipo: "prevuelo_factura_origen_xml",
        resultado: "error",
        mensaje_tecnico: prev.mensaje,
        diagnostico: prev.diagnostico,
      },
    });
    return NextResponse.json(errorResponse(MSG_USUARIO_BLOQUEO_NC_TIMBRADO), { status: 400 });
  }

  const { data: neRow, error: errNe } = await supabase
    .from("nota_credito_electronica")
    .select("id, xml_path, xml_firmado_path, estado_sifen")
    .eq("nota_credito_id", nid)
    .eq("empresa_id", auth.empresa_id)
    .maybeSingle();

  if (errNe) {
    return NextResponse.json(errorResponse(errNe.message), { status: 400 });
  }
  if (!neRow) {
    return NextResponse.json(errorResponse("No hay registro electrónico para esta NC."), { status: 400 });
  }

  const estNe = String((neRow as { estado_sifen: string }).estado_sifen ?? "sin_envio");
  if (ESTADOS_BLOQUEADOS_XML.has(estNe)) {
    return NextResponse.json(
      errorResponse(`No se puede regenerar el XML: estado SIFEN "${estNe}".`),
      { status: 409 }
    );
  }

  const loaded = await loadValidatedNotaCreditoSifenPayload(supabase, auth.empresa_id, nid, {
    ambienteDeXml: xmlAmbienteOverride,
  });
  if (!loaded.ok) {
    return NextResponse.json(errorResponse(loaded.error.message), { status: loaded.error.status });
  }

  if (loaded.payload.sifen.nota_credito_electronica_id !== String((neRow as { id: string }).id)) {
    return NextResponse.json(errorResponse("Inconsistencia entre NC y nota_credito_electronica."), { status: 500 });
  }

  const fecha = loaded.payload.notaCredito.fecha_emision.trim();
  const yAnio = /^(\d{4})/.exec(fecha)?.[1] ?? String(new Date().getFullYear());
  const xmlOpts: BuildRdeXmlOptions = {
    timbradoFechaInicio: loaded.payload.emisor.timbrado_fecha_inicio_vigencia,
    timbradoFechaFin: `${yAnio}-12-31`,
    ambiente: loaded.ambiente,
    emisorTelefono: "021000000",
    emisorEmail: "facturacion@configurar-empresa.com.py",
    emisorDireccion: loaded.payload.emisor.direccion_fiscal.trim(),
    emisorNumCasa: 0,
    actividadEconomicaCodigo: loaded.payload.emisor.actividad_economica_codigo,
    actividadEconomicaDescripcion: loaded.payload.emisor.actividad_economica_descripcion,
  };

  let xmlString: string;
  try {
    xmlString = buildOfficialRdeNotaCreditoElectronicaXml(loaded.payload, xmlOpts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al generar XML SIFEN";
    await supabase.from("nota_credito_evento").insert({
      empresa_id: auth.empresa_id,
      nota_credito_id: nid,
      actor_user_id: auth.user.id,
      tipo_evento: "validacion",
      detalle_json: {
        subtipo: "xml_nc_builder",
        resultado: "error",
        error: msg,
        campo_rechazado_set_tipico:
          /iTipTra|tipo de transacci/i.test(msg) ? "iTipTra/dDesTipTra (no permitido en NC)" : null,
      },
    });
    return NextResponse.json(errorResponse(msg), { status: 400 });
  }

  try {
    const parsedNc = extractOrigenFiscalDesdeRdeXml(xmlString);
    assertItideNotaCredito(parsedNc);
    assertGtimbradoNcCoincideConPayloadOrThrow(parsedNc, loaded.payload.emisor);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al validar gTimb del XML generado";
    await supabase.from("nota_credito_evento").insert({
      empresa_id: auth.empresa_id,
      nota_credito_id: nid,
      actor_user_id: auth.user.id,
      tipo_evento: "validacion",
      detalle_json: {
        subtipo: "timbrado_xml_generado_vs_payload",
        resultado: "error",
        error: msg,
        timbrado_payload: loaded.payload.emisor.timbrado_numero,
        establecimiento_payload: loaded.payload.emisor.establecimiento,
        punto_payload: loaded.payload.emisor.punto_expedicion,
        ruc_payload: loaded.payload.emisor.ruc,
      },
    });
    return NextResponse.json(errorResponse(msg), { status: 400 });
  }

  const cdcMatch = /\bId="(\d{44})"/.exec(xmlString);
  const cdc = cdcMatch?.[1] ?? null;
  const objectPath = buildSifenNcXmlObjectPath(auth.empresa_id, nid);

  const bucketOk = await ensureSifenStorageBucket(supabase);
  if (!bucketOk.ok) {
    return NextResponse.json(errorResponse(`Storage SIFEN: ${bucketOk.message}`), { status: 500 });
  }

  const up = await uploadSifenXml(supabase, objectPath, xmlString);
  if (!up.ok) {
    return NextResponse.json(errorResponse(`No se pudo guardar el XML: ${up.message}`), { status: 500 });
  }

  const feSnap = neRow as { id: string; xml_path: string | null; xml_firmado_path: string | null; estado_sifen: string };
  const previousEstado = String(feSnap.estado_sifen ?? "sin_envio");
  const previousXmlPath = feSnap.xml_path == null ? null : String(feSnap.xml_path);
  const previousSignedPath =
    feSnap.xml_firmado_path == null ? null : String(feSnap.xml_firmado_path).trim() || null;

  const { data: updatedNe, error: errUpNe } = await supabase
    .from("nota_credito_electronica")
    .update({
      xml_path: objectPath,
      estado_sifen: "generado",
      xml_firmado_path: null,
      ...(cdc ? { cdc } : {}),
    })
    .eq("id", feSnap.id)
    .eq("empresa_id", auth.empresa_id)
    .select()
    .single();

  if (errUpNe || !updatedNe) {
    await removeSifenObject(supabase, objectPath);
    return NextResponse.json(
      errorResponse(errUpNe?.message ?? "No se pudo actualizar nota_credito_electronica."),
      { status: 500 }
    );
  }

  const { error: errEv } = await supabase.from("nota_credito_evento").insert({
    empresa_id: auth.empresa_id,
    nota_credito_id: nid,
    actor_user_id: auth.user.id,
    tipo_evento: "xml_generado",
    detalle_json: {
      xml_path: objectPath,
      cdc,
      factura_id: facturaId,
      nota_credito_electronica_id: feSnap.id,
      verificacion_timbrado: {
        subtipo: "xml_generado_vs_payload",
        resultado: "ok",
        timbrado_payload: loaded.payload.emisor.timbrado_numero,
        establecimiento_payload: loaded.payload.emisor.establecimiento,
        punto_payload: loaded.payload.emisor.punto_expedicion,
        ruc_payload: loaded.payload.emisor.ruc,
      },
    },
  });

  if (errEv) {
    await supabase
      .from("nota_credito_electronica")
      .update({
        xml_path: previousXmlPath,
        estado_sifen: previousEstado,
        xml_firmado_path: previousSignedPath,
      })
      .eq("id", feSnap.id)
      .eq("empresa_id", auth.empresa_id);
    await removeSifenObject(supabase, objectPath);
    return NextResponse.json(
      errorResponse(`No se pudo registrar auditoría; se revirtió: ${errEv.message}`),
      { status: 500 }
    );
  }

  if (previousSignedPath) {
    await removeSifenObject(supabase, previousSignedPath);
  }

  await supabase
    .from("nota_credito")
    .update({ estado_erp: "pendiente_envio_sifen" })
    .eq("id", nid)
    .eq("empresa_id", auth.empresa_id)
    .eq("estado_erp", "borrador");

  const data: Record<string, unknown> = {
    nota_credito_electronica: updatedNe,
    xml_path: objectPath,
    storage_bucket: SIFEN_STORAGE_BUCKET,
  };
  if (debugXml) {
    data.xml = xmlString;
  }

  return NextResponse.json(successResponse(data));
}
