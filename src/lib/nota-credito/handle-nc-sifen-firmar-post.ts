import { NextResponse } from "next/server";
import type { UsuarioConEmpresaYRol } from "@/lib/middleware/auth";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { decryptSecret } from "@/lib/sifen/security";
import {
  buildSifenNcSignedXmlObjectPath,
  buildSifenNcXmlObjectPath,
  downloadSifenObject,
  ensureSifenStorageBucket,
  removeSifenObject,
  SIFEN_STORAGE_BUCKET,
  uploadSifenXml,
} from "@/lib/sifen/sifen-storage";
import { downloadSifenCertificadoObject } from "@/lib/sifen/sifen-certificados-storage";
import { extractKeyAndCertFromP12, signSifenDocumentoXml } from "@/lib/sifen/sign-xml";
import { SIFEN_TEST_CSC_GENERICO } from "@/lib/sifen/sifen-ambiente-test";
import { parseAmbiente } from "@/lib/sifen/config-validation";
import type { AmbienteSifen } from "@/lib/sifen/types";
import { isExplicitSifenTestOverrideEnabled } from "@/lib/env/allow-test-mode";
import { assertNcSifenSinVentanaCancelacionDe } from "./assert-nc-sifen-cancelacion";
import { obtenerSifenPrevueloFacturaParaNcs } from "./pre-vuelo-nc-sifen";
import { MSG_USUARIO_BLOQUEO_NC_TIMBRADO } from "@/lib/sifen/gtimb-nc-coherencia";

const ESTADOS_BLOQUEADOS_FIRMAR = new Set<string>(["aprobado", "rechazado", "cancelado", "enviado", "en_proceso"]);

