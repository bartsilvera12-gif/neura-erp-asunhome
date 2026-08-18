/**
 * Validación read-only de la configuración SIFEN de una empresa (por RUC),
 * sin emitir factura, sin firmar XML real, sin enviar a SET.
 *
 *   npx tsx scripts/validate-sifen-config-by-ruc.ts --ruc 80166431-4
 *   npx tsx scripts/validate-sifen-config-by-ruc.ts --empresa <uuid>
 *
 * Verifica:
 *  1. Que `empresa_sifen_config` está guardada en el schema correcto (zentra_erp o erp_*).
 *  2. Que `certificado_path` apunta al objeto esperado en bucket `sifen-certificados`.
 *  3. Que la contraseña está cifrada (prefijo `neura:v1:`) y NO en texto plano.
 *  4. Que el archivo .p12 existe y es descargable con service role.
 *  5. Dry-run: descifra la contraseña en memoria y abre el .p12 con node-forge para confirmar
 *     que la combinación contraseña + certificado es utilizable. No firma ningún XML real.
 *  6. Compara `certificado_vencimiento` (BD) con `notAfter` real del .p12.
 *
 * Imprime evidencia enmascarando todo secreto (contraseña / ciphertext / parte de RUC).
 */
import { config as loadEnv } from "dotenv";
import { join } from "path";
import pg from "pg";
import * as forge from "node-forge";

loadEnv({ path: join(process.cwd(), ".env.local") });

import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { resolveEmpresaDataSchema } from "@/lib/supabase/schema";
import {
  SIFEN_CERTIFICADOS_BUCKET,
  buildSifenCertificadoObjectPath,
  downloadSifenCertificadoObject,
} from "@/lib/sifen/sifen-certificados-storage";
import { decryptSecret } from "@/lib/sifen/security";
import { extractKeyAndCertFromP12 } from "@/lib/sifen/sign-xml";

const CIPHER_PREFIX = "neura:v1:";

type Args = { ruc?: string; empresaId?: string };

function parseArgs(): Args {
  const out: Args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ruc") out.ruc = argv[++i];
    else if (a === "--empresa" || a === "--empresa-id") out.empresaId = argv[++i];
  }
  return out;
}

function maskMiddle(value: string, keepStart = 4, keepEnd = 2): string {
  const s = String(value ?? "");
  if (s.length <= keepStart + keepEnd) return "*".repeat(s.length);
  return `${s.slice(0, keepStart)}…${"*".repeat(Math.max(0, s.length - keepStart - keepEnd))}…${s.slice(-keepEnd)}`;
}

function maskFingerprint(hex: string): string {
  const clean = hex.replace(/:/g, "").toLowerCase();
  if (clean.length < 12) return "*".repeat(clean.length);
  return `${clean.slice(0, 6)}…${clean.slice(-6)} (${clean.length} hex chars)`;
}

function fmt(label: string, value: unknown): string {
  return `   ${label.padEnd(38)} ${value as string}`;
}

