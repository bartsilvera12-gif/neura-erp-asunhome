import { NextRequest, NextResponse } from "next/server";
import type { UsuarioConEmpresa } from "@/lib/middleware/auth";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { decryptSecret } from "@/lib/sifen/security";
import {
  consultarLoteSifen,
  inferirEstadoSifenTrasConsultaLote,
  type ConsultaLoteRespuestaParsed,
} from "@/lib/sifen/consulta-lote-sifen-test";
import { downloadSifenCertificadoObject } from "@/lib/sifen/sifen-certificados-storage";
import { toFacturaElectronicaDto } from "@/lib/sifen/to-factura-electronica-dto";
import { isExplicitSifenTestOverrideEnabled } from "@/lib/env/allow-test-mode";
import type {
  AmbienteSifen,
  SifenApiConsultaLoteTestDetalle,
  SifenConsultaLoteDetallePersistido,
  SifenConsultaLoteTestResponseData,
  SifenConsultaLoteUltimaPersistida,
} from "@/lib/sifen/types";

function parseAmbiente(raw: string): AmbienteSifen | null {
  if (raw === "test" || raw === "produccion") return raw;
  return null;
}

function toDetallePersistido(parsed: ConsultaLoteRespuestaParsed): SifenConsultaLoteDetallePersistido[] {
  return parsed.detalle_por_cdc.map((d) => ({
    cdc: d.cdc,
    dEstRes: d.dEstRes,
    dProtAut: d.dProtAut,
    grupoRes: d.grupo_res.map((g) => ({ dCodRes: g.dCodRes, dMsgRes: g.dMsgRes })),
  }));
}

function buildUltimaConsultaPersistida(
  dProtConsLote: string,
  parsed: ConsultaLoteRespuestaParsed
): SifenConsultaLoteUltimaPersistida {
  return {
    consultadoEn: new Date().toISOString(),
    dProtConsLote,
    dFecProc: parsed.dFecProc,
    dCodResLot: parsed.dCodResLot,
    dMsgResLot: parsed.dMsgResLot,
    httpStatus: parsed.httpStatus,
    soapFault: parsed.soapFault,
    faultString: parsed.faultString,
    loteSinDetalleCdc: !parsed.soapFault && parsed.detalle_por_cdc.length === 0,
    detallePorCdc: toDetallePersistido(parsed),
  };
}

function buildResumenInferido(
  parsed: ConsultaLoteRespuestaParsed,
  infer: {
    nuevoEstado: "aprobado" | "rechazado" | null;
    filaRelevante: { dEstRes: string; grupo_res: { dMsgRes: string }[] } | null;
  },
  _estadoFinal: string,
  estadoAnterior: string
): string | null {
  if (parsed.soapFault) return parsed.faultString;
  if (infer.nuevoEstado === "aprobado") return "Documento aprobado según consulta-lote (dEstRes).";
  if (infer.nuevoEstado === "rechazado") {
    return infer.filaRelevante?.grupo_res[0]?.dMsgRes ?? infer.filaRelevante?.dEstRes ?? "Documento rechazado según consulta-lote.";
  }
  if (!parsed.soapFault && parsed.detalle_por_cdc.length === 0 && _estadoFinal === "enviado") {
    return "Lote en procesamiento: aún no hay detalle por CDC; el estado permanece enviado.";
  }
  if (parsed.detalle_por_cdc.length > 0 && infer.nuevoEstado == null && estadoAnterior === "enviado") {
    return "Hay detalle por CDC; revise dEstRes y códigos en gResProc (no se cambió estado automáticamente).";
  }
  return null;
}

export type HandleSifenConsultaLotePostOptions = {
  soloAmbienteTest: boolean;
};

/**
 * POST consulta-lote contra SIFEN (test | producción) usando el `dProtConsLote`
 * persistido tras recibe-lote. El cliente Supabase se recibe por parámetro para
 * que la ruta decida si va por PostgREST (legacy `zentra_erp`) o por PG shim
 * (tenants `erp_*` no expuestos).
 */
