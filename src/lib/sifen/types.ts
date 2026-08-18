/**
 * Tipos para el módulo SIFEN (configuración y documentos electrónicos).
 */

export type AmbienteSifen = "test" | "produccion";

/**
 * Configuración SIFEN expuesta por la API (sin contraseña ni ciphertext).
 * `has_certificado_password`: hay secreto cifrado persistido para el .p12.
 */
export interface EmpresaSifenConfigDTO {
  id: string;
  empresa_id: string;
  ambiente: AmbienteSifen;
  ruc: string;
  razon_social: string;
  /** Calle/domicilio fiscal del emisor (SIFEN dDirEmi); no es la razón social. */
  direccion_fiscal: string | null;
  timbrado_numero: string;
  /** Inicio vigencia timbrado YYYY-MM-DD (gTimb.dFeIniT); como figura en la documentación DNIT. */
  timbrado_fecha_inicio_vigencia: string | null;
  /** Catálogo SET (gEmis.gActEco.cActEco). */
  actividad_economica_codigo: string | null;
  /** Texto oficial del catálogo (dDesActEco). */
  actividad_economica_descripcion: string | null;
  establecimiento: string;
  punto_expedicion: string;
  csc: string | null;
  certificado_path: string | null;
  certificado_vencimiento: string | null;
  activo: boolean;
  /** Horas desde `sifen_aprobado_at` para permitir cancelación del DE (1–8760). */
  sifen_plazo_cancelacion_horas: number;
  has_certificado_password: boolean;
  /**
   * Branding opcional KuDE/PDF por empresa. NO afecta XML/firma/SET/CDC.
   * Si `kude_logo_path` es null → renderer usa logo Neura por defecto.
   * Si `kude_color_primario` es null → renderer usa color Neura #0EA5E9.
   * Si `kude_color_primario_fill` es null pero hay primario → derivado en runtime.
   */
  kude_logo_path: string | null;
  /** `#RRGGBB` (validado en DB con CHECK). */
  kude_color_primario: string | null;
  /** `#RRGGBB` (validado en DB con CHECK). */
  kude_color_primario_fill: string | null;
  created_at: string;
  updated_at: string;
}

/** Body POST /api/configuracion/sifen */
export interface EmpresaSifenConfigCreateBody {
  ruc: string;
  razon_social: string;
  direccion_fiscal?: string | null;
  timbrado_numero: string;
  /** Obligatorio: misma fecha que «Fecha Inicio Vigencia» del timbrado en DNIT. */
  timbrado_fecha_inicio_vigencia: string;
  /** Código numérico catálogo SET (principal para el RUC). */
  actividad_economica_codigo: string;
  actividad_economica_descripcion: string;
  establecimiento: string;
  punto_expedicion: string;
  ambiente: AmbienteSifen;
  csc?: string | null;
  certificado_path?: string | null;
  certificado_password?: string | null;
  certificado_vencimiento?: string | null;
  activo?: boolean;
  sifen_plazo_cancelacion_horas?: number;
  /** Branding opcional KuDE; el path real se setea por el endpoint de upload. */
  kude_color_primario?: string | null;
  kude_color_primario_fill?: string | null;
}

/** Body PATCH /api/configuracion/sifen (campos parciales). */
export interface EmpresaSifenConfigPatchBody {
  ruc?: string;
  razon_social?: string;
  direccion_fiscal?: string | null;
  timbrado_numero?: string;
  timbrado_fecha_inicio_vigencia?: string;
  actividad_economica_codigo?: string;
  actividad_economica_descripcion?: string;
  establecimiento?: string;
  punto_expedicion?: string;
  ambiente?: AmbienteSifen;
  csc?: string | null;
  certificado_path?: string | null;
  certificado_password?: string | null;
  certificado_vencimiento?: string | null;
  activo?: boolean;
  sifen_plazo_cancelacion_horas?: number;
  /** Branding opcional KuDE (path se gestiona por endpoint dedicado de upload/delete). */
  kude_color_primario?: string | null;
  kude_color_primario_fill?: string | null;
}

export type EmpresaSifenConfigCreateResult =
  | { ok: true; data: EmpresaSifenConfigCreateBody }
  | { ok: false; error: string };

/** Actualización de contraseña del certificado en PATCH (sin persistir en claro). */
export type SifenCertificadoPasswordPatchAction =
  | { kind: "omit" }
  | { kind: "clear" }
  | { kind: "set"; value: string };

export type EmpresaSifenConfigPatchResult =
  | { ok: true; patch: Record<string, unknown>; password: SifenCertificadoPasswordPatchAction }
  | { ok: false; error: string };