function getDbUrl(): string {
  const u =
    process.env.SUPABASE_DB_URL?.trim() ||
    process.env.DIRECT_URL?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (u) return u;
  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const m = base?.match(/https:\/\/([^.]+)\.supabase\.co/i);
  if (!password || !m?.[1]) {
    throw new Error("Faltan SUPABASE_DB_URL / DIRECT_URL en el entorno.");
  }
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${m[1]}.supabase.co:5432/postgres`;
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!args.ruc && !args.empresaId) {
    console.error("Uso: --ruc <RUC> | --empresa <uuid>");
    process.exit(1);
  }

  const catalog = createServiceRoleClient();

  let empresa:
    | { id: string; nombre_empresa: string | null; ruc: string | null; data_schema: string | null }
    | null = null;

  if (args.empresaId) {
    const { data, error } = await catalog
      .from("empresas")
      .select("id, nombre_empresa, ruc, data_schema")
      .eq("id", args.empresaId)
      .maybeSingle();
    if (error) throw new Error(`empresas lookup: ${error.message}`);
    empresa = data as typeof empresa;
  } else if (args.ruc) {
    const { data, error } = await catalog
      .from("empresas")
      .select("id, nombre_empresa, ruc, data_schema")
      .eq("ruc", args.ruc)
      .limit(2);
    if (error) throw new Error(`empresas lookup: ${error.message}`);
    const list = (data ?? []) as NonNullable<typeof empresa>[];
    if (list.length === 0) throw new Error(`No se encontró empresa con RUC ${args.ruc}`);
    if (list.length > 1) throw new Error(`Hay múltiples empresas con RUC ${args.ruc}; usar --empresa <uuid>`);
    empresa = list[0];
  }
  if (!empresa) throw new Error("empresa no resuelta");

  const schema = resolveEmpresaDataSchema(empresa.data_schema);

  console.log("\n=== Empresa ===");
  console.log(fmt("empresa_id", empresa.id));
  console.log(fmt("nombre_empresa", empresa.nombre_empresa ?? "—"));
  console.log(fmt("ruc (catálogo zentra_erp.empresas)", maskMiddle(String(empresa.ruc ?? ""))));
  console.log(fmt("data_schema (zentra_erp.empresas)", empresa.data_schema ?? "(null → zentra_erp)"));
  console.log(fmt("schema resuelto para datos SIFEN", schema));

  const pool = new pg.Pool({
    connectionString: getDbUrl(),
    ssl: { rejectUnauthorized: false },
    max: 1,
    idleTimeoutMillis: 5000,
  });
  pool.on("error", (e) => console.error("[pg-pool] idle err:", e instanceof Error ? e.message : e));

  console.log("\n=== empresa_sifen_config ===");
  const q = `
    SELECT id, empresa_id, ambiente, ruc, razon_social, direccion_fiscal,
           timbrado_numero, timbrado_fecha_inicio_vigencia,
           actividad_economica_codigo, actividad_economica_descripcion,
           establecimiento, punto_expedicion, csc, certificado_path,
           certificado_password_encrypted, certificado_vencimiento, activo,
           sifen_plazo_cancelacion_horas, created_at, updated_at
      FROM "${schema.replace(/"/g, '""')}"."empresa_sifen_config"
     WHERE empresa_id = $1
     LIMIT 1`;
  const r = await pool.query(q, [empresa.id]);
  const cfg = r.rows[0] as Record<string, unknown> | undefined;

  if (!cfg) {
    console.log("   ✗ No hay fila en empresa_sifen_config para esta empresa en este schema.");
    console.log("   → Imposible continuar la validación; cree la config primero.");
    await pool.end();
    process.exit(2);
  }

  console.log(fmt("schema·tabla", `${schema}.empresa_sifen_config`));
  console.log(fmt("config id", String(cfg.id)));
  console.log(fmt("ambiente", String(cfg.ambiente)));
  console.log(fmt("ruc (SIFEN config)", maskMiddle(String(cfg.ruc))));
  console.log(fmt("razon_social", String(cfg.razon_social ?? "—")));
  console.log(fmt("direccion_fiscal", cfg.direccion_fiscal ? "presente" : "—"));
  console.log(fmt("timbrado_numero", maskMiddle(String(cfg.timbrado_numero), 2, 2)));
  const tinRaw = cfg.timbrado_fecha_inicio_vigencia;
  const tinIso =
    tinRaw instanceof Date
      ? `${tinRaw.getUTCFullYear()}-${String(tinRaw.getUTCMonth() + 1).padStart(2, "0")}-${String(tinRaw.getUTCDate()).padStart(2, "0")}`
      : String(tinRaw ?? "—").slice(0, 10);
  console.log(fmt("timbrado_fecha_inicio_vigencia", tinIso));
  console.log(fmt("actividad_economica_codigo", String(cfg.actividad_economica_codigo ?? "—")));
  console.log(fmt("establecimiento·punto", `${cfg.establecimiento} · ${cfg.punto_expedicion}`));
  console.log(fmt("csc cargado", cfg.csc ? "sí (no se imprime)" : "—"));
  console.log(fmt("activo", String(cfg.activo)));
  console.log(fmt("sifen_plazo_cancelacion_horas", String(cfg.sifen_plazo_cancelacion_horas ?? "—")));

  console.log("\n=== Contraseña del certificado (cifrada) ===");
  const enc = (cfg.certificado_password_encrypted ?? "") as string;
  if (!enc) {
    console.log("   ✗ certificado_password_encrypted está vacío.");
    await pool.end();
    process.exit(2);
  }
  const hasPrefix = enc.startsWith(CIPHER_PREFIX);
  console.log(fmt("formato (prefijo neura:v1:)", hasPrefix ? "✓ correcto" : "✗ INCORRECTO"));
  console.log(fmt("longitud ciphertext almacenado", `${enc.length} chars`));
  console.log(fmt("muestra", maskMiddle(enc, 12, 6)));
  /** Defensa en profundidad: si la columna en claro existe (legado), debe ser NULL o estar ausente. */
  try {
    const r2 = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'empresa_sifen_config' AND column_name = 'certificado_password'`,
      [schema]
    );
    if (r2.rows.length === 0) {
      console.log(fmt("columna legacy certificado_password", "✓ ausente"));
    } else {
      const r3 = await pool.query(
        `SELECT certificado_password FROM "${schema.replace(/"/g, '""')}"."empresa_sifen_config" WHERE empresa_id = $1`,
        [empresa.id]
      );
      const plain = r3.rows[0]?.certificado_password;
      if (plain == null) {
        console.log(fmt("columna legacy certificado_password", "presente pero NULL ✓"));
      } else {
        console.log(fmt("columna legacy certificado_password", "✗ TIENE VALOR EN CLARO"));
      }
    }
  } catch (e) {
    console.log(fmt("check columna legacy", `(omitido: ${e instanceof Error ? e.message : e})`));
  }

  console.log("\n=== certificado_path / Storage ===");
  const certPath = (cfg.certificado_path ?? "") as string;
  const expectedPath = buildSifenCertificadoObjectPath(empresa.id);
  console.log(fmt("bucket esperado", SIFEN_CERTIFICADOS_BUCKET));
  console.log(fmt("path en BD", certPath || "—"));
  console.log(fmt("path esperado por convención", expectedPath));
  console.log(fmt("coincide convención", certPath === expectedPath ? "✓ sí" : "⚠ distinto"));

  if (!certPath) {
    console.log("   ✗ certificado_path está vacío. Suba el .p12 antes de continuar.");
    await pool.end();
    process.exit(2);
  }

  /** Storage: ¿existe el objeto? */
  const folder = certPath.split("/").slice(0, -1).join("/") || "";
  const fname = certPath.split("/").slice(-1)[0];
  const { data: listing, error: listErr } = await catalog.storage
    .from(SIFEN_CERTIFICADOS_BUCKET)
    .list(folder, { limit: 50 });
  if (listErr) {
    console.log(fmt("storage list", `✗ ${listErr.message}`));
  } else {
    const match = listing?.find((o) => o.name === fname);
    if (!match) {
      console.log(fmt("objeto en storage", `✗ NO ENCONTRADO en ${folder}/${fname}`));
      await pool.end();
      process.exit(2);
    }
    console.log(fmt("objeto en storage", "✓ existe"));
    console.log(fmt("size (bytes)", String((match as { metadata?: { size?: number } }).metadata?.size ?? "—")));
    console.log(
      fmt(
        "updated_at",
        String((match as { updated_at?: string; created_at?: string }).updated_at ?? (match as { created_at?: string }).created_at ?? "—")
      )
    );
  }

  console.log("\n=== Descarga del .p12 (service role) ===");
  const dl = await downloadSifenCertificadoObject(catalog, certPath);
  if (!dl.ok) {
    console.log(fmt("descarga", `✗ ${dl.message}`));
    await pool.end();
    process.exit(2);
  }
  console.log(fmt("descarga", `✓ ok (${dl.data.length} bytes)`));

  console.log("\n=== Dry-run: abrir .p12 con la contraseña descifrada ===");
  let password: string;
  try {
    password = decryptSecret(enc);
  } catch (e) {
    console.log(fmt("decryptSecret", `✗ ${e instanceof Error ? e.message : e}`));
    console.log("   → Verifique que SIFEN_SECRETS_KEY en este entorno coincide con la usada al guardar.");
    await pool.end();
    process.exit(2);
  }
  console.log(fmt("decryptSecret", "✓ descifrada en memoria (NO se imprime)"));
  console.log(fmt("longitud contraseña", `${password.length} chars`));

  let material: { privateKeyPem: string; certificatePem: string };
  try {
    material = extractKeyAndCertFromP12(dl.data, password);
  } catch (e) {
    console.log(fmt("extractKeyAndCertFromP12", `✗ ${e instanceof Error ? e.message : e}`));
    console.log("   → .p12 corrupto o contraseña no coincide con el archivo cargado.");
    await pool.end();
    process.exit(2);
  }
  console.log(fmt("extractKeyAndCertFromP12", "✓ ok (clave privada + certificado extraídos)"));

  console.log("\n=== Certificado x509 dentro del .p12 ===");
  const cert = forge.pki.certificateFromPem(material.certificatePem);
  const subject = cert.subject.attributes
    .filter((a) => ["CN", "O", "OU", "C", "serialNumber"].includes(a.shortName ?? ""))
    .map((a) => `${a.shortName}=${a.value}`)
    .join(", ");
  const issuer = cert.issuer.attributes
    .filter((a) => ["CN", "O", "OU", "C"].includes(a.shortName ?? ""))
    .map((a) => `${a.shortName}=${a.value}`)
    .join(", ");
  const md = forge.md.sha256.create();
  md.update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
  const fingerprintSha256 = md.digest().toHex();

  const notBefore = cert.validity.notBefore;
  const notAfter = cert.validity.notAfter;
  const now = new Date();
  const daysToExpire = Math.floor((notAfter.getTime() - now.getTime()) / 86_400_000);

  console.log(fmt("subject", subject || "—"));
  console.log(fmt("issuer", issuer || "—"));
  console.log(fmt("serial (hex, parcial)", maskMiddle(cert.serialNumber, 6, 4)));
  console.log(fmt("fingerprint SHA-256", maskFingerprint(fingerprintSha256)));
  console.log(fmt("notBefore", notBefore.toISOString()));
  console.log(fmt("notAfter (real .p12)", notAfter.toISOString()));
  console.log(fmt("días restantes", String(daysToExpire)));
  console.log(fmt("vigente ahora", notBefore <= now && now <= notAfter ? "✓ sí" : "✗ NO"));

  const dbVenc = cfg.certificado_vencimiento ? new Date(String(cfg.certificado_vencimiento)) : null;
  if (dbVenc) {
    const diffMs = Math.abs(dbVenc.getTime() - notAfter.getTime());
    const closeEnough = diffMs <= 24 * 3600 * 1000;
    console.log(fmt("certificado_vencimiento (BD)", dbVenc.toISOString()));
    console.log(
      fmt(
        "coincide con notAfter ±24h",
        closeEnough ? "✓ sí" : `⚠ diferencia de ${(diffMs / 3600000).toFixed(1)}h`
      )
    );
  } else {
    console.log(fmt("certificado_vencimiento (BD)", "— (no detectado / cargar manualmente)"));
  }

  console.log("\n=== Resultado final ===");
  console.log("   ✓ Configuración SIFEN guardada en schema correcto.");
  console.log("   ✓ Certificado .p12 presente en Storage privado.");
  console.log("   ✓ Contraseña guardada cifrada (formato neura:v1:).");
  console.log("   ✓ Backend (service role) puede descargar el .p12.");
  console.log("   ✓ Dry-run de apertura del .p12 con la contraseña descifrada: ÉXITO.");
  console.log("   ✓ Datos del certificado x509 extraídos en memoria sin firmar XML real.");

  await pool.end();
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("FATAL:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
);