export async function handleSifenConsultaLotePost(
  request: NextRequest,
  params: Promise<{ id: string }>,
  auth: UsuarioConEmpresa,
  supabase: AppSupabaseClient,
  options: HandleSifenConsultaLotePostOptions
): Promise<NextResponse> {
  const debugSoap = request.nextUrl.searchParams.get("debug") === "1";
  const { id: facturaId } = await params;
  if (!facturaId?.trim()) {
    return NextResponse.json(errorResponse("id de factura es obligatorio"), { status: 400 });
  }
  const fid = facturaId.trim();

  const { data: feRow, error: errFe } = await supabase
    .from("factura_electronica")
    .select(
      "id, factura_id, estado_sifen, cdc, error, sifen_d_prot_cons_lote, sifen_ultima_respuesta_consulta_lote, sifen_aprobado_at"
    )
    .eq("factura_id", fid)
    .eq("empresa_id", auth.empresa_id)
    .maybeSingle();

  if (errFe) {
    return NextResponse.json(errorResponse(errFe.message), { status: 400 });
  }
  if (!feRow) {
    return NextResponse.json(errorResponse("No existe registro electrónico para esta factura."), {
      status: 400,
    });
  }

  const protRaw = feRow.sifen_d_prot_cons_lote == null ? "" : String(feRow.sifen_d_prot_cons_lote).trim();
  if (!protRaw || !/^[0-9]+$/.test(protRaw)) {
    const enviarPath = options.soloAmbienteTest ? ".../sifen/enviar-test" : ".../sifen/enviar";
    return NextResponse.json(
      errorResponse(
        `No hay protocolo de lote (sifen_d_prot_cons_lote). Envíe primero el lote con POST ${enviarPath}.`
      ),
      { status: 409 }
    );
  }

  const { data: cfg, error: errCfg } = await supabase
    .from("empresa_sifen_config")
    .select("ambiente, activo, certificado_path, certificado_password_encrypted")
    .eq("empresa_id", auth.empresa_id)
    .maybeSingle();

  if (errCfg) {
    return NextResponse.json(errorResponse(errCfg.message), { status: 400 });
  }
  if (!cfg) {
    return NextResponse.json(errorResponse("No hay configuración SIFEN para esta empresa."), {
      status: 400,
    });
  }

  const ambiente = parseAmbiente(String(cfg.ambiente ?? ""));
  if (!ambiente) {
    return NextResponse.json(errorResponse('Ambiente SIFEN inválido en configuración (use "test" o "produccion").'), {
      status: 400,
    });
  }

  if (options.soloAmbienteTest && ambiente !== "test" && !isExplicitSifenTestOverrideEnabled()) {
    return NextResponse.json(
      errorResponse(
        'Este endpoint solo opera con configuración SIFEN en ambiente "test", o bien con ALLOW_TEST_MODE=true en el servidor (consulta SET TEST). Use POST .../sifen/consulta-lote para producción real.'
      ),
      { status: 400 }
    );
  }

  const ambienteSoap: AmbienteSifen = options.soloAmbienteTest ? "test" : ambiente;

  if (!cfg.activo) {
    return NextResponse.json(errorResponse("La configuración SIFEN está inactiva."), { status: 400 });
  }

  const certPath = cfg.certificado_path == null ? "" : String(cfg.certificado_path).trim();
  if (!certPath) {
    return NextResponse.json(
      errorResponse("No hay certificado en storage. Suba el .p12 en configuración SIFEN."),
      { status: 400 }
    );
  }

  const encPwd = cfg.certificado_password_encrypted;
  if (encPwd == null || String(encPwd).trim() === "") {
    return NextResponse.json(
      errorResponse("Falta la contraseña del certificado cifrada en configuración SIFEN."),
      { status: 400 }
    );
  }

  let p12Password: string;
  try {
    p12Password = decryptSecret(String(encPwd));
  } catch (e) {
    const m = e instanceof Error ? e.message : "Error al descifrar la contraseña del certificado";
    return NextResponse.json(errorResponse(m), { status: 500 });
  }

  const p12Dl = await downloadSifenCertificadoObject(supabase, certPath);
  if (!p12Dl.ok) {
    return NextResponse.json(
      errorResponse(`No se pudo descargar el certificado .p12: ${p12Dl.message}`),
      { status: 500 }
    );
  }

  const previousEstado = String(feRow.estado_sifen ?? "borrador");
  const previousError = feRow.error == null ? null : String(feRow.error);
  const previousConsulta = feRow.sifen_ultima_respuesta_consulta_lote;
  const previousAprobadoAt =
    (feRow as { sifen_aprobado_at?: string | null }).sifen_aprobado_at == null
      ? null
      : String((feRow as { sifen_aprobado_at?: string | null }).sifen_aprobado_at);

  let resp: ConsultaLoteRespuestaParsed;
  try {
    resp = await consultarLoteSifen({
      dProtConsLote: protRaw,
      empresaConfig: {
        ambiente: ambienteSoap,
        certificadoP12: p12Dl.data,
        certificadoPassword: p12Password,
      },
      facturaElectronicaId: String(feRow.id),
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const label = ambienteSoap === "produccion" ? "SIFEN producción" : "SIFEN TEST";
    return NextResponse.json(errorResponse(`Fallo al llamar a ${label} (consulta-lote): ${m}`), {
      status: 502,
    });
  }

  const ultimaJson = buildUltimaConsultaPersistida(protRaw, resp);
  const cdcFactura = feRow.cdc == null ? null : String(feRow.cdc).trim() || null;
  const infer = inferirEstadoSifenTrasConsultaLote(previousEstado, cdcFactura, resp);

  let estadoFinal = previousEstado;
  if (infer.nuevoEstado != null) {
    estadoFinal = infer.nuevoEstado;
  }

  let nuevoError: string | null = previousError;
  if (infer.nuevoEstado === "aprobado") {
    nuevoError = null;
  } else if (infer.nuevoEstado === "rechazado") {
    const gr = infer.filaRelevante?.grupo_res[0];
    nuevoError = gr?.dMsgRes ?? infer.filaRelevante?.dEstRes ?? "Documento rechazado por SET.";
  }

  const marcaAprobacion =
    infer.nuevoEstado === "aprobado" && previousEstado !== "aprobado"
      ? new Date().toISOString()
      : undefined;

  const updatePayload: Record<string, unknown> = {
    estado_sifen: estadoFinal,
    error: nuevoError,
    sifen_ultima_respuesta_consulta_lote: ultimaJson,
  };
  if (marcaAprobacion != null) {
    updatePayload.sifen_aprobado_at = marcaAprobacion;
  }

  const { data: updatedRow, error: errUpdate } = await supabase
    .from("factura_electronica")
    .update(updatePayload)
    .eq("id", feRow.id)
    .eq("empresa_id", auth.empresa_id)
    .select()
    .single();

  if (errUpdate || !updatedRow) {
    return NextResponse.json(
      errorResponse(errUpdate?.message ?? "No se pudo actualizar factura_electronica."),
      { status: 500 }
    );
  }

  const detalle: SifenApiConsultaLoteTestDetalle = {
    origen: options.soloAmbienteTest ? "api_consulta_lote_test" : "api_consulta_lote",
    factura_id: fid,
    dProtConsLote: protRaw,
    dCodResLot: resp.dCodResLot,
    dMsgResLot: resp.dMsgResLot,
    httpStatus: resp.httpStatus,
    soapFault: resp.soapFault,
    estado_sifen_anterior: previousEstado,
    estado_sifen_nuevo: estadoFinal,
  };

  const { error: errEvento } = await supabase.from("factura_electronica_evento").insert({
    empresa_id: auth.empresa_id,
    factura_electronica_id: feRow.id,
    tipo: "respuesta",
    detalle,
  });

  if (errEvento) {
    const revert: Record<string, unknown> = {
      estado_sifen: previousEstado,
      error: previousError,
      sifen_ultima_respuesta_consulta_lote: previousConsulta,
    };
    if (marcaAprobacion != null) {
      revert.sifen_aprobado_at = previousAprobadoAt;
    }
    await supabase.from("factura_electronica").update(revert).eq("id", feRow.id).eq("empresa_id", auth.empresa_id);
    return NextResponse.json(
      errorResponse(`No se pudo registrar el evento; se revirtió el estado: ${errEvento.message}`),
      { status: 500 }
    );
  }

  const dto = toFacturaElectronicaDto(updatedRow as Record<string, unknown>);
  const loteEnProcesamiento =
    !resp.soapFault && resp.detalle_por_cdc.length === 0 && estadoFinal === "enviado";
  const estadoActualizado =
    infer.nuevoEstado != null && previousEstado === "enviado" && estadoFinal !== previousEstado;

  const data: SifenConsultaLoteTestResponseData = {
    factura_electronica: dto,
    consulta_lote: {
      dFecProc: resp.dFecProc,
      dCodResLot: resp.dCodResLot,
      dMsgResLot: resp.dMsgResLot,
      httpStatus: resp.httpStatus,
      soapFault: resp.soapFault,
      faultString: resp.faultString,
      detallePorCdc: toDetallePersistido(resp),
      loteSinDetalleCdc: ultimaJson.loteSinDetalleCdc,
      loteEnProcesamiento,
      estadoActualizado,
      resumenInferido: buildResumenInferido(resp, infer, estadoFinal, previousEstado),
    },
  };

  if (debugSoap) {
    data.cuerpo_soap = resp.cuerpoSoapCrudo;
  }

  return NextResponse.json(successResponse(data));
}