/** Estados del documento electrónico (`zentra_erp.factura_electronica`). */
export type EstadoSifen =
  | "borrador"
  | "generado"
  | "firmado"
  | "enviado"
  | "aprobado"
  | "rechazado"
  | "error_envio"
  | "cancelado";

/** Fila persistida en `sifen_ultima_respuesta_consulta_lote` (jsonb). */
export interface SifenConsultaLoteDetallePersistido {
  cdc: string;
  dEstRes: string;
  dProtAut: string | null;
  grupoRes: { dCodRes: string; dMsgRes: string }[];
}

export interface SifenConsultaLoteUltimaPersistida {
  consultadoEn: string;
  dProtConsLote: string;
  dFecProc: string | null;
  dCodResLot: string | null;
  dMsgResLot: string | null;
  httpStatus: number;
  soapFault: boolean;
  faultString: string | null;
  /** true si no vino ningún `gResProcLote` (p. ej. lote en cola, o lote cancelado 0365 sin filas por CDC). */
  loteSinDetalleCdc: boolean;
  detallePorCdc: SifenConsultaLoteDetallePersistido[];
}

/** Fila de `zentra_erp.factura_electronica` (respuesta API). */
export interface FacturaElectronicaDTO {
  id: string;
  empresa_id: string;
  factura_id: string;
  estado_sifen: EstadoSifen;
  /** Contador de regeneración tras rechazo SET (semilla dCodSeg / CDC). */
  sifen_regeneracion_seq?: number | null;
  cdc: string | null;
  xml_path: string | null;
  xml_firmado_path: string | null;
  kuDE_url: string | null;
  qr_data: string | null;
  error: string | null;
  /** dProtConsLote (SET) tras envío exitoso a recibe-lote (0300). */
  sifen_d_prot_cons_lote: string | null;
  /** Última respuesta recibe-lote (parseada + cuerpo SOAP). */
  sifen_ultima_respuesta_recibe_lote: Record<string, unknown> | null;
  /** Última respuesta consulta-lote TEST (dCodResLot, detalle por CDC). */
  sifen_ultima_respuesta_consulta_lote: SifenConsultaLoteUltimaPersistida | null;
  /** Marca de aprobación SET (consulta-lote); base del plazo de cancelación. */
  sifen_aprobado_at: string | null;
  sifen_cancelado_at: string | null;
  sifen_cancelacion_motivo: string | null;
  created_at: string;
  updated_at: string;
}

/** Resumen + reglas de cancelación lógica (GET …/sifen/resumen). */
export interface SifenCancelacionPreviewDTO {
  puede_cancelar: boolean;
  cancelable_hasta: string | null;
  motivo_bloqueo: string | null;
  requiere_nota_credito: boolean;
  tiene_pagos: boolean;
  plazo_horas: number;
}

/** Detalle JSON del evento de generación de borrador vía API. */
export interface SifenBorradorGeneracionDetalle {
  origen: "api_borrador";
  factura_id: string;
}

/** Detalle JSON del evento al construir el payload base vía API. */
export interface SifenApiPayloadGeneracionDetalle {
  origen: "api_payload";
  factura_id: string;
}

/** Detalle JSON del evento al generar XML vía API. */
export interface SifenApiXmlGeneracionDetalle {
  origen: "api_xml";
  factura_id: string;
  xml_path: string;
  /** Presente si la generación reservó una nueva revisión (estado previo `rechazado`). */
  sifen_regeneracion_seq?: number;
}

/** Payload base JSON para armar el DE SIFEN (sin XML). */
export interface SifenPayloadEmisor {
  ruc: string;
  razon_social: string;
  /** Domicilio/calle para gEmis.dDirEmi (desde empresa_sifen_config.direccion_fiscal). */
  direccion_fiscal: string;
  timbrado_numero: string;
  /** YYYY-MM-DD; debe coincidir con inicio de vigencia del timbrado en DNIT (dFeIniT). */
  timbrado_fecha_inicio_vigencia: string;
  actividad_economica_codigo: string;
  actividad_economica_descripcion: string;
  establecimiento: string;
  punto_expedicion: string;
  /** Código de seguridad del timbrado (SET); obligatorio para generar el DE oficial. */
  csc: string | null;
}

export interface SifenPayloadDocumento {
  factura_id: string;
  numero_factura: string;
  fecha: string;
  tipo: string;
  moneda: string;
  monto: number;
  saldo: number;
}

