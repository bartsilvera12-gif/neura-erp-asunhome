/**
 * E2E real: XML → firma → recibe-lote TEST (mismo stack que la API).
 * Uso: npx tsx scripts/e2e-sifen-recibe-lote-real.ts [factura_id]
 * Requiere: .env.local (Supabase; SIFEN_SECRETS_KEY alineada con BD o E2E_CERT_PASSWORD_PLAIN como respaldo).
 */
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { loadValidatedSifenPayload } from "../src/lib/sifen/load-factura-payload";
import { buildOfficialRdeFacturaElectronicaXml } from "../src/lib/sifen/rde-xml";
import { resolveP12PasswordForScripts } from "../src/lib/sifen/resolve-p12-password-for-scripts";
import { SIFEN_TEST_CSC_GENERICO } from "../src/lib/sifen/sifen-ambiente-test";
import { extractKeyAndCertFromP12, signSifenDocumentoXml } from "../src/lib/sifen/sign-xml";
import { enviarLoteSifenTest } from "../src/lib/sifen/enviar-lote-sifen-test";
import {
  buildSifenSignedXmlObjectPath,
  buildSifenXmlObjectPath,
  uploadSifenXml,
} from "../src/lib/sifen/sifen-storage";
import { downloadSifenCertificadoObject } from "../src/lib/sifen/sifen-certificados-storage";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const facturaIdArg = process.argv[2]?.trim();
const DEFAULT_FACTURA = "3f1cbd4d-2310-407d-a5f2-7a1a0539c939";

async function main() {
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const facturaId = facturaIdArg || DEFAULT_FACTURA;

  const { data: fac, error: ef } = await supabase
    .from("facturas")
    .select("id, empresa_id")
    .eq("id", facturaId)
    .maybeSingle();
  if (ef || !fac) {
    throw new Error(`Factura no encontrada: ${facturaId} (${ef?.message ?? ""})`);
  }
  const empresaId = fac.empresa_id as string;

  const { data: cfg, error: ec } = await supabase
    .from("empresa_sifen_config")
    .select("ambiente, activo, certificado_path, certificado_password_encrypted")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (ec || !cfg) throw new Error("empresa_sifen_config no encontrada");
  if (String(cfg.ambiente) !== "test") throw new Error('La empresa debe tener ambiente SIFEN "test"');
  if (!cfg.activo) throw new Error("SIFEN config inactiva");

  const certPath = String(cfg.certificado_path ?? "").trim();
  if (!certPath) throw new Error("certificado_path vacío");
  const encPwd = cfg.certificado_password_encrypted;
  if (encPwd == null || String(encPwd).trim() === "") throw new Error("Falta certificado_password_encrypted");

  const p12Password = resolveP12PasswordForScripts(String(encPwd));
  const p12Dl = await downloadSifenCertificadoObject(supabase, certPath);
  if (!p12Dl.ok) throw new Error(p12Dl.message);

  const loaded = await loadValidatedSifenPayload(supabase, empresaId, facturaId);
  if (!loaded.ok) throw new Error(loaded.error.message);

  const fecha = loaded.payload.documento.fecha.trim();
  const yAnio = /^(\d{4})/.exec(fecha)?.[1] ?? String(new Date().getFullYear());

  const xmlSinFirma = buildOfficialRdeFacturaElectronicaXml(loaded.payload, {
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

  const xmlPath = buildSifenXmlObjectPath(empresaId, facturaId);
  const signedPath = buildSifenSignedXmlObjectPath(empresaId, facturaId);
  const up = await uploadSifenXml(supabase, xmlPath, xmlSinFirma);
  if (!up.ok) throw new Error(up.message);

  const material = extractKeyAndCertFromP12(p12Dl.data, p12Password);
  const xmlFirmado = signSifenDocumentoXml(xmlSinFirma, material, {
    ambiente: "test",
    csc: SIFEN_TEST_CSC_GENERICO,
  });
  const upF = await uploadSifenXml(supabase, signedPath, xmlFirmado);
  if (!upF.ok) throw new Error(upF.message);

  const cdc = /\bId="(\d{44})"/.exec(xmlFirmado)?.[1] ?? null;

  const resp = await enviarLoteSifenTest({
    xmlFirmado,
    empresaConfig: {
      ambiente: "test",
      certificadoP12: p12Dl.data,
      certificadoPassword: p12Password,
    },
    envoltorioRloteDe: true,
  });

  const reporte = {
    factura_id: facturaId,
    empresa_id: empresaId,
    cdc,
    xml_path: xmlPath,
    xml_firmado_path: signedPath,
    xml_firmado_exacto: xmlFirmado,
    solicitud: resp.solicitudHttps,
    httpStatus: resp.httpStatus,
    dCodRes: resp.dCodRes,
    dMsgRes: resp.dMsgRes,
    dProtConsLote: resp.dProtConsLote,
    dFecProc: resp.dFecProc,
    dTpoProces: resp.dTpoProces,
    loteRecibido: resp.loteRecibido,
    loteNoEncolado: resp.loteNoEncolado,
    respuesta_soap_exacta: resp.cuerpoSoapCrudo,
  };

  const outFile = path.join(process.cwd(), "scripts", "e2e-sifen-recibe-lote-output.json");
  fs.writeFileSync(outFile, JSON.stringify(reporte, null, 2), "utf8");
  console.log(`Reporte escrito: ${outFile}`);
  console.log(
    JSON.stringify(
      {
        factura_id: facturaId,
        cdc,
        xml_path: xmlPath,
        xml_firmado_path: signedPath,
        url: resp.solicitudHttps?.url,
        method: resp.solicitudHttps?.method,
        contentType: resp.solicitudHttps?.contentType,
        httpStatus: resp.httpStatus,
        dCodRes: resp.dCodRes,
        dMsgRes: resp.dMsgRes,
        dProtConsLote: resp.dProtConsLote,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
