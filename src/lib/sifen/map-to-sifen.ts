import type {
  SifenDocumentoExtensionFutura,
  SifenDocumentoIdentificacion,
  SifenDocumentoEmisor,
  SifenDocumentoItemLinea,
  SifenDocumentoPreparado,
  SifenDocumentoReceptor,
  SifenDocumentoTotales,
  SifenFacturaPayloadBase,
} from "./types";

function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}

const EXTENSION_VACIA: SifenDocumentoExtensionFutura = {
  cdc: null,
  firma: null,
  qr: null,
  xml: null,
};

/**
 * Transforma el payload base ERP en la estructura interna previa al XML SIFEN.
 * No asigna códigos oficiales SET; deja null los campos reservados en cada línea.
 */
export function mapPayloadBaseToSifenDocumento(base: SifenFacturaPayloadBase): SifenDocumentoPreparado {
  const { emisor, documento, receptor, items, sifen } = base;

  const identificacion: SifenDocumentoIdentificacion = {
    factura_id: documento.factura_id,
    numero_factura: documento.numero_factura,
    fecha_emision: documento.fecha,
    moneda: documento.moneda,
    tipo_documento_erp: documento.tipo,
    saldo_factura_erp: documento.saldo,
    factura_electronica_id: sifen.factura_electronica_id,
    estado_sifen: sifen.estado_sifen,
  };

  const emisorDe: SifenDocumentoEmisor = {
    ruc: emisor.ruc,
    razon_social: emisor.razon_social,
    timbrado_numero: emisor.timbrado_numero,
    establecimiento: emisor.establecimiento,
    punto_expedicion: emisor.punto_expedicion,
  };

  const receptorDe: SifenDocumentoReceptor = {
    cliente_id: receptor.cliente_id,
    razon_social_o_nombre: receptor.nombre,
    ruc: receptor.ruc,
    documento: receptor.documento,
    direccion: receptor.direccion,
    telefono: receptor.telefono,
    email: receptor.email,
    receptor_extranjero: receptor.receptor_extranjero,
    codigo_pais_iso3: receptor.codigo_pais_iso3,
    tipo_doc_receptor: receptor.tipo_doc_receptor,
    descripcion_tipo_doc_receptor: receptor.descripcion_tipo_doc_receptor,
    num_id_receptor: receptor.num_id_receptor,
  };

  const lineas: SifenDocumentoItemLinea[] = items.map((it, idx) => ({
    nro_linea: idx + 1,
    descripcion: it.descripcion,
    cantidad: it.cantidad,
    precio_unitario: it.precio_unitario,
    subtotal: it.subtotal,
    iva: it.iva,
    total_linea: it.total,
    codigo_producto: null,
    codigo_unidad_medida: null,
    afectacion_iva: null,
  }));

  const subtotal_items = sum(items.map((i) => i.subtotal));
  const total_iva = sum(items.map((i) => i.iva));
  const suma_lineas = sum(items.map((i) => i.total));

  const totales: SifenDocumentoTotales = {
    total_general: suma_lineas,
    total_iva,
    subtotal_items,
    monto_total_erp: documento.monto,
    saldo_erp: documento.saldo,
  };

  return {
    identificacion,
    emisor: emisorDe,
    receptor: receptorDe,
    totales,
    items: lineas,
    extension_futura: { ...EXTENSION_VACIA },
  };
}