export interface SifenPayloadReceptor {
  cliente_id: string;
  nombre: string;
  documento: string | null;
  ruc: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  /**
   * Si true, el DE usa receptor no contribuyente extranjero: sin dRucRec/dDVRec;
   * cPaisRec + iTipIDRec + dDTipIDRec + dNumIDRec.
   */
  receptor_extranjero?: boolean;
  /** ISO 3166-1 alpha-3 (ej. PER). Obligatorio cuando receptor_extranjero es true. */
  codigo_pais_iso3?: string | null;
  /** tiTipDocRec SET (1–6 | 9). Con extranjero, null se interpreta como 9. */
  tipo_doc_receptor?: number | null;
  /** Texto libre 9–41 solo si tipo 9 y se desea personalizar dDTipIDRec. */
  descripcion_tipo_doc_receptor?: string | null;
  /** Valor sanitizado para dNumIDRec (máx. 20). Con extranjero se arma en build-payload. */
  num_id_receptor?: string | null;
  /**
   * Modo explícito (cliente.sifen_receptor_manual): iNatRec / iTiOpe / dirección y número de casa del DE
   * según columnas del cliente; no usa la inferencia legacy RUC/CI/extranjero boolean.
   */
  sifen_receptor_config_manual?: boolean;
  /** iNatRec SET: 1 contribuyente, 2 no contribuyente. */
  sifen_i_nat_rec?: 1 | 2;
  /** iTiOpe SET: 1 B2B, 2 B2C, 3 B2G, 4 B2F. */
  sifen_i_ti_ope?: 1 | 2 | 3 | 4;
  /** dDirRec en gDatRec (obligatorio en modo manual cuando aplica dirección en el DE). */
  sifen_d_dir_rec?: string | null;
  /** dNumCasRec (entero ≥ 0). */
  sifen_d_num_cas_rec?: number | null;
}

export interface SifenPayloadItem {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  iva: number;
  total: number;
}

export interface SifenPayloadMeta {
  factura_electronica_id: string;
  estado_sifen: EstadoSifen;
  /**
   * Si > 0, altera la semilla de `dCodSeg` (y el CDC del DE) respecto al borrador inicial.
   * Se incrementa en BD al regenerar XML desde `rechazado` (evita reutilizar el mismo Id/CDC
   * de un DE ya rechazado al volver a firmar y enviar).
   */
  sifen_regeneracion_seq?: number;
}

/** Respuesta de GET /api/facturas/[id]/sifen/payload */
export interface SifenFacturaPayloadBase {
  emisor: SifenPayloadEmisor;
  documento: SifenPayloadDocumento;
  receptor: SifenPayloadReceptor;
  items: SifenPayloadItem[];
  sifen: SifenPayloadMeta;
}

/** Meta para armar el DE de nota de crédito (vínculo a `nota_credito_electronica`). */
export interface SifenNotaCreditoPayloadMeta {
  nota_credito_electronica_id: string;
  estado_sifen: string;
}

/** Payload para XML rDE nota de crédito electrónica (iTiDE=5). */
export interface SifenNotaCreditoPayload {
  emisor: SifenPayloadEmisor;
  receptor: SifenPayloadReceptor;
  notaCredito: {
    id: string;
    monto: number;
    motivo: string;
    /** Fecha calendario YYYY-MM-DD alineada al CDC (emisión NC = misma lógica que FE). */
    fecha_emision: string;
  };
  facturaOrigen: {
    numero_factura: string;
    fecha: string;
    moneda: string;
  };
  documentoElectronicoOrigen: { cdc: string };
  sifen: SifenNotaCreditoPayloadMeta;
}

// ─── Documento interno previo a XML (mapPayloadBaseToSifenDocumento; no es el GET API) ─

/** Cabecera de identificación del DE (campos ERP + vínculo electrónico). */
export interface SifenDocumentoIdentificacion {
  factura_id: string;
  numero_factura: string;
  fecha_emision: string;
  moneda: string;
  tipo_documento_erp: string;
  saldo_factura_erp: number;
  factura_electronica_id: string;
  estado_sifen: EstadoSifen;
}

/** Emisor en forma cercana al DE (misma base que payload; nombres listos para XML). */
export interface SifenDocumentoEmisor {
  ruc: string;
  razon_social: string;
  timbrado_numero: string;
  establecimiento: string;
  punto_expedicion: string;
}

/** Receptor para el DE (sin códigos SET hasta definirlos). */
export interface SifenDocumentoReceptor {
  cliente_id: string;
  razon_social_o_nombre: string;
  ruc: string | null;
  documento: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  receptor_extranjero?: boolean;
  codigo_pais_iso3?: string | null;
  tipo_doc_receptor?: number | null;
  descripcion_tipo_doc_receptor?: string | null;
  num_id_receptor?: string | null;
}

/** Totales agregados para el DE (derivados de líneas + cabecera ERP). */
export interface SifenDocumentoTotales {
  total_general: number;
  total_iva: number;
  subtotal_items: number;
  monto_total_erp: number;
  saldo_erp: number;
}

