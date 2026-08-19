import { createServiceRoleClientWithDbSchema } from "@/lib/supabase/empresa-data-schema";
import { convertirCantidad } from "@/lib/unidades/convert";

/** Un faltante de materia prima detectado al validar la fabricación. */
export interface FaltanteInsumoProduccion {
  producto_id: string;
  nombre: string;
  sku: string;
  unidad: string | null;
  stock_actual: number;
  requerido: number;
  faltante: number;
}

/**
 * Se lanza cuando falta materia prima y NO se autorizó fabricar sin stock
 * (`permitirSinStock` ausente/false). Lleva el detalle para que la UI muestre
 * el modal de confirmación y reintente con el flag.
 */
export class InsumoInsuficienteError extends Error {
  faltantes: FaltanteInsumoProduccion[];
  constructor(faltantes: FaltanteInsumoProduccion[]) {
    super("Materia prima insuficiente para la fabricación solicitada.");
    this.name = "InsumoInsuficienteError";
    this.faltantes = faltantes;
  }
}

export interface CrearProduccionParams {
  schema: string;
  empresaId: string;
  recetaId: string;
  cantidadFabricar: number;
  observaciones?: string | null;
  /** Si true, autoriza fabricar aunque falte materia prima (el stock de insumo puede quedar en 0). */
  permitirSinStock?: boolean;
  usuarioId?: string | null;
  usuarioNombre?: string | null;
}

/** Un insumo requerido por la fabricación, ya convertido a la unidad del insumo. */
export interface InsumoRequerido {
  producto_id: string;
  nombre: string;
  sku: string;
  unidad: string | null;
  requerido: number;
  stock_actual: number;
  costo_unitario: number;
  subcosto: number;
  faltante: number;
}

export interface ProduccionPreview {
  receta_id: string;
  producto_id: string;
  producto_nombre: string;
  cantidad_fabricar: number;
  rendimiento_cantidad: number;
  unidad_rendimiento: string | null;
  insumos: InsumoRequerido[];
  insumos_incompatibles: string[];
  costo_total: number;
  costo_unitario: number;
  hay_faltantes: boolean;
}

export interface CrearProduccionResult {
  produccion_id: string;
  producto_id: string;
  producto_nombre: string;
  cantidad_fabricada: number;
  costo_total: number;
  costo_unitario: number;
  costo_promedio_nuevo: number;
  stock_terminado_nuevo: number;
  insumos: InsumoRequerido[];
}

type RecetaInfo = {
  recetaId: string;
  productoId: string;
  productoNombre: string;
  productoSku: string;
  productoStock: number;
  productoCosto: number;
  rendimiento: number;
  unidadRendimiento: string | null;
};

type InsumoMeta = { stock: number; costo: number; nombre: string; sku: string; unidad: string | null };

/**
 * Carga receta + producto terminado + ítems + insumos y calcula los requerimientos de
 * materia prima para fabricar `cantidadFabricar` unidades. Comparte la lógica de
 * conversión de unidades con el costeo / la venta.
 */
