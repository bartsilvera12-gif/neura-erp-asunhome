/**
 * Crea empresa + provision, verifica 0 FK→public, inserta filas de negocio en schema tenant.
 * npx tsx scripts/validate-e2e-tenant-inserts.ts
 */
import { config } from "dotenv";
import path from "node:path";
import pg from "pg";

config({ path: path.resolve(process.cwd(), ".env.local") });

const url =
  process.env.DIRECT_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  process.env.SUPABASE_DB_URL?.trim();

async function main() {
  if (!url) process.exit(2);
  const c = new pg.Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await c.connect();
  const label = `E2E_FK_${Date.now()}`;
  try {
    const ins = await c.query<{ id: string }>(
      `insert into zentra_erp.empresas (nombre_empresa, estado)
       values ($1, 'activo') returning id::text`,
      [label]
    );
    const empresaId = ins.rows[0]!.id;
    const prov = await c.query(
      `select zentra_erp.neura_provision_empresa_data_schema($1::uuid, $2) as j`,
      [empresaId, "e2evalidate"]
    );
    const j = prov.rows[0] as { j: { schema?: string; ok?: boolean } };
    const schema = j.j?.schema;
    if (!schema) throw new Error("sin schema");

    const fkPub = await c.query(
      `select count(*)::int as n
       from pg_constraint con
       join pg_class cl on cl.oid = con.conrelid
       join pg_namespace n on n.oid = cl.relnamespace
       join pg_class cr on cr.oid = con.confrelid
       join pg_namespace nr on nr.oid = cr.relnamespace
       where con.contype = 'f' and n.nspname = $1 and nr.nspname = 'public'`,
      [schema]
    );
    console.log("empresa_id", empresaId, "schema", schema, "fk_a_public", fkPub.rows[0]?.n);

    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

    const cli = await c.query(
      `insert into ${q(schema)}.clientes (empresa_id, nombre, estado)
       values ($1::uuid, 'Cliente E2E', 'activo') returning id::text`,
      [empresaId]
    );
    const clienteId = (cli.rows[0] as { id: string }).id;

    const prod = await c.query(
      `insert into ${q(schema)}.productos (
         empresa_id, nombre, sku, costo_promedio, precio_venta, stock_actual, stock_minimo,
         unidad_medida, metodo_valuacion, activo
       ) values (
         $1::uuid, 'Prod E2E', 'SKU-E2E-1', 1, 2, 0, 0, 'Unidad', 'FIFO', true
       ) returning id::text`,
      [empresaId]
    );
    const productoId = (prod.rows[0] as { id: string }).id;

    const crm = await c.query(
      `insert into ${q(schema)}.crm_prospectos (
         empresa_id, numero_control, empresa, contacto, email, telefono, servicio,
         valor_estimado, etapa, cliente_creado, fecha_creacion, fecha_actualizacion
       ) values (
         $1::uuid, 'CRM-E2E-000001', 'Emp E2E', 'Contacto', null, null, 'Svc',
         0, 'LEAD', false, now(), now()
       ) returning id::text`,
      [empresaId]
    );
    const prospectoId = (crm.rows[0] as { id: string }).id;

    const zchk = await c.query(
      `select
         (select count(*)::int from zentra_erp.clientes where id = $1::uuid) as z_clientes,
         (select count(*)::int from zentra_erp.productos where id = $2::uuid) as z_prod,
         (select count(*)::int from zentra_erp.crm_prospectos where id = $3::uuid) as z_crm`,
      [clienteId, productoId, prospectoId]
    );

    console.log("inserts tenant OK", { clienteId, productoId, prospectoId });
    console.log("mismos ids en zentra_erp (deben ser 0):", zchk.rows[0]);

    // Teardown explícito: evita "cache lookup failed for constraint" si DROP SCHEMA
    // ocurre en BEFORE DELETE mientras el motor aún resuelve FKs hacia empresas.
    await c.query(`select zentra_erp.neura_teardown_provision_failed($1::uuid)`, [empresaId]);
    await c.query(`delete from zentra_erp.empresas where id = $1::uuid`, [empresaId]);
    console.log("cleanup OK");
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
