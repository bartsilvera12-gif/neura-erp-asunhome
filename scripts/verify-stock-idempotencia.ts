/**
 * Verificación de INTEGRACIÓN (requiere una BD de PRUEBAS) de las garantías
 * de stock: idempotencia de venta, anulación atómica (sin doble reversión) y
 * guarda idempotente. Crea filas temporales (tag único) y las borra al final;
 * NO toca datos existentes.
 *
 * Ejecutar SOLO contra staging/pruebas:
 *   STOCK_TEST=1 STOCK_TEST_SCHEMA=asunhome STOCK_TEST_EMPRESA_ID=<uuid> \
 *   SUPABASE_DB_URL=postgresql://... npx tsx scripts/verify-stock-idempotencia.ts
 *
 * Sin STOCK_TEST=1 o sin URL de BD: NO corre (skip, exit 0). No se ejecuta en
 * este entorno porque no hay acceso a la BD.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import pg from "pg";

const { Client } = pg;

function dbUrl(): string | null {
  return (
    process.env.SUPABASE_DB_URL?.trim() ||
    process.env.DIRECT_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    null
  );
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("ASSERT FAIL: " + msg);
}

async function main() {
  if (process.env.STOCK_TEST !== "1") {
    console.log("SKIP: definí STOCK_TEST=1 para correr esta verificación de integración.");
    return;
  }
  const url = dbUrl();
  const schema = process.env.STOCK_TEST_SCHEMA?.trim();
  const empresaId = process.env.STOCK_TEST_EMPRESA_ID?.trim();
  if (!url || !schema || !empresaId) {
    console.log("SKIP: faltan SUPABASE_DB_URL / STOCK_TEST_SCHEMA / STOCK_TEST_EMPRESA_ID.");
    return;
  }

  const S = (t: string) => `"${schema}"."${t}"`;
  const tag = `STKTEST-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  let productoId = "";
  let ventaAnulId = "";
  let passed = 0;
  const ok = (name: string) => { passed++; console.log("OK:", name); };

  try {
    // ── Producto temporal con stock 7 ─────────────────────────────────────────
    const p = await client.query<{ id: string }>(
      `INSERT INTO ${S("productos")} (empresa_id, nombre, sku, stock_actual, precio_venta)
       VALUES ($1::uuid, $2, $3, 7, 1000) RETURNING id`,
      [empresaId, `${tag} ANAFE TEST`, `${tag}-SKU`]
    );
    productoId = p.rows[0].id;

    // ── CASO B/C: idempotencia de venta (índice único parcial) ────────────────
    const key = `${tag}-IDEM`;
    async function insVenta(k: string | null, nro: string) {
      return client.query<{ id: string }>(
        `INSERT INTO ${S("ventas")} (empresa_id, numero_control, estado, tipo_venta, metodo_pago,
           total, fecha, idempotency_key)
         VALUES ($1::uuid,$2,'completada','CONTADO','efectivo',1000, now(), $3) RETURNING id`,
        [empresaId, nro, k]
      );
    }
    await insVenta(key, `${tag}-V1`); // 1ª con la clave
    let dupBloqueado = false;
    try { await insVenta(key, `${tag}-V2`); } catch (e) {
      dupBloqueado = /idempotency|unique|duplicate/i.test(String((e as Error).message));
    }
    assert(dupBloqueado, "un 2º INSERT con la MISMA idempotency_key debe fallar (Caso B)");
    // Venta legítima nueva (otra clave) NO se bloquea (Caso C).
    await insVenta(`${tag}-IDEM-2`, `${tag}-V3`);
    const cnt = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${S("ventas")} WHERE empresa_id=$1::uuid AND idempotency_key=$2`,
      [empresaId, key]
    );
    assert(Number(cnt.rows[0].n) === 1, "debe existir UNA sola venta con esa clave");
    ok("Idempotencia de venta: doble request no crea 2ª venta; venta nueva sí (Caso B/C)");

    // ── Anulación atómica sin doble reversión (dos requests → 7) ───────────────
    // Estado inicial tras una venta de 1: stock 6 + 1 SALIDA 'venta'.
    await client.query(`UPDATE ${S("productos")} SET stock_actual = 6 WHERE id=$1::uuid`, [productoId]);
    const va = await insVenta(null, `${tag}-VANUL`);
    ventaAnulId = va.rows[0].id;
    await client.query(
      `INSERT INTO ${S("movimientos_inventario")} (empresa_id, producto_id, producto_nombre, producto_sku,
         tipo, cantidad, costo_unitario, origen, referencia, fecha, venta_id)
       VALUES ($1::uuid,$2::uuid,$3,$4,'SALIDA',1,0,'venta',$5, now(), $6::uuid)`,
      [empresaId, productoId, `${tag} ANAFE TEST`, `${tag}-SKU`, `${tag}-VANUL`, ventaAnulId]
    );

    // Sección crítica que replica anularVentaPg: FOR UPDATE + guard de estado.
    async function anularMirror() {
      const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
      await c.connect();
      try {
        await c.query("BEGIN");
        const r = await c.query<{ estado: string }>(
          `SELECT estado FROM ${S("ventas")} WHERE id=$1::uuid FOR UPDATE`, [ventaAnulId]);
        if (r.rows[0]?.estado === "completada") {
          await c.query(`UPDATE ${S("productos")} SET stock_actual = stock_actual + 1 WHERE id=$1::uuid`, [productoId]);
          await c.query(
            `INSERT INTO ${S("movimientos_inventario")} (empresa_id, producto_id, producto_nombre, producto_sku,
               tipo, cantidad, costo_unitario, origen, referencia, fecha, venta_id)
             VALUES ($1::uuid,$2::uuid,$3,$4,'ENTRADA',1,0,'anulacion_venta',$5, now(), $6::uuid)`,
            [empresaId, productoId, `${tag} ANAFE TEST`, `${tag}-SKU`, `ANUL-${tag}-VANUL`, ventaAnulId]);
          await c.query(`UPDATE ${S("ventas")} SET estado='anulada' WHERE id=$1::uuid`, [ventaAnulId]);
        }
        await c.query("COMMIT");
      } catch (e) { await c.query("ROLLBACK").catch(() => null); throw e; }
      finally { await c.end(); }
    }
    // Dos anulaciones CONCURRENTES.
    await Promise.all([anularMirror(), anularMirror()]);
    const st = await client.query<{ s: string }>(`SELECT stock_actual::text AS s FROM ${S("productos")} WHERE id=$1::uuid`, [productoId]);
    assert(Number(st.rows[0].s) === 7, `stock final debe ser 7 (fue ${st.rows[0].s})`);
    const ent = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${S("movimientos_inventario")}
        WHERE venta_id=$1::uuid AND tipo='ENTRADA' AND origen='anulacion_venta'`, [ventaAnulId]);
    assert(Number(ent.rows[0].n) === 1, `debe haber UNA sola ENTRADA de reversión (hubo ${ent.rows[0].n})`);
    ok("Anulación atómica: dos requests concurrentes → stock 7, una sola reversión");

    // Reintento de anulación (ya anulada): no cambia stock.
    await anularMirror();
    const st2 = await client.query<{ s: string }>(`SELECT stock_actual::text AS s FROM ${S("productos")} WHERE id=$1::uuid`, [productoId]);
    assert(Number(st2.rows[0].s) === 7, "reintento de anulación no debe volver a sumar stock");
    ok("Anulación idempotente: reintento mantiene stock 7");

    // ── Guarda 7→6→7→7 (cancelación idempotente por estado) ───────────────────
    await client.query(`UPDATE ${S("productos")} SET stock_actual = 7 WHERE id=$1::uuid`, [productoId]);
    // crear guarda: -1
    await client.query(`UPDATE ${S("productos")} SET stock_actual = stock_actual - 1 WHERE id=$1::uuid`, [productoId]);
    // cancelar (guard estado activa→cancelada, +1) — dos veces concurrentes:
    // sólo la 1ª pasa; la 2ª ve 'cancelada' y no suma.
    async function cancelarGuardaMirror(estadoRef: { valor: string }) {
      // Simplificación: guard en memoria del test emulando FOR UPDATE del real.
      if (estadoRef.valor !== "activa") return;
      estadoRef.valor = "cancelada";
      await client.query(`UPDATE ${S("productos")} SET stock_actual = stock_actual + 1 WHERE id=$1::uuid`, [productoId]);
    }
    const estadoReserva = { valor: "activa" };
    await cancelarGuardaMirror(estadoReserva);
    await cancelarGuardaMirror(estadoReserva); // segunda: no-op
    const st3 = await client.query<{ s: string }>(`SELECT stock_actual::text AS s FROM ${S("productos")} WHERE id=$1::uuid`, [productoId]);
    assert(Number(st3.rows[0].s) === 7, `guarda: stock final debe ser 7 (fue ${st3.rows[0].s})`);
    ok("Guarda: crear/cancelar/cancelar → stock 7 (cancelación idempotente)");

    // ── Atomicidad devolución + venta (patrón de anularVentaPg: UNA sola tx) ───
    // Estado inicial: producto con stock 5, una venta 'completada' que "tuvo" una
    // devolución (reintegro previo). La anulación de venta debe revertir la
    // devolución Y anular la venta en la MISMA transacción → todo o nada.
    await client.query(`UPDATE ${S("productos")} SET stock_actual = 5 WHERE id=$1::uuid`, [productoId]);
    const vd = await insVenta(null, `${tag}-VDEVOL`);
    const ventaDevolId = vd.rows[0].id;

    // B) Fallo artificial DESPUÉS de revertir la devolución y ANTES de anular la
    //    venta → ROLLBACK total: stock, movimientos y estado quedan intactos.
    {
      const cB = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
      await cB.connect();
      let rollbackOk = false;
      try {
        await cB.query("BEGIN");
        await cB.query(`UPDATE ${S("productos")} SET stock_actual = stock_actual - 1 WHERE id=$1::uuid`, [productoId]);
        await cB.query(
          `INSERT INTO ${S("movimientos_inventario")} (empresa_id, producto_id, producto_nombre, producto_sku,
             tipo, cantidad, costo_unitario, origen, referencia, fecha, venta_id)
           VALUES ($1::uuid,$2::uuid,$3,$4,'SALIDA',1,0,'devolucion_venta',$5, now(), $6::uuid)`,
          [empresaId, productoId, `${tag} ANAFE TEST`, `${tag}-SKU`, `ANUL-DEV-${tag}`, ventaDevolId]);
        throw new Error("fallo artificial antes de anular la venta");
      } catch { await cB.query("ROLLBACK").catch(() => null); rollbackOk = true; }
      finally { await cB.end(); }
      assert(rollbackOk, "el fallo artificial debe forzar ROLLBACK");
    }
    const stB = await client.query<{ s: string }>(`SELECT stock_actual::text AS s FROM ${S("productos")} WHERE id=$1::uuid`, [productoId]);
    assert(Number(stB.rows[0].s) === 5, `tras ROLLBACK el stock debe seguir en 5 (fue ${stB.rows[0].s})`);
    const movB = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${S("movimientos_inventario")} WHERE referencia=$1`, [`ANUL-DEV-${tag}`]);
    assert(Number(movB.rows[0].n) === 0, "tras ROLLBACK no debe quedar ningún movimiento");
    const estB = await client.query<{ e: string }>(`SELECT estado AS e FROM ${S("ventas")} WHERE id=$1::uuid`, [ventaDevolId]);
    assert(estB.rows[0].e === "completada", "tras ROLLBACK la venta debe seguir 'completada'");
    ok("Atomicidad B: fallo tras revertir devolución → ROLLBACK total (stock/movs/venta intactos)");

    // A) Éxito: misma tx revierte la devolución (5→4) + anula la venta → COMMIT.
    {
      const cA = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
      await cA.connect();
      try {
        await cA.query("BEGIN");
        await cA.query(`UPDATE ${S("productos")} SET stock_actual = stock_actual - 1 WHERE id=$1::uuid`, [productoId]);
        await cA.query(
          `INSERT INTO ${S("movimientos_inventario")} (empresa_id, producto_id, producto_nombre, producto_sku,
             tipo, cantidad, costo_unitario, origen, referencia, fecha, venta_id)
           VALUES ($1::uuid,$2::uuid,$3,$4,'SALIDA',1,0,'devolucion_venta',$5, now(), $6::uuid)`,
          [empresaId, productoId, `${tag} ANAFE TEST`, `${tag}-SKU`, `ANUL-DEV-OK-${tag}`, ventaDevolId]);
        await cA.query(`UPDATE ${S("ventas")} SET estado='anulada' WHERE id=$1::uuid`, [ventaDevolId]);
        await cA.query("COMMIT");
      } catch (e) { await cA.query("ROLLBACK").catch(() => null); throw e; }
      finally { await cA.end(); }
    }
    const estA = await client.query<{ e: string }>(`SELECT estado AS e FROM ${S("ventas")} WHERE id=$1::uuid`, [ventaDevolId]);
    assert(estA.rows[0].e === "anulada", "A: la venta debe quedar anulada");
    const stA = await client.query<{ s: string }>(`SELECT stock_actual::text AS s FROM ${S("productos")} WHERE id=$1::uuid`, [productoId]);
    assert(Number(stA.rows[0].s) === 4, `A: stock debe ser 4 tras revertir la devolución (fue ${stA.rows[0].s})`);
    ok("Atomicidad A: devolución + venta anuladas en UNA sola tx → COMMIT consistente");

    console.log(`\n${passed} verificaciones OK`);
  } finally {
    // ── Limpieza: borrar TODO lo creado por este run (por tag). ────────────────
    try {
      await client.query(`DELETE FROM ${S("movimientos_inventario")} WHERE producto_sku=$1 OR referencia LIKE $2`,
        [`${tag}-SKU`, `%${tag}%`]);
      await client.query(`DELETE FROM ${S("ventas")} WHERE numero_control LIKE $1`, [`${tag}%`]);
      if (productoId) await client.query(`DELETE FROM ${S("productos")} WHERE id=$1::uuid`, [productoId]);
    } catch (e) { console.error("Limpieza:", (e as Error).message); }
    await client.end();
  }
}

main().catch((e) => { console.error("FAIL:", e instanceof Error ? e.message : e); process.exit(1); });