async function cargarPreview(
  params: CrearProduccionParams
): Promise<{
  sb: ReturnType<typeof createServiceRoleClientWithDbSchema>;
  receta: RecetaInfo;
  insumoMeta: Map<string, InsumoMeta>;
  insumoNeed: Map<string, number>;
  insumosIncompatibles: string[];
}> {
  const cantidad = Number(params.cantidadFabricar);
  if (!(cantidad > 0)) {
    throw new Error("La cantidad a fabricar debe ser mayor a cero.");
  }

  const sb = createServiceRoleClientWithDbSchema(params.schema);

  // 1) Receta (activa) + producto terminado.
  const recQ = await sb
    .from("recetas")
    .select("id, producto_id, rendimiento_cantidad, rendimiento_unidad, activa")
    .eq("empresa_id", params.empresaId)
    .eq("id", params.recetaId)
    .maybeSingle();
  if (recQ.error) throw new Error(recQ.error.message);
  if (!recQ.data) throw new Error("Receta no encontrada en esta empresa.");
  const rec = recQ.data as unknown as {
    id: string;
    producto_id: string;
    rendimiento_cantidad: number | string | null;
    rendimiento_unidad: string | null;
    activa: boolean | null;
  };
  if (rec.activa === false) throw new Error("La receta está inactiva; activala antes de fabricar.");

  const prodQ = await sb
    .from("productos")
    .select("id, nombre, sku, stock_actual, costo_promedio")
    .eq("empresa_id", params.empresaId)
    .eq("id", rec.producto_id)
    .maybeSingle();
  if (prodQ.error) throw new Error(prodQ.error.message);
  if (!prodQ.data) throw new Error("El producto terminado de la receta no existe.");
  const prod = prodQ.data as unknown as {
    id: string;
    nombre: string;
    sku: string;
    stock_actual: number | string;
    costo_promedio: number | string;
  };

  const rendimiento = Number(rec.rendimiento_cantidad);
  const receta: RecetaInfo = {
    recetaId: rec.id,
    productoId: prod.id,
    productoNombre: prod.nombre,
    productoSku: prod.sku,
    productoStock: Number(prod.stock_actual),
    productoCosto: Number(prod.costo_promedio),
    rendimiento: rendimiento > 0 ? rendimiento : 1,
    unidadRendimiento: rec.rendimiento_unidad ?? null,
  };

  // 2) Ítems de receta.
  const itemsQ = await sb
    .from("receta_items")
    .select("insumo_producto_id, cantidad, unidad_medida, merma_pct")
    .eq("receta_id", receta.recetaId);
  if (itemsQ.error) throw new Error(itemsQ.error.message);
  const itemRows = (itemsQ.data ?? []) as unknown as Array<{
    insumo_producto_id: string;
    cantidad: number | string;
    unidad_medida: string | null;
    merma_pct: number | string | null;
  }>;
  if (!itemRows.length) {
    throw new Error("La receta no tiene insumos cargados; no se puede fabricar.");
  }

  // 3) Meta de insumos.
  const insumoIdsSet = new Set<string>();
  for (const it of itemRows) insumoIdsSet.add(it.insumo_producto_id);
  const insumoIds = [...insumoIdsSet];
  const insumoMeta = new Map<string, InsumoMeta>();
  const insQ = await sb
    .from("productos")
    .select("id, stock_actual, costo_promedio, nombre, sku, unidad_medida")
    .eq("empresa_id", params.empresaId)
    .in("id", insumoIds);
  if (insQ.error) throw new Error(insQ.error.message);
  const insRows = (insQ.data ?? []) as unknown as Array<{
    id: string;
    stock_actual: number | string;
    costo_promedio: number | string;
    nombre: string;
    sku: string;
    unidad_medida: string | null;
  }>;
  if (insRows.length !== insumoIds.length) {
    const found = new Set(insRows.map((r) => r.id));
    const faltan = insumoIds.filter((i) => !found.has(i));
    throw new Error(`La receta referencia insumos inexistentes en esta empresa: ${faltan.join(", ")}`);
  }
  for (const r of insRows) {
    insumoMeta.set(r.id, {
      stock: Number(r.stock_actual),
      costo: Number(r.costo_promedio),
      nombre: r.nombre,
      sku: r.sku,
      unidad: r.unidad_medida ?? null,
    });
  }

  // 4) Requerimiento por insumo, convirtiendo a la unidad del insumo.
  //    consumo = cantidadFabricar * cantidad_item_conv * (1 + merma) / rendimiento.
  const insumoNeed = new Map<string, number>();
  const insumosIncompatibles: string[] = [];
  for (const it of itemRows) {
    const meta = insumoMeta.get(it.insumo_producto_id);
    const unidadInsumo = meta?.unidad ?? null;
    const unidadItem = it.unidad_medida ?? null;
    const cantBase = Number(it.cantidad);
    const merma = Number(it.merma_pct ?? 0);
    const cantConv =
      unidadItem == null || unidadInsumo == null
        ? cantBase
        : convertirCantidad(cantBase, unidadItem, unidadInsumo);
    if (cantConv == null) {
      const nombre = meta?.nombre ?? it.insumo_producto_id;
      if (!insumosIncompatibles.includes(nombre)) insumosIncompatibles.push(nombre);
      continue;
    }
    const consumo = (cantidad * cantConv * (1 + merma)) / receta.rendimiento;
    if (!(consumo > 0)) continue;
    insumoNeed.set(
      it.insumo_producto_id,
      (insumoNeed.get(it.insumo_producto_id) ?? 0) + consumo
    );
  }
  // Redondeo para evitar ruido de coma flotante.
  for (const [k, v] of insumoNeed) insumoNeed.set(k, Math.round(v * 1e6) / 1e6);

  return { sb, receta, insumoMeta, insumoNeed, insumosIncompatibles };
}

