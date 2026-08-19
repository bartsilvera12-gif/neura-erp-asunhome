/**
 * Carga masiva de productos al schema ferreteriarepublica.
 *
 * Fase 1: cleanup (DELETE) de productos heredados de Caacupe que estan en
 *         ferreteriarepublica. NO TOCA el schema reservacaacupe.
 * Fase 2: import en batches de 500 desde scripts/_tmp/productos-parsed.json.
 *
 * Ejecucion:
 *   SUPABASE_DB_URL=... node scripts/import-productos-ferreteria.js
 */
const fs = require('fs');
const path = require('path');
const pg = require('pg');

const SCHEMA = 'ferreteriarepublica';
const EMPRESA_ID = '75f4194a-a24a-4e9b-830e-4506f2d9b2a6'; // Ferreteria Republica
const BATCH_SIZE = 500;
const JSON_PATH = path.join(__dirname, '_tmp', 'productos-parsed.json');

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error('Falta SUPABASE_DB_URL');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    // ============ FASE 1: CLEANUP ============
    console.log('=== FASE 1: CLEANUP ===');
    console.log(`Schema afectado: ${SCHEMA} (UNICO).`);

    await client.query('BEGIN');
    const tablas = ['receta_items', 'recetas', 'producto_categorias', 'productos', 'categorias_productos'];
    for (const t of tablas) {
      try {
        const r = await client.query(`DELETE FROM ${SCHEMA}.${t}`);
        console.log(`  DELETE ${SCHEMA}.${t}: ${r.rowCount} filas`);
      } catch (e) {
        console.log(`  SKIP ${SCHEMA}.${t}: ${e.message.split('\n')[0]}`);
      }
    }
    await client.query('COMMIT');
    console.log('Cleanup OK.\n');

    // ============ FASE 2: IMPORT ============
    console.log('=== FASE 2: IMPORT ===');
    const productos = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
    console.log(`Cargando ${productos.length} productos en batches de ${BATCH_SIZE}.`);

    const cols = [
      'empresa_id', 'nombre', 'sku', 'costo_promedio', 'precio_venta',
      'stock_actual', 'stock_minimo', 'unidad_medida', 'metodo_valuacion',
      'es_vendible', 'es_insumo', 'controla_stock', 'valorizado',
    ];

    let inserted = 0;
    let failed = 0;
    const errores = [];

    for (let i = 0; i < productos.length; i += BATCH_SIZE) {
      const batch = productos.slice(i, i + BATCH_SIZE);
      const placeholders = [];
      const values = [];
      let idx = 1;
      for (const p of batch) {
        const row = [
          EMPRESA_ID,
          p.nombre,
          p.sku,
          p.costo_promedio,
          p.precio_venta,
          p.stock_actual,
          0, // stock_minimo
          p.unidad_medida,
          'CPP',
          true,  // es_vendible
          false, // es_insumo
          true,  // controla_stock
          true,  // valorizado
        ];
        placeholders.push(
          '(' + cols.map((_, j) => `$${idx + j}`).join(', ') + ')'
        );
        idx += row.length;
        values.push(...row);
      }
      const sql = `INSERT INTO ${SCHEMA}.productos (${cols.join(', ')}) VALUES ${placeholders.join(', ')}`;

      try {
        await client.query('BEGIN');
        const r = await client.query(sql, values);
        await client.query('COMMIT');
        inserted += r.rowCount;
        process.stdout.write(`  Batch ${i / BATCH_SIZE + 1}: ${r.rowCount} OK | total: ${inserted}\r`);
      } catch (e) {
        await client.query('ROLLBACK');
        failed += batch.length;
        errores.push({ batch: i / BATCH_SIZE + 1, error: e.message.split('\n')[0] });
        console.log(`\n  Batch ${i / BATCH_SIZE + 1} FAIL: ${e.message.split('\n')[0]}`);
      }
    }

    console.log(`\n\n=== RESULTADO ===`);
    console.log(`Insertados: ${inserted}`);
    console.log(`Fallidos:   ${failed}`);
    if (errores.length) {
      console.log('Errores (primeros 5):');
      errores.slice(0, 5).forEach(e => console.log(`  Batch ${e.batch}: ${e.error}`));
    }

    // Verificacion final
    const cnt = await client.query(`SELECT COUNT(*) FROM ${SCHEMA}.productos WHERE empresa_id=$1`, [EMPRESA_ID]);
    console.log(`\nProductos en ferreteriarepublica.productos para empresa Ferreteria Republica: ${cnt.rows[0].count}`);
  } finally {
    await client.end();
  }
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