/**
 * Línea de ítem preparada para el DE.
 * Campos SET (códigos, afectación) reservados en null hasta mapearlos al manual.
 */
export interface SifenDocumentoItemLinea {
  nro_linea: number;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  iva: number;
  total_linea: number;
  codigo_producto: null;
  codigo_unidad_medida: null;
  afectacion_iva: null;
}

/**
 * Placeholder explícito para CDC, firma, QR y XML (fases posteriores).
 */
export interface SifenDocumentoExtensionFutura {
  cdc: string | null;
  firma: string | null;
  qr: string | null;
  xml: string | null;
}

/** Estructura interna lista para serializar a XML SIFEN más adelante. */
export interface SifenDocumentoPreparado {
  identificacion: SifenDocumentoIdentificacion;
  emisor: SifenDocumentoEmisor;
  receptor: SifenDocumentoReceptor;
  totales: SifenDocumentoTotales;
  items: SifenDocumentoItemLinea[];
  extension_futura: SifenDocumentoExtensionFutura;
}

/** Respuesta de POST /api/facturas/[id]/sifen/xml */
export interface SifenXmlGeneracionResponseData {
  factura_electronica: FacturaElectronicaDTO;
  /** Ruta del objeto dentro del bucket `storage_bucket`. */
  xml_path: string;
  storage_bucket: string;
  /** Solo si se solicita explícitamente (p. ej. ?debug=1). */
  xml?: string;
}

/** Detalle del evento de firma XML. */
export interface SifenApiFirmarDetalle {
  origen: "api_firmar";
  factura_id: string;
  xml_firmado_path: string;
}

/** Respuesta de POST /api/facturas/[id]/sifen/firmar */
export interface SifenFirmarResponseData {
  factura_electronica: FacturaElectronicaDTO;
  xml_path: string | null;
  xml_firmado_path: string;
  storage_bucket: string;
  /** Solo con ?debug=1 */
  xml_firmado?: string;
}

/** Detalle del evento POST enviar / enviar-test (recibe-lote). */
export interface SifenApiEnviarTestDetalle {
  origen: "api_enviar_test" | "api_enviar";
  factura_id: string;
  xml_firmado_path: string;
  dCodRes: string | null;
  dMsgRes: string | null;
  dProtConsLote: string | null;
  httpStatus: number;
  loteRecibido: boolean;
  loteNoEncolado: boolean;
}

/** Respuesta de POST /api/facturas/[id]/sifen/enviar-test */
export interface SifenEnviarTestResponseData {
  factura_electronica: FacturaElectronicaDTO;
  storage_bucket: string;
  /** Eco de la respuesta SET (también persistida en factura_electronica / evento). */
  recibe_lote: {
    dCodRes: string | null;
    dMsgRes: string | null;
    dProtConsLote: string | null;
    dFecProc: string | null;
    dTpoProces: number | null;
    httpStatus: number;
    loteRecibido: boolean;
    loteNoEncolado: boolean;
  };
  /** Solo con ?debug=1 */
  cuerpo_soap?: string;
  /** Solo con ?debug=1: eco de la petición HTTPS/SOAP enviada a recibe-lote. */
  solicitud_https?: {
    url: string;
    method: string;
    contentType: string;
    soapBodyUtf8: string;
  };
}

/** Detalle del evento POST consulta-lote / consulta-lote-test. */
export interface SifenApiConsultaLoteTestDetalle {
  origen: "api_consulta_lote_test" | "api_consulta_lote";
  factura_id: string;
  dProtConsLote: string;
  dCodResLot: string | null;
  dMsgResLot: string | null;
  httpStatus: number;
  soapFault: boolean;
  estado_sifen_anterior: string;
  estado_sifen_nuevo: string;
}

/** Respuesta de POST /api/facturas/[id]/sifen/consulta-lote-test */
export interface SifenConsultaLoteTestResponseData {
  factura_electronica: FacturaElectronicaDTO;
  consulta_lote: {
    dFecProc: string | null;
    dCodResLot: string | null;
    dMsgResLot: string | null;
    httpStatus: number;
    soapFault: boolean;
    faultString: string | null;
    detallePorCdc: SifenConsultaLoteDetallePersistido[];
    loteSinDetalleCdc: boolean;
    /** true si sigue en cola / sin resultado por DE (típico mientras `enviado`). */
    loteEnProcesamiento: boolean;
    /** Si se actualizó `estado_sifen` desde `enviado` a aprobado/rechazado. */
    estadoActualizado: boolean;
    resumenInferido: string | null;
  };
  /** Solo con ?debug=1 */
  cuerpo_soap?: string;
}