/** Devuelve solo el preview (sin escribir nada). Para mostrar requeridos/faltantes/costo en la UI. */
export async function previewProduccion(params: CrearProduccionParams): Promise<ProduccionPreview> {
  const { receta, insumoMeta, insumoNeed, insumosIncompatibles } = await cargarPreview(params);
  const cantidad = Number(params.cantidadFabricar);

  const insumos: InsumoRequerido[] = [];
  let costoTotal = 0;
  for (const [insId, need] of insumoNeed) {
    const m = insumoMeta.get(insId)!;
    const subcosto = Math.round(need * m.costo * 1e6) / 1e6;
    costoTotal += subcosto;
    insumos.push({
      producto_id: insId,
      nombre: m.nombre,
      sku: m.sku,
      unidad: m.unidad,
      requerido: need,
      stock_actual: m.stock,
      costo_unitario: m.costo,
      subcosto,
      faltante: m.stock < need ? Math.round((need - m.stock) * 1e6) / 1e6 : 0,
    });
  }
  costoTotal = Math.round(costoTotal * 1e6) / 1e6;
  const costoUnitario = cantidad > 0 ? Math.round((costoTotal / cantidad) * 1e6) / 1e6 : 0;

  return {
    receta_id: receta.recetaId,
    producto_id: receta.productoId,
    producto_nombre: receta.productoNombre,
    cantidad_fabricar: cantidad,
    rendimiento_cantidad: receta.rendimiento,
    unidad_rendimiento: receta.unidadRendimiento,
    insumos,
    insumos_incompatibles: insumosIncompatibles,
    costo_total: costoTotal,
    costo_unitario: costoUnitario,
    hay_faltantes: insumos.some((i) => i.faltante > 0),
  };
}

/**
 * Registra una producción: descuenta materia prima (SALIDA, origen 'produccion'), aumenta el
 * stock del terminado (ENTRADA, origen 'produccion'), actualiza el costo_promedio del terminado
 * por promedio ponderado y guarda producciones + produccion_items para trazabilidad.
 *
 * Atomicidad best-effort (PostgREST no expone transacciones multi-statement): si un paso
 * post-inserción falla, se hace rollback eliminando la producción y sus movimientos/ítems.
 */
