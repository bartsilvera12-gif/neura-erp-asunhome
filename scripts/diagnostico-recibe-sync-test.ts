/**
 * Diagnóstico real (usa .env.local + Supabase + certificado en storage):
 * firma el DE y llama a recibe **síncrono** TEST para ver códigos en rProtDe/gResProc.
 *
 * Uso: npx tsx scripts/diagnostico-recibe-sync-test.ts [factura_id]
 */
import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { loadValidatedSifenPayload } from "../src/lib/sifen/load-factura-payload";
import { buildOfficialRdeFacturaElectronicaXml } from "../src/lib/sifen/rde-xml";
import { resolveP12PasswordForScripts } from "../src/lib/sifen/resolve-p12-password-for-scripts";
import { SIFEN_TEST_CSC_GENERICO } from "../src/lib/sifen/sifen-ambiente-test";
import { extractKeyAndCertFromP12, signSifenDocumentoXml } from "../src/lib/sifen/sign-xml";
import { recibirDeSifenTestSync } from "../src/lib/sifen/recibe-de-sifen-test";
import { downloadSifenCertificadoObject } from "../src/lib/sifen/sifen-certificados-storage";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  const facturaId = process.argv[2]?.trim() || "5afaba52-25b5-4f76-a746-4e3198015976";
  if (!url || !key) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: fac, error: ef } = await supabase
    .from("facturas")
    .select("id, empresa_id")
    .eq("id", facturaId)
    .maybeSingle();
  if (ef || !fac) throw new Error(`Factura no encontrada: ${facturaId}`);

  const empresaId = fac.empresa_id as string;

  const { data: cfg, error: ec } = await supabase
    .from("empresa_sifen_config")
    .select("ambiente, activo, certificado_path, certificado_password_encrypted")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (ec || !cfg || String(cfg.ambiente) !== "test" || !cfg.activo) {
    throw new Error("SIFEN TEST activo requerido");
  }

  const certPath = String(cfg.certificado_path ?? "").trim();
  const p12Dl = await downloadSifenCertificadoObject(supabase, certPath);
  if (!p12Dl.ok) throw new Error(p12Dl.message);
  const p12Password = resolveP12PasswordForScripts(String(cfg.certificado_password_encrypted ?? ""));

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

  const material = extractKeyAndCertFromP12(p12Dl.data, p12Password);
  const xmlFirmado = signSifenDocumentoXml(xmlSinFirma, material, {
    ambiente: "test",
    csc: SIFEN_TEST_CSC_GENERICO,
  });
  const cdc = /\bId="(\d{44})"/.exec(xmlFirmado)?.[1] ?? null;

  const resp = await recibirDeSifenTestSync({
    xmlFirmadoRde: xmlFirmado,
    empresaConfig: {
      ambiente: "test",
      certificadoP12: p12Dl.data,
      certificadoPassword: p12Password,
    },
  });

  const out = {
    factura_id: facturaId,
    cdc_generado: cdc,
    httpStatus: resp.httpStatus,
    soapFault: resp.soapFault,
    faultString: resp.faultString,
    rProtDe: {
      Id: resp.idCdc,
      dFecProc: resp.dFecProc,
      dEstRes: resp.dEstRes,
      dProtAut: resp.dProtAut,
      gResProc: resp.gResProc,
    },
  };

  console.log(JSON.stringify(out, null, 2));
  if (resp.gResProc.length === 0 && !resp.soapFault) {
    console.error("\n--- cuerpo SOAP (recortado) ---\n", resp.cuerpoSoapCrudo.slice(0, 8000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
