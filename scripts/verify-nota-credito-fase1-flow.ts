/**
 * Flujo mínimo dominio NC (service role + mismas funciones que API).
 * Requiere .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL
 *
 * npx tsx scripts/verify-nota-credito-fase1-flow.ts
 */
import { config } from "dotenv";
import { join } from "path";
import pg from "pg";
import { createServiceRoleClientForEmpresa } from "../src/lib/supabase/empresa-data-schema";
import { evaluateNotaCreditoCreationGate } from "../src/lib/nota-credito/evaluate-creation-gate";
import { createNotaCreditoBorrador } from "../src/lib/nota-credito/create-nota-credito";

config({ path: join(process.cwd(), ".env.local") });

function getDbUrl(): string {
  const direct = process.env.SUPABASE_DB_URL?.trim();
  if (direct) return direct;
  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const m = base?.match(/https:\/\/([^.]+)\.supabase\.co/i);
  if (!password || !m?.[1]) {
    throw new Error(
      "Falta SUPABASE_DB_URL o (SUPABASE_DB_PASSWORD + NEXT_PUBLIC_SUPABASE_URL) en .env.local"
    );
  }
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${m[1]}.supabase.co:5432/postgres`;
}

type Candidata = { factura_id: string; empresa_id: string; fq: string };

async function listarCandidatas(client: pg.Client): Promise<Candidata[]> {
  const empresas = await client.query<{ id: string; ds: string | null }>(
    `SELECT id, NULLIF(btrim(data_schema), '') AS ds FROM zentra_erp.empresas ORDER BY created_at NULLS LAST LIMIT 80`
  );
  const out: Candidata[] = [];
  for (const e of empresas.rows) {
    const fq =
      e.ds && e.ds !== "zentra_erp" && /^erp_[a-z0-9_]+$/i.test(e.ds)
        ? e.ds
        : "zentra_erp";
    const exists = await client.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`${fq}.facturas`]);
    if (!exists.rows[0]?.ok) continue;
    const q = `
      SELECT f.id::text AS factura_id, f.empresa_id::text AS empresa_id
      FROM ${fq}.facturas f
      JOIN ${fq}.factura_electronica fe
        ON fe.factura_id = f.id AND fe.empresa_id = f.empresa_id
      WHERE fe.estado_sifen = 'aprobado'
        AND COALESCE(f.estado, '') <> 'Anulado'
        AND COALESCE(f.saldo, 0) > 0
        AND f.empresa_id = $1::uuid
      LIMIT 8
    `;
    const r = await client.query<{ factura_id: string; empresa_id: string }>(q, [e.id]);
    for (const row of r.rows) {
      out.push({ ...row, fq });
    }
  }
  return out;
}

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  }

  const pgClient = new pg.Client({
    connectionString: getDbUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();

  const authUser = await pgClient.query<{ id: string }>(`SELECT id::text AS id FROM auth.users LIMIT 1`);
  const userId = authUser.rows[0]?.id;
  if (!userId) {
    console.log("SKIP: no hay usuarios en auth.users para probar inserciones con FK.");
    await pgClient.end();
    return;
  }

  const candidatas = await listarCandidatas(pgClient);
  if (candidatas.length === 0) {
    console.log("SKIP: no hay facturas con DE aprobado y saldo > 0 para evaluar el gate.");
    await pgClient.end();
    return;
  }

  let bloqueCancelacion: Candidata | null = null;
  let permiteNc: Candidata | null = null;

  for (const c of candidatas) {
    const supabase = await createServiceRoleClientForEmpresa(c.empresa_id);
    const g = await evaluateNotaCreditoCreationGate(supabase, c.empresa_id, c.factura_id);
    const bloqueoCancel = g.motivo_bloqueo?.includes("cancelar") ?? false;
    if (!g.puede_crear && bloqueoCancel && bloqueCancelacion == null) {
      bloqueCancelacion = c;
    }
    if (g.puede_crear && permiteNc == null) {
      permiteNc = c;
    }
    if (bloqueCancelacion && permiteNc) break;
  }

  if (!bloqueCancelacion) {
    console.log("AVISO: no se encontró factura en ventana de cancelación DE (gate «no NC» no verificado en datos reales).");
  } else {
    const supabase = await createServiceRoleClientForEmpresa(bloqueCancelacion.empresa_id);
    const g = await evaluateNotaCreditoCreationGate(
      supabase,
      bloqueCancelacion.empresa_id,
      bloqueCancelacion.factura_id
    );
    console.log(
      g.puede_crear === false && (g.motivo_bloqueo?.includes("cancelar") ?? false) ? "✓" : "✗",
      "Factura cancelable → no permite crear NC:",
      g.puede_crear,
      g.motivo_bloqueo?.slice(0, 120)
    );
    if (g.puede_crear || !(g.motivo_bloqueo?.includes("cancelar") ?? false)) process.exit(1);
  }

  if (!permiteNc) {
    console.log("AVISO: no se encontró factura apta para crear NC (fuera de plazo cancelación + resto de reglas).");
    await pgClient.end();
    return;
  }

  const supabase = await createServiceRoleClientForEmpresa(permiteNc.empresa_id);
  const gate = await evaluateNotaCreditoCreationGate(supabase, permiteNc.empresa_id, permiteNc.factura_id);
  console.log(gate.puede_crear ? "✓" : "✗", "Factura no cancelable (según reglas) → gate permite NC:", gate.puede_crear);
  if (!gate.puede_crear) {
    console.log("   motivo:", gate.motivo_bloqueo);
    process.exit(1);
  }

  const cre = await createNotaCreditoBorrador({
    supabase,
    empresaId: permiteNc.empresa_id,
    facturaId: permiteNc.factura_id,
    authUserId: userId,
    authEmail: "verify-script@local",
    authNombre: "verify-nota-credito-fase1-flow",
    motivo: "Verificación automatizada fase 1 (mínimo 5 caracteres).",
    observacionInterna: null,
  });

  if (!cre.ok) {
    console.log("✗ creación NC:", cre.status, cre.error);
    process.exit(1);
  }
  const ncId = cre.nota_credito_id;
  console.log("✓ creación NC borrador:", ncId);

  const fq = permiteNc.fq;
  const qNe = await pgClient.query(
    `SELECT count(*)::int AS c FROM ${fq}.nota_credito_electronica WHERE nota_credito_id = $1::uuid`,
    [ncId]
  );
  const qEv = await pgClient.query(
    `SELECT count(*)::int AS c FROM ${fq}.nota_credito_evento WHERE nota_credito_id = $1::uuid`,
    [ncId]
  );
  const ne = qNe.rows[0]?.c ?? 0;
  const ev = qEv.rows[0]?.c ?? 0;
  console.log(ne >= 1 ? "✓" : "✗", `nota_credito_electronica filas para NC: ${ne}`);
  console.log(ev >= 2 ? "✓" : "✗", `nota_credito_evento filas para NC (creación+validación): ${ev}`);
  if (ne < 1 || ev < 2) process.exit(1);

  const { error: errU } = await supabase
    .from("nota_credito")
    .update({ estado_erp: "anulada_borrador" })
    .eq("id", ncId)
    .eq("empresa_id", permiteNc.empresa_id)
    .eq("estado_erp", "borrador");
  if (errU) {
    console.log("✗ anular borrador:", errU.message);
    process.exit(1);
  }
  const { error: errE } = await supabase.from("nota_credito_evento").insert({
    empresa_id: permiteNc.empresa_id,
    nota_credito_id: ncId,
    actor_user_id: userId,
    tipo_evento: "anulacion_borrador",
    detalle_json: { motivo: "verify_script", factura_id: permiteNc.factura_id },
  });
  if (errE) {
    console.log("✗ evento anulación:", errE.message);
    process.exit(1);
  }
  console.log("✓ anulación borrador + evento auditoría");

  await pgClient.end();
  console.log("\n=== Flujo dominio NC ===\nOK");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
