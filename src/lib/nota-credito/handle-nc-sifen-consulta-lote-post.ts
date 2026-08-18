import { NextRequest, NextResponse } from "next/server";
import type { UsuarioConEmpresa } from "@/lib/middleware/auth";
import {
  createServiceRoleClientForEmpresa,
  fetchDataSchemaForEmpresaId,
} from "@/lib/supabase/empresa-data-schema";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { successResponse, errorResponse } from "@/lib/api/response";
import { decryptSecret } from "@/lib/sifen/security";
import {
  consultarLoteSifen,
  inferirEstadoSifenTrasConsultaLote,
  type ConsultaLoteRespuestaParsed,
} from "@/lib/sifen/consulta-lote-sifen-test";
import { downloadSifenCertificadoObject } from "@/lib/sifen/sifen-certificados-storage";
import type { AmbienteSifen } from "@/lib/sifen/types";
import { isExplicitSifenTestOverrideEnabled } from "@/lib/env/allow-test-mode";

function parseAmbiente(raw: string): AmbienteSifen | null {
  if (raw === "test" || raw === "produccion") return raw;
  return null;
}

function toDetallePersistido(parsed: ConsultaLoteRespuestaParsed) {
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
): Record<string, unknown> {
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

function esCodigoLote0361(cod: string | null): boolean {
  const c = (cod ?? "").trim();
  if (!c) return false;
  const n = c.replace(/^0+/, "") || "0";
  return c === "0361" || n === "361";
}

export type HandleNcSifenConsultaLotePostOptions = {
  soloAmbienteTest: boolean;
};

export async function handleNcSifenConsultaLotePost(
  request: NextRequest,
  params: Promise<{ id: string }>,
  auth: UsuarioConEmpresa,
  options: HandleNcSifenConsultaLotePostOptions
): Promise<NextResponse> {
  const debugSoap = request.nextUrl.searchParams.get("debug") === "1";
  const supabase = await createServiceRoleClientForEmpresa(auth.empresa_id);
  const { id: notaCreditoId } = await params;
  const nid = notaCreditoId?.trim() ?? "";
  if (!nid) {
    return NextResponse.json(errorResponse("id de nota de crédito es obligatorio"), { status: 400 });
  }

  const { data: neRow, error: errNe } = await supabase
    .from("nota_credito_electronica")
    .select(
      "id, nota_credito_id, estado_sifen, cdc, error, last_error, sifen_d_prot_cons_lote, sifen_ultima_respuesta_consulta_lote, sifen_aprobado_at"
    )
    .eq("nota_credito_id", nid)
    .eq("empresa_id", auth.empresa_id)
    .maybeSingle();

  if (errNe) {
    return NextResponse.json(errorResponse(errNe.message), { status: 400 });
  }
  if (!neRow) {
    return NextResponse.json(errorResponse("No existe registro electrónico para esta nota de crédito."), {
      status: 400,
    });
  }

  const protRaw = neRow.sifen_d_prot_cons_lote == null ? "" : String(neRow.sifen_d_prot_cons_lote).trim();
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

  if (errCfg || !cfg) {
    return NextResponse.json(errorResponse(errCfg?.message ?? "No hay configuración SIFEN para esta empresa."), {
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
        'Este endpoint solo opera con configuración SIFEN en ambiente "test", o bien con ALLOW_TEST_MODE=true en el servidor (consulta contra SET TEST). Use POST .../sifen/consulta-lote para producción real.'
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
    return NextResponse.json(errorResponse(`No se pudo descargar el certificado .p12: ${p12Dl.message}`), {
      status: 500,
    });
  }

  const previousEstado = String(neRow.estado_sifen ?? "sin_envio");
  const previousError = neRow.error == null ? null : String(neRow.error);
  const previousLastError = neRow.last_error == null ? null : String(neRow.last_error);
  const previousConsulta = neRow.sifen_ultima_respuesta_consulta_lote;
  const previousAprobadoAt =
    neRow.sifen_aprobado_at == null ? null : String(neRow.sifen_aprobado_at);

  let resp: ConsultaLoteRespuestaParsed;
  try {
    resp = await consultarLoteSifen({
      dProtConsLote: protRaw,
      empresaConfig: {
        ambiente: ambienteSoap,
        certificadoP12: p12Dl.data,
        certificadoPassword: p12Password,
      },
      facturaElectronicaId: String(neRow.id),
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const label = ambienteSoap === "produccion" ? "SIFEN producción" : "SIFEN TEST";
    return NextResponse.json(errorResponse(`Fallo al llamar a ${label} (consulta-lote): ${m}`), {
      status: 502,
    });
  }

  const ultimaJson = buildUltimaConsultaPersistida(protRaw, resp);
  const cdcNc = neRow.cdc == null ? null : String(neRow.cdc).trim() || null;
  const infer = inferirEstadoSifenTrasConsultaLote(previousEstado, cdcNc, resp);

  let estadoFinal = previousEstado;
  if (infer.nuevoEstado != null) {
    estadoFinal = infer.nuevoEstado;
  } else if (
    !resp.soapFault &&
    esCodigoLote0361(resp.dCodResLot) &&
    (previousEstado === "enviado" || previousEstado === "en_proceso")
  ) {
    estadoFinal = "en_proceso";
  }

  let nuevoError: string | null = previousLastError;
  if (infer.nuevoEstado === "aprobado") {
    nuevoError = null;
  } else if (infer.nuevoEstado === "rechazado") {
    const gr = infer.filaRelevante?.grupo_res[0];
    nuevoError = gr?.dMsgRes ?? infer.filaRelevante?.dEstRes ?? "Documento rechazado por SET.";
  } else if (resp.soapFault) {
    nuevoError = resp.faultString ?? "Fault SOAP en consulta-lote.";
  }

  if (!resp.soapFault && infer.nuevoEstado == null && (estadoFinal === "enviado" || estadoFinal === "en_proceso")) {
    nuevoError = null;
  }

  const tsAprobacion = new Date().toISOString();
  const puedeTransicionSifen = previousEstado === "enviado" || previousEstado === "en_proceso";

  const insertEventos = async (tipos: Array<{ tipo: string; detalle: Record<string, unknown> }>) => {
    const rows = tipos.map((t) => ({
      empresa_id: auth.empresa_id,
      nota_credito_id: nid,
      actor_user_id: auth.user.id,
      tipo_evento: t.tipo,
      detalle_json: t.detalle,
    }));
    return supabase.from("nota_credito_evento").insert(rows);
  };

  const revertNeBasico = async () => {
    await supabase
      .from("nota_credito_electronica")
      .update({
        estado_sifen: previousEstado,
        error: previousError,
        last_error: previousLastError,
        sifen_ultima_respuesta_consulta_lote: previousConsulta,
        sifen_aprobado_at: previousAprobadoAt,
        last_response_json: previousConsulta,
      })
      .eq("id", neRow.id)
      .eq("empresa_id", auth.empresa_id);
  };

  if (infer.nuevoEstado === "aprobado" && puedeTransicionSifen) {
    const { data: ncRow, error: errNc } = await supabase
      .from("nota_credito")
      .select("id, factura_id, monto")
      .eq("id", nid)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errNc || !ncRow) {
      return NextResponse.json(errorResponse(errNc?.message ?? "Nota de crédito no encontrada."), {
        status: errNc ? 400 : 404,
      });
    }

    const dataSchema = await fetchDataSchemaForEmpresaId(auth.empresa_id);
    const catalog = createServiceRoleClient();
    const { error: rpcErr } = await catalog.rpc("nota_credito_tras_aprobacion_set_transaccional", {
      p_data_schema: dataSchema,
      p_ne_id: neRow.id,
      p_nc_id: nid,
      p_factura_id: String(ncRow.factura_id),
      p_empresa_id: auth.empresa_id,
      p_monto: Number(ncRow.monto),
      p_ultima_consulta: ultimaJson,
      p_sifen_aprobado_at: tsAprobacion,
    });

    if (rpcErr) {
      return NextResponse.json(errorResponse(`RPC aprobación NC: ${rpcErr.message}`), { status: 409 });
    }

    const { data: facPost } = await supabase
      .from("facturas")
      .select("estado, saldo")
      .eq("id", String(ncRow.factura_id))
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    const { error: evErr } = await insertEventos([
      {
        tipo: "respuesta_set",
        detalle: { consulta_lote: ultimaJson, dProtConsLote: protRaw, consultadoEn: ultimaJson.consultadoEn },
      },
      {
        tipo: "aprobado",
        detalle: {
          consulta_lote: ultimaJson,
          cdc: cdcNc,
          sifen_aprobado_at: tsAprobacion,
        },
      },
      {
        tipo: "impacto_saldo_aplicado",
        detalle: {
          factura_id: String(ncRow.factura_id),
          nota_credito_id: nid,
          monto_nc: Number(ncRow.monto),
          consultadoEn: ultimaJson.consultadoEn,
          factura_estado: facPost?.estado == null ? null : String(facPost.estado),
          factura_saldo: facPost?.saldo == null ? null : Number(facPost.saldo),
        },
      },
    ]);

    if (evErr) {
      return NextResponse.json(
        errorResponse(
          `Aprobación aplicada en BD pero falló el registro de auditoría (${evErr.message}). Revise nota_credito_evento.`
        ),
        { status: 500 }
      );
    }

    const { data: neFresh } = await supabase
      .from("nota_credito_electronica")
      .select()
      .eq("id", neRow.id)
      .eq("empresa_id", auth.empresa_id)
      .single();

    const data: Record<string, unknown> = {
      nota_credito_electronica: neFresh,
      consulta_lote: {
        dFecProc: resp.dFecProc,
        dCodResLot: resp.dCodResLot,
        dMsgResLot: resp.dMsgResLot,
        httpStatus: resp.httpStatus,
        soapFault: resp.soapFault,
        faultString: resp.faultString,
        detallePorCdc: toDetallePersistido(resp),
        estado_sifen_anterior: previousEstado,
        estado_sifen_nuevo: "aprobado",
      },
    };
    if (debugSoap) data.cuerpo_soap = resp.cuerpoSoapCrudo;
    return NextResponse.json(successResponse(data));
  }

  if (infer.nuevoEstado === "rechazado" && puedeTransicionSifen) {
    const updatePayload: Record<string, unknown> = {
      estado_sifen: "rechazado",
      error: nuevoError,
      last_error: nuevoError,
      sifen_ultima_respuesta_consulta_lote: ultimaJson,
      last_response_json: ultimaJson,
    };

    const { data: updatedRow, error: errUpdate } = await supabase
      .from("nota_credito_electronica")
      .update(updatePayload)
      .eq("id", neRow.id)
      .eq("empresa_id", auth.empresa_id)
      .select()
      .single();

    if (errUpdate || !updatedRow) {
      return NextResponse.json(
        errorResponse(errUpdate?.message ?? "No se pudo actualizar nota_credito_electronica."),
        { status: 500 }
      );
    }

    await supabase
      .from("nota_credito")
      .update({ estado_erp: "rechazada" })
      .eq("id", nid)
      .eq("empresa_id", auth.empresa_id);

    const { error: evErr } = await insertEventos([
      {
        tipo: "respuesta_set",
        detalle: { consulta_lote: ultimaJson, dProtConsLote: protRaw },
      },
      {
        tipo: "rechazado",
        detalle: {
          consulta_lote: ultimaJson,
          mensaje: nuevoError,
          cdc: cdcNc,
        },
      },
    ]);

    if (evErr) {
      await revertNeBasico();
      return NextResponse.json(
        errorResponse(`No se pudo registrar auditoría; se revirtió: ${evErr.message}`),
        { status: 500 }
      );
    }

    const data: Record<string, unknown> = {
      nota_credito_electronica: updatedRow,
      consulta_lote: {
        dFecProc: resp.dFecProc,
        dCodResLot: resp.dCodResLot,
        dMsgResLot: resp.dMsgResLot,
        httpStatus: resp.httpStatus,
        detallePorCdc: toDetallePersistido(resp),
        estado_sifen_anterior: previousEstado,
        estado_sifen_nuevo: "rechazado",
      },
    };
    if (debugSoap) data.cuerpo_soap = resp.cuerpoSoapCrudo;
    return NextResponse.json(successResponse(data));
  }

  const updatePayload: Record<string, unknown> = {
    estado_sifen: estadoFinal,
    error: nuevoError,
    last_error: nuevoError,
    sifen_ultima_respuesta_consulta_lote: ultimaJson,
    last_response_json: ultimaJson,
  };

  const { data: updatedRow, error: errUpdate } = await supabase
    .from("nota_credito_electronica")
    .update(updatePayload)
    .eq("id", neRow.id)
    .eq("empresa_id", auth.empresa_id)
    .select()
    .single();

  if (errUpdate || !updatedRow) {
    return NextResponse.json(
      errorResponse(errUpdate?.message ?? "No se pudo actualizar nota_credito_electronica."),
      { status: 500 }
    );
  }

  const { error: errEvento } = await supabase.from("nota_credito_evento").insert({
    empresa_id: auth.empresa_id,
    nota_credito_id: nid,
    actor_user_id: auth.user.id,
    tipo_evento: "respuesta_set",
    detalle_json: {
      consulta_lote: ultimaJson,
      dProtConsLote: protRaw,
      estado_sifen_anterior: previousEstado,
      estado_sifen_nuevo: estadoFinal,
    },
  });

  if (errEvento) {
    await supabase
      .from("nota_credito_electronica")
      .update({
        estado_sifen: previousEstado,
        error: previousError,
        last_error: previousLastError,
        sifen_ultima_respuesta_consulta_lote: previousConsulta,
        last_response_json: previousConsulta,
        sifen_aprobado_at: previousAprobadoAt,
      })
      .eq("id", neRow.id)
      .eq("empresa_id", auth.empresa_id);
    return NextResponse.json(
      errorResponse(`No se pudo registrar el evento; se revirtió el estado: ${errEvento.message}`),
      { status: 500 }
    );
  }

  const data: Record<string, unknown> = {
    nota_credito_electronica: updatedRow,
    consulta_lote: {
      dFecProc: resp.dFecProc,
      dCodResLot: resp.dCodResLot,
      dMsgResLot: resp.dMsgResLot,
      httpStatus: resp.httpStatus,
      soapFault: resp.soapFault,
      faultString: resp.faultString,
      detallePorCdc: toDetallePersistido(resp),
      estado_sifen_anterior: previousEstado,
      estado_sifen_nuevo: estadoFinal,
    },
  };
  if (debugSoap) data.cuerpo_soap = resp.cuerpoSoapCrudo;

  return NextResponse.json(successResponse(data));
}
