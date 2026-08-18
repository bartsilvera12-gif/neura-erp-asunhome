import { NextResponse } from "next/server";
import type { UsuarioConEmpresa } from "@/lib/middleware/auth";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { decryptSecret } from "@/lib/sifen/security";
import { enviarLoteSifen, type RecibeLoteRespuestaParsed } from "@/lib/sifen/enviar-lote-sifen-test";
import { recibirDeSifenSync } from "@/lib/sifen/recibe-de-sifen-test";
import { downloadSifenObject, SIFEN_STORAGE_BUCKET } from "@/lib/sifen/sifen-storage";
import { downloadSifenCertificadoObject } from "@/lib/sifen/sifen-certificados-storage";
import type { AmbienteSifen } from "@/lib/sifen/types";
import { isExplicitSifenTestOverrideEnabled } from "@/lib/env/allow-test-mode";
import { assertNcSifenSinVentanaCancelacionDe } from "./assert-nc-sifen-cancelacion";
import { obtenerSifenPrevueloFacturaParaNcs, validarNcFirmadoListoParaEnvioSet } from "./pre-vuelo-nc-sifen";
import { MSG_USUARIO_BLOQUEO_NC_TIMBRADO } from "@/lib/sifen/gtimb-nc-coherencia";

function parseAmbiente(raw: string): AmbienteSifen | null {
  if (raw === "test" || raw === "produccion") return raw;
  return null;
}