export async function handleNcSifenFirmarPost(opts: {
  auth: UsuarioConEmpresaYRol;
  supabase: AppSupabaseClient;
  notaCreditoId: string;
  debugXml: boolean;
  /** Solo `test`; permitido si config ya es test o ALLOW_TEST_MODE en servidor (pipeline *-test). */
  ambienteFirmaOverride?: AmbienteSifen;
}): Promise<NextResponse> {
  const { auth, supabase, notaCreditoId, debugXml, ambienteFirmaOverride } = opts;
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
        subtipo: "prevuelo_factura_origen_firma",
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

  const est = String((neRow as { estado_sifen: string }).estado_sifen ?? "");
  if (ESTADOS_BLOQUEADOS_FIRMAR.has(est)) {
    return NextResponse.json(errorResponse(`No se puede firmar en estado SIFEN "${est}".`), { status: 409 });
  }

  const canonicalXmlPath = buildSifenNcXmlObjectPath(auth.empresa_id, nid);
  const xmlPathReg = (neRow as { xml_path: string | null }).xml_path;
  if (xmlPathReg == null || String(xmlPathReg).trim() === "") {
    return NextResponse.json(
      errorResponse("No hay XML generado. Ejecute primero POST /api/notas-credito/{id}/sifen/xml."),
      { status: 400 }
    );
  }

  const { data: cfg, error: errCfg } = await supabase
    .from("empresa_sifen_config")
    .select("certificado_path, certificado_password_encrypted, ambiente, csc")
    .eq("empresa_id", auth.empresa_id)
    .maybeSingle();

  if (errCfg || !cfg) {
    return NextResponse.json(errorResponse(errCfg?.message ?? "No hay configuración SIFEN."), { status: 400 });
  }

  const certPath = cfg.certificado_path == null ? "" : String(cfg.certificado_path).trim();
  if (!certPath) {
    return NextResponse.json(errorResponse("No hay certificado .p12 configurado."), { status: 400 });
  }
  const encPwd = cfg.certificado_password_encrypted;
  if (encPwd == null || String(encPwd).trim() === "") {
    return NextResponse.json(errorResponse("Falta contraseña del certificado cifrada."), { status: 400 });
  }

  const ambienteCfg = parseAmbiente(cfg.ambiente);
  if (!ambienteCfg) {
    return NextResponse.json(errorResponse('Ambiente SIFEN inválido (use "test" o "produccion").'), { status: 400 });
  }

  let ambiente = ambienteCfg;
  if (ambienteFirmaOverride === "test") {
    if (ambienteCfg === "test" || isExplicitSifenTestOverrideEnabled()) {
      ambiente = "test";
    } else {
      return NextResponse.json(
        errorResponse('Firma en ambiente "test" no permitida sin ALLOW_TEST_MODE o configuración SIFEN en test.'),
        { status: 400 }
      );
    }
  }

  const cscCfg = cfg.csc == null ? "" : String(cfg.csc).trim();
  const cscParaQr = ambiente === "test" ? (cscCfg !== "" ? cscCfg : SIFEN_TEST_CSC_GENERICO) : cscCfg;
  if (ambiente === "produccion" && cscParaQr === "") {
    return NextResponse.json(errorResponse("Falta CSC en configuración SIFEN para producción."), { status: 400 });
  }

  let p12Password: string;
  try {
    p12Password = decryptSecret(String(encPwd));
  } catch (e) {
    const m = e instanceof Error ? e.message : "Error al descifrar la contraseña del certificado";
    return NextResponse.json(errorResponse(m), { status: 500 });
  }

  const xmlDl = await downloadSifenObject(supabase, canonicalXmlPath);
  if (!xmlDl.ok) {
    return NextResponse.json(errorResponse(`No se pudo descargar el XML: ${xmlDl.message}`), { status: 500 });
  }

  const p12Dl = await downloadSifenCertificadoObject(supabase, certPath);
  if (!p12Dl.ok) {
    return NextResponse.json(errorResponse(`No se pudo descargar el .p12: ${p12Dl.message}`), { status: 500 });
  }

  let material;
  try {
    material = extractKeyAndCertFromP12(p12Dl.data, p12Password);
  } catch (e) {
    const m = e instanceof Error ? e.message : "Error al leer el .p12";
    return NextResponse.json(errorResponse(m), { status: 400 });
  }

  let signedXml: string;
  try {
    signedXml = signSifenDocumentoXml(xmlDl.data.toString("utf8"), material, {
      ambiente,
      csc: cscParaQr,
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : "Error al firmar el XML";
    return NextResponse.json(errorResponse(`Firma XML-DSig falló: ${m}`), { status: 500 });
  }

  const bucketOk = await ensureSifenStorageBucket(supabase);
  if (!bucketOk.ok) {
    return NextResponse.json(errorResponse(`Storage SIFEN: ${bucketOk.message}`), { status: 500 });
  }

  const feRow = neRow as { id: string; xml_path: string | null; xml_firmado_path: string | null; estado_sifen: string };
  const previousEstado = String(feRow.estado_sifen ?? "generado");
  const previousSignedPath =
    feRow.xml_firmado_path == null ? null : String(feRow.xml_firmado_path);
  const previousXmlPath = feRow.xml_path == null ? null : String(feRow.xml_path);

  const signedPath = buildSifenNcSignedXmlObjectPath(auth.empresa_id, nid);
  await removeSifenObject(supabase, signedPath);
  if (
    previousSignedPath != null &&
    String(previousSignedPath).trim() !== "" &&
    String(previousSignedPath).trim() !== signedPath
  ) {
    await removeSifenObject(supabase, String(previousSignedPath).trim());
  }

  const up = await uploadSifenXml(supabase, signedPath, signedXml);
  if (!up.ok) {
    return NextResponse.json(errorResponse(`No se pudo guardar el XML firmado: ${up.message}`), { status: 500 });
  }

  const { data: updatedRow, error: errUpdate } = await supabase
    .from("nota_credito_electronica")
    .update({
      xml_firmado_path: signedPath,
      estado_sifen: "firmado",
      xml_path: canonicalXmlPath,
    })
    .eq("id", feRow.id)
    .eq("empresa_id", auth.empresa_id)
    .select()
    .single();

  if (errUpdate || !updatedRow) {
    await removeSifenObject(supabase, signedPath);
    return NextResponse.json(
      errorResponse(errUpdate?.message ?? "No se pudo actualizar nota_credito_electronica."),
      { status: 500 }
    );
  }

  const { error: errEv } = await supabase.from("nota_credito_evento").insert({
    empresa_id: auth.empresa_id,
    nota_credito_id: nid,
    actor_user_id: auth.user.id,
    tipo_evento: "xml_firmado",
    detalle_json: {
      xml_firmado_path: signedPath,
      factura_id: facturaId,
      nota_credito_electronica_id: feRow.id,
    },
  });

  if (errEv) {
    await supabase
      .from("nota_credito_electronica")
      .update({
        xml_firmado_path: previousSignedPath,
        estado_sifen: previousEstado,
        xml_path: previousXmlPath,
      })
      .eq("id", feRow.id)
      .eq("empresa_id", auth.empresa_id);
    await removeSifenObject(supabase, signedPath);
    return NextResponse.json(
      errorResponse(`No se pudo registrar auditoría; se revirtió: ${errEv.message}`),
      { status: 500 }
    );
  }

  const data: Record<string, unknown> = {
    nota_credito_electronica: updatedRow,
    xml_path: canonicalXmlPath,
    xml_firmado_path: signedPath,
    storage_bucket: SIFEN_STORAGE_BUCKET,
  };
  if (debugXml) {
    data.xml_firmado = signedXml;
  }

  return NextResponse.json(successResponse(data));
}