export async function crearProduccionPg(params: CrearProduccionParams): Promise<CrearProduccionResult> {
  const { sb, receta, insumoMeta, insumoNeed, insumosIncompatibles } = await cargarPreview(params);
  const cantidad = Number(params.cantidadFabricar);

  if (insumosIncompatibles.length > 0) {
    console.warn(
      "[crear-produccion-pg] receta con unidades incompatibles (no se descuentan):",
      insumosIncompatibles.join(", ")
    );
  }

  // Validar disponibilidad de materia prima.
  const faltantes: FaltanteInsumoProduccion[] = [];
  for (const [insId, need] of insumoNeed) {
    const m = insumoMeta.get(insId)!;
    if (m.stock < need) {
      faltantes.push({
        producto_id: insId,
        nombre: m.nombre,
        sku: m.sku,
        unidad: m.unidad,
        stock_actual: m.stock,
        requerido: need,
        faltante: Math.round((need - m.stock) * 1e6) / 1e6,
      });
    }
  }
  if (faltantes.length > 0 && !params.permitirSinStock) {
    throw new InsumoInsuficienteError(faltantes);
  }

  // Costo total = suma de subcostos (requerido * costo_promedio del insumo).
  let costoTotal = 0;
  const insumosDetalle: InsumoRequerido[] = [];
  for (const [insId, need] of insumoNeed) {
    const m = insumoMeta.get(insId)!;
    const subcosto = Math.round(need * m.costo * 1e6) / 1e6;
    costoTotal += subcosto;
    insumosDetalle.push({
      producto_id: insId,
      nombre: m.nombre,
      sku: m.sku,
      unidad: m.unidad,
      requerido: need,
      stock_actual: m.stock,
      costo_unitario: m.costo,
      subcosto,
      faltante: m.stock < need ? Math.round((need - m.stock) * 1e6) / 1e6 : 0,
    });
  }
  costoTotal = Math.round(costoTotal * 1e6) / 1e6;
  const costoUnitario = cantidad > 0 ? Math.round((costoTotal / cantidad) * 1e6) / 1e6 : 0;

  const fechaIso = new Date().toISOString();

  // Auditoría: si se fabricó con materia prima insuficiente, dejar constancia.
  let observacionesFinal = params.observaciones ?? null;
  if (faltantes.length > 0 && params.permitirSinStock) {
    const detalle = faltantes
      .map((f) => `${f.nombre} (stock ${f.stock_actual}, requerido ${f.requerido}, falta ${f.faltante})`)
      .join("; ");
    const nota = `Fabricación con materia prima insuficiente autorizada: ${detalle}`;
    observacionesFinal = (observacionesFinal ? `${observacionesFinal} | ${nota}` : nota).slice(0, 4000);
  }

  // 1) Insertar cabecera de producción.
  const insProd = await sb
    .from("producciones")
    .insert({
      empresa_id: params.empresaId,
      receta_id: receta.recetaId,
      producto_id: receta.productoId,
      producto_nombre: receta.productoNombre,
      cantidad_fabricada: cantidad,
      rendimiento_cantidad: receta.rendimiento,
      unidad_rendimiento: receta.unidadRendimiento,
      costo_total: costoTotal,
      costo_unitario: costoUnitario,
      fecha: fechaIso,
      usuario_id: params.usuarioId ?? null,
      usuario_nombre: params.usuarioNombre ?? null,
      observaciones: observacionesFinal,
    })
    .select("id")
    .single();
  if (insProd.error) throw new Error(insProd.error.message);
  const produccionId = String((insProd.data as { id: string }).id);

  // Rollback best-effort.
  const rollback = async () => {
    try {
      await sb.from("movimientos_inventario").delete().eq("produccion_id", produccionId).eq("empresa_id", params.empresaId);
    } catch {}
    try {
      await sb.from("produccion_items").delete().eq("produccion_id", produccionId).eq("empresa_id", params.empresaId);
    } catch {}
    try {
      await sb.from("producciones").delete().eq("id", produccionId).eq("empresa_id", params.empresaId);
    } catch {}
  };

  try {
    // 2) Insertar produccion_items (bulk).
    if (insumosDetalle.length) {
      const itemsRows = insumosDetalle.map((d) => ({
        empresa_id: params.empresaId,
        produccion_id: produccionId,
        insumo_producto_id: d.producto_id,
        insumo_nombre: d.nombre,
        cantidad: d.requerido,
        unidad_medida: d.unidad,
        costo_unitario: d.costo_unitario,
        subcosto: d.subcosto,
      }));
      const insItems = await sb.from("produccion_items").insert(itemsRows);
      if (insItems.error) throw new Error(insItems.error.message);
    }

    // 3) Descontar cada insumo (floor 0) + movimiento SALIDA origen 'produccion'.
    for (const [insId, need] of insumoNeed) {
      const m = insumoMeta.get(insId)!;
      const nuevoStock = Math.max(0, m.stock - need);
      const upd = await sb
        .from("productos")
        .update({ stock_actual: nuevoStock })
        .eq("id", insId)
        .eq("empresa_id", params.empresaId);
      if (upd.error) throw new Error(upd.error.message);
      m.stock = nuevoStock;

      const mov = await sb.from("movimientos_inventario").insert({
        empresa_id: params.empresaId,
        producto_id: insId,
        producto_nombre: m.nombre,
        producto_sku: m.sku,
        tipo: "SALIDA",
        cantidad: need,
        costo_unitario: m.costo,
        origen: "produccion",
        referencia: null,
        fecha: fechaIso,
        produccion_id: produccionId,
      });
      if (mov.error) throw new Error(mov.error.message);
    }

    // 4) Aumentar stock del terminado + costo_promedio ponderado.
    //    nuevoCosto = (stockAnt*costoPromAnt + costoTotal) / (stockAnt + cantidad). Evita div 0.
    const stockAnt = receta.productoStock;
    const stockNuevo = stockAnt + cantidad;
    const denom = stockNuevo;
    const costoPromNuevoRaw =
      denom > 0 ? (stockAnt * receta.productoCosto + costoTotal) / denom : costoUnitario;
    const costoPromNuevo = Math.round(costoPromNuevoRaw * 1e6) / 1e6;

    const updTerm = await sb
      .from("productos")
      .update({ stock_actual: stockNuevo, costo_promedio: costoPromNuevo })
      .eq("id", receta.productoId)
      .eq("empresa_id", params.empresaId);
    if (updTerm.error) throw new Error(updTerm.error.message);

    const movEnt = await sb.from("movimientos_inventario").insert({
      empresa_id: params.empresaId,
      producto_id: receta.productoId,
      producto_nombre: receta.productoNombre,
      producto_sku: receta.productoSku,
      tipo: "ENTRADA",
      cantidad: cantidad,
      costo_unitario: costoUnitario,
      origen: "produccion",
      referencia: null,
      fecha: fechaIso,
      produccion_id: produccionId,
    });
    if (movEnt.error) throw new Error(movEnt.error.message);

    return {
      produccion_id: produccionId,
      producto_id: receta.productoId,
      producto_nombre: receta.productoNombre,
      cantidad_fabricada: cantidad,
      costo_total: costoTotal,
      costo_unitario: costoUnitario,
      costo_promedio_nuevo: costoPromNuevo,
      stock_terminado_nuevo: stockNuevo,
      insumos: insumosDetalle,
    };
  } catch (err) {
    await rollback();
    throw err;
  }
}