function decodificarEntidadesSoapBasicas(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(String(n), 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function respuestaRecibeLoteJson(r: RecibeLoteRespuestaParsed): Record<string, unknown> {
  return {
    dCodRes: r.dCodRes,
    dMsgRes: r.dMsgRes,
    dProtConsLote: r.dProtConsLote,
    dFecProc: r.dFecProc,
    dTpoProces: r.dTpoProces,
    loteRecibido: r.loteRecibido,
    loteNoEncolado: r.loteNoEncolado,
    httpStatus: r.httpStatus,
    cuerpoSoapCrudo: r.cuerpoSoapCrudo,
  };
}

export type HandleNcSifenEnviarPostOptions = {
  soloAmbienteTest: boolean;
};

export async function handleNcSifenEnviarPost(
  supabase: AppSupabaseClient,
  auth: UsuarioConEmpresa,
  notaCreditoId: string,
  options: HandleNcSifenEnviarPostOptions,
  debugSoap: boolean
): Promise<NextResponse> {
  const nid = notaCreditoId.trim();

  const { data: ncRow, error: errNc } = await supabase
    .from("nota_credito")
    .select("id, factura_id, estado_erp")
    .eq("id", nid)
    .eq("empresa_id", auth.empresa_id)
    .maybeSingle();

  if (errNc || !ncRow) {
    return NextResponse.json(errorResponse(errNc?.message ?? "Nota de crédito no encontrada."), {
      status: errNc ? 400 : 404,
    });
  }
  const facturaId = String((ncRow as { factura_id: string }).factura_id);
  if (String((ncRow as { estado_erp: string }).estado_erp) === "anulada_borrador") {
    return NextResponse.json(errorResponse("La nota de crédito está anulada."), { status: 409 });
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
        subtipo: "prevuelo_factura_origen_envio",
        resultado: "error",
        mensaje_tecnico: prev.mensaje,
        diagnostico: prev.diagnostico,
      },
    });
    return NextResponse.json(errorResponse(MSG_USUARIO_BLOQUEO_NC_TIMBRADO), { status: 400 });
  }

  const { data: neRow, error: errNe } = await supabase
    .from("nota_credito_electronica")
    .select(
      "id, nota_credito_id, estado_sifen, xml_firmado_path, error, sifen_d_prot_cons_lote, sifen_ultima_respuesta_recibe_lote, sifen_ultima_respuesta_consulta_lote"
    )
    .eq("nota_credito_id", nid)
    .eq("empresa_id", auth.empresa_id)
    .maybeSingle();

  if (errNe || !neRow) {
    return NextResponse.json(errorResponse(errNe?.message ?? "No existe registro electrónico para esta NC."), {
      status: errNe ? 400 : 400,
    });
  }

  const estNe = String(neRow.estado_sifen);
  if (estNe !== "firmado" && estNe !== "error_envio") {
    return NextResponse.json(
      errorResponse(`Solo se puede enviar con XML firmado (estado "firmado" o reintento desde "error_envio"). Actual: "${estNe}".`),
      { status: 409 }
    );
  }

  const signedPath = neRow.xml_firmado_path == null ? "" : String(neRow.xml_firmado_path).trim();
  if (!signedPath) {
    return NextResponse.json(errorResponse("No hay XML firmado. Ejecute primero POST .../sifen/firmar."), {
      status: 400,
    });
  }

  const { data: cfg, error: errCfg } = await supabase
    .from("empresa_sifen_config")
    .select("ambiente, activo, certificado_path, certificado_password_encrypted")
    .eq("empresa_id", auth.empresa_id)
    .maybeSingle();

  if (errCfg || !cfg) {
    return NextResponse.json(errorResponse(errCfg?.message ?? "No hay configuración SIFEN."), { status: 400 });
  }

  const ambiente = parseAmbiente(String(cfg.ambiente ?? ""));
  if (!ambiente) {
    return NextResponse.json(errorResponse('Ambiente SIFEN inválido (use "test" o "produccion").'), { status: 400 });
  }

  if (options.soloAmbienteTest && ambiente !== "test" && !isExplicitSifenTestOverrideEnabled()) {
    return NextResponse.json(
      errorResponse(
        'Este endpoint solo opera con configuración SIFEN en ambiente "test", o bien con ALLOW_TEST_MODE=true en el servidor (SOAP sigue yendo a SET TEST). Use POST .../sifen/enviar para producción real.'
      ),
      { status: 400 }
    );
  }

  /** Siempre contra URLs de SET TEST cuando se usa ruta *-test. */
  const ambienteSoap: AmbienteSifen = options.soloAmbienteTest ? "test" : ambiente;

  if (cfg.activo === false) {
    return NextResponse.json(errorResponse("La configuración SIFEN está inactiva."), { status: 400 });
  }

  const certPath = cfg.certificado_path == null ? "" : String(cfg.certificado_path).trim();
  if (!certPath) {
    return NextResponse.json(errorResponse("No hay certificado en storage."), { status: 400 });
  }

  const encPwd = cfg.certificado_password_encrypted;
  if (encPwd == null || String(encPwd).trim() === "") {
    return NextResponse.json(errorResponse("Falta contraseña del certificado cifrada."), { status: 400 });
  }

  let p12Password: string;
  try {
    p12Password = decryptSecret(String(encPwd));
  } catch (e) {
    const m = e instanceof Error ? e.message : "Error al descifrar la contraseña del certificado";
    return NextResponse.json(errorResponse(m), { status: 500 });
  }

  const xmlDl = await downloadSifenObject(supabase, signedPath);
  if (!xmlDl.ok) {
    return NextResponse.json(errorResponse(`No se pudo descargar el XML firmado: ${xmlDl.message}`), {
      status: 500,
    });
  }

  const xmlUtf8 = xmlDl.data.toString("utf8");
  const gateSend = await validarNcFirmadoListoParaEnvioSet({
    supabase,
    empresaId: auth.empresa_id,
    ncId: nid,
    xmlFirmadoUtf8: xmlUtf8,
    ambienteDeXml: ambienteSoap,
  });
  if (!gateSend.ok) {
    await supabase.from("nota_credito_evento").insert({
      empresa_id: auth.empresa_id,
      nota_credito_id: nid,
      actor_user_id: auth.user.id,
      tipo_evento: "validacion",
      detalle_json: {
        subtipo: "timbrado_previo_envio_set",
        resultado: "error",
        error: gateSend.message,
        xml_firmado_path: signedPath,
      },
    });
    return NextResponse.json(errorResponse(gateSend.message), { status: 400 });
  }

  const p12Dl = await downloadSifenCertificadoObject(supabase, certPath);
  if (!p12Dl.ok) {
    return NextResponse.json(errorResponse(`No se pudo descargar el .p12: ${p12Dl.message}`), { status: 500 });
  }

  let resp: RecibeLoteRespuestaParsed;
  try {
    resp = await enviarLoteSifen({
      xmlFirmado: xmlUtf8,
      empresaConfig: {
        ambiente: ambienteSoap,
        certificadoP12: p12Dl.data,
        certificadoPassword: p12Password,
      },
      facturaElectronicaId: String(neRow.id),
      envoltorioRloteDe: true,
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const label = ambienteSoap === "produccion" ? "SIFEN producción" : "SIFEN TEST";
    return NextResponse.json(errorResponse(`Fallo al llamar a ${label} (recibe-lote): ${m}`), { status: 502 });
  }

  const respuestaJson = respuestaRecibeLoteJson(resp);

  const previousEstado = String(neRow.estado_sifen ?? "firmado");
  const previousError = neRow.error == null ? null : String(neRow.error);
  const previousProt = neRow.sifen_d_prot_cons_lote == null ? null : String(neRow.sifen_d_prot_cons_lote);
  const previousUltima = neRow.sifen_ultima_respuesta_recibe_lote;
  const previousConsultaLote = neRow.sifen_ultima_respuesta_consulta_lote;

  let nuevoEstado: "enviado" | "error_envio";
  let nuevoError: string | null;
  let nuevoProt: string | null;

  const codRecibe = String(resp.dCodRes ?? "").trim();
  const codSinCerosIni = codRecibe.replace(/^0+/, "") || "";
  const codigoEs0300 = codRecibe === "0300" || codSinCerosIni === "300";
  const protTrim = resp.dProtConsLote == null ? "" : String(resp.dProtConsLote).trim();
  const http2xx = resp.httpStatus >= 200 && resp.httpStatus < 300;
  const loteAceptadoPorSet =
    resp.loteRecibido ||
    codigoEs0300 ||
    (http2xx && protTrim.length > 0 && !resp.loteNoEncolado);

  const consultaLoteHint =
    ambienteSoap === "produccion"
      ? " — Use «Consultar lote SET» con el protocolo"
      : " — Use «Consultar lote TEST» con el protocolo";

  if (loteAceptadoPorSet) {
    nuevoEstado = "enviado";
    nuevoError = null;
    nuevoProt = resp.dProtConsLote == null ? null : String(resp.dProtConsLote).trim() || null;
  } else if (resp.loteNoEncolado) {
    nuevoEstado = "error_envio";
    const baseErr =
      [resp.dMsgRes, resp.dCodRes ? `Código ${resp.dCodRes}` : null].filter(Boolean).join(" — ") ||
      "SET no encoló el lote (0301).";
    nuevoProt = protTrim.length > 0 ? protTrim : null;
    let detalleRecibeSync = "";
    try {
      const sync = await recibirDeSifenSync({
        xmlFirmadoRde: xmlUtf8,
        empresaConfig: {
          ambiente: ambienteSoap,
          certificadoP12: p12Dl.data,
          certificadoPassword: p12Password,
        },
      });
      if (!sync.soapFault && sync.gResProc.length > 0) {
        const g = sync.gResProc[0]!;
        detalleRecibeSync = ` ${decodificarEntidadesSoapBasicas(`[${g.dCodRes}] ${g.dMsgRes}`)}`;
      }
    } catch {
      /* diagnóstico opcional */
    }
    const sufProt =
      nuevoProt != null ? `${consultaLoteHint} ${nuevoProt} para más detalle si aplica.` : "";
    nuevoError = `${baseErr}${detalleRecibeSync ? `.${detalleRecibeSync}` : ""}${sufProt}`;
  } else {
    nuevoEstado = "error_envio";
    const code = resp.dCodRes?.trim() ?? "";
    nuevoError =
      [resp.dMsgRes, code ? `Código ${code}` : null, `HTTP ${resp.httpStatus}`]
        .filter(Boolean)
        .join(" — ") || "Respuesta inesperada de recibe-lote.";
    nuevoProt = protTrim.length > 0 ? protTrim : null;
  }

  const { data: updatedRow, error: errUpdate } = await supabase
    .from("nota_credito_electronica")
    .update({
      estado_sifen: nuevoEstado,
      error: nuevoError,
      last_error: nuevoError,
      sifen_d_prot_cons_lote: nuevoProt,
      sifen_ultima_respuesta_recibe_lote: respuestaJson,
      last_response_json: respuestaJson,
      sifen_ultima_respuesta_consulta_lote: null,
    })
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

  const ts = new Date().toISOString();
  const { error: errEv } = await supabase.from("nota_credito_evento").insert([
    {
      empresa_id: auth.empresa_id,
      nota_credito_id: nid,
      actor_user_id: auth.user.id,
      tipo_evento: "enviado_set",
      detalle_json: {
        recibe_lote: respuestaJson,
        xml_firmado_path: signedPath,
        dProtConsLote: nuevoProt,
        consultadoEn: ts,
      },
    },
    {
      empresa_id: auth.empresa_id,
      nota_credito_id: nid,
      actor_user_id: auth.user.id,
      tipo_evento: "respuesta_set",
      detalle_json: {
        fase: "recibe_lote",
        recibe_lote: respuestaJson,
        dProtConsLote: nuevoProt,
        consultadoEn: ts,
      },
    },
  ]);

  if (errEv) {
    await supabase
      .from("nota_credito_electronica")
      .update({
        estado_sifen: previousEstado,
        error: previousError,
        last_error: previousError,
        sifen_d_prot_cons_lote: previousProt,
        sifen_ultima_respuesta_recibe_lote: previousUltima,
        sifen_ultima_respuesta_consulta_lote: previousConsultaLote,
      })
      .eq("id", neRow.id)
      .eq("empresa_id", auth.empresa_id);
    return NextResponse.json(
      errorResponse(`No se pudo registrar auditoría; se revirtió: ${errEv.message}`),
      { status: 500 }
    );
  }

  if (nuevoEstado === "error_envio") {
    await supabase
      .from("nota_credito")
      .update({ estado_erp: "error" })
      .eq("id", nid)
      .eq("empresa_id", auth.empresa_id);
    await supabase.from("nota_credito_evento").insert({
      empresa_id: auth.empresa_id,
      nota_credito_id: nid,
      actor_user_id: auth.user.id,
      tipo_evento: "error_envio",
      detalle_json: { recibe_lote: respuestaJson, mensaje: nuevoError },
    });
  }

  const data: Record<string, unknown> = {
    nota_credito_electronica: updatedRow,
    storage_bucket: SIFEN_STORAGE_BUCKET,
    recibe_lote: {
      dCodRes: resp.dCodRes,
      dMsgRes: resp.dMsgRes,
      dProtConsLote: resp.dProtConsLote,
      dFecProc: resp.dFecProc,
      dTpoProces: resp.dTpoProces,
      httpStatus: resp.httpStatus,
      loteRecibido: resp.loteRecibido,
      loteNoEncolado: resp.loteNoEncolado,
    },
  };
  if (debugSoap) {
    data.cuerpo_soap = resp.cuerpoSoapCrudo;
    data.solicitud_https = resp.solicitudHttps;
  }

  return NextResponse.json(successResponse(data));
}
