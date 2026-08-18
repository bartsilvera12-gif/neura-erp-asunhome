/**
 * Diagnóstico: consulta-lote TEST por dProtConsLote (respuesta SOAP completa).
 * Uso: npx tsx scripts/diagnostico-consulta-lote-protocolo.ts <dProtConsLote>
 * Requiere: .env.local (Supabase, SIFEN_SECRETS_KEY alineada o E2E_CERT_PASSWORD_PLAIN), fila con ese protocolo.
 */
import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolveP12PasswordForScripts } from "../src/lib/sifen/resolve-p12-password-for-scripts";
import { consultarLoteSifenTest } from "../src/lib/sifen/consulta-lote-sifen-test";
import { downloadSifenCertificadoObject } from "../src/lib/sifen/sifen-certificados-storage";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  const prot = process.argv[2]?.trim();
  if (!prot || !/^[0-9]+$/.test(prot)) {
    console.error("Uso: npx tsx scripts/diagnostico-consulta-lote-protocolo.ts <dProtConsLote>");
    process.exit(1);
  }
  if (!url || !key) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: feRow, error: errFe } = await supabase
    .from("factura_electronica")
    .select("id, factura_id, empresa_id, estado_sifen, cdc, sifen_d_prot_cons_lote")
    .eq("sifen_d_prot_cons_lote", prot)
    .limit(1)
    .maybeSingle();

  if (errFe) {
    console.error("Supabase:", errFe.message);
    process.exit(1);
  }
  if (!feRow) {
    console.error(`No hay factura_electronica con sifen_d_prot_cons_lote=${prot}`);
    process.exit(1);
  }

  const empresaId = String(feRow.empresa_id);

  const { data: cfg, error: errCfg } = await supabase
    .from("empresa_sifen_config")
    .select("ambiente, activo, certificado_path, certificado_password_encrypted")
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (errCfg || !cfg || String(cfg.ambiente) !== "test" || !cfg.activo) {
    console.error("Config SIFEN TEST inválida o inactiva:", errCfg?.message ?? "");
    process.exit(1);
  }

  const certPath = String(cfg.certificado_path ?? "").trim();
  const p12Dl = await downloadSifenCertificadoObject(supabase, certPath);
  if (!p12Dl.ok) {
    console.error("P12:", p12Dl.message);
    process.exit(1);
  }

  const p12Password = resolveP12PasswordForScripts(String(cfg.certificado_password_encrypted));

  const resp = await consultarLoteSifenTest({
    dProtConsLote: prot,
    empresaConfig: {
      ambiente: "test",
      certificadoP12: p12Dl.data,
      certificadoPassword: p12Password,
    },
    facturaElectronicaId: String(feRow.id),
  });

  const out = {
    consultadoEn: new Date().toISOString(),
    dProtConsLote: prot,
    factura_id: feRow.factura_id,
    cdc_en_bd: feRow.cdc,
    httpStatus: resp.httpStatus,
    dCodResLot: resp.dCodResLot,
    dMsgResLot: resp.dMsgResLot,
    dFecProc: resp.dFecProc,
    soapFault: resp.soapFault,
    faultString: resp.faultString,
    detalle_por_cdc: resp.detalle_por_cdc,
    cuerpoSoapCrudo: resp.cuerpoSoapCrudo,
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
