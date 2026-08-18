/**
 * Pre-vuelo SIFEN para notas de crédito: validación antes de generar/enviar (sin llamar a SET).
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { extractOrigenFiscalDesdeRdeXml } from "@/lib/sifen/parse-kude-from-signed-xml";
import { downloadSifenObject } from "@/lib/sifen/sifen-storage";
import { loadValidatedNotaCreditoSifenPayload } from "@/lib/sifen/load-nota-credito-sifen-payload";
import type { AmbienteSifen } from "@/lib/sifen/types";
import { validarXmlFirmadoFacturaOrigenParaNc } from "@/lib/sifen/validar-factura-origen-xml-para-nc";
import {
  assertGtimbradoNcCoincideConPayloadOrThrow,
  assertItideNotaCredito,
  compararGtimbradoXmlConEmisorPayload,
} from "@/lib/sifen/gtimb-nc-coherencia";
import {
  assertNotaCreditoXmlSinCondicionOperacion,
  assertNotaCreditoXmlSinTipoTransaccionComercial,
} from "@/lib/sifen/rde-nc-xml";
import type { SifenPrevueloFacturaNcDTO } from "./types";

export type SifenPrevueloNcCompletoDTO = {
  ok: boolean;
  mensaje: string | null;
  bloquea_procesar: boolean;
  bloquea_enviar: boolean;
  diagnostico: Record<string, unknown> | null;
};

/** Validación de la factura origen (XML firmado + CDC + config). Una vez por factura. */
export async function obtenerSifenPrevueloFacturaParaNcs(
  supabase: AppSupabaseClient,
  empresaId: string,
  facturaId: string
): Promise<SifenPrevueloFacturaNcDTO> {
  const { data: fe, error: errFe } = await supabase
    .from("factura_electronica")
    .select("id, factura_id, cdc, xml_firmado_path")
    .eq("factura_id", facturaId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (errFe) {
    return { ok: false, mensaje: errFe.message, diagnostico: { fase: "lectura_fe", error: errFe.message } };
  }
  if (!fe) {
    return {
      ok: false,
      mensaje: "No hay documento electrónico para esta factura.",
      diagnostico: { fase: "lectura_fe" },
    };
  }

  const cdc = fe.cdc == null ? "" : String(fe.cdc).trim();
  if (cdc.length !== 44) {
    return {
      ok: false,
      mensaje: "El documento electrónico no tiene CDC válido (44 dígitos).",
      diagnostico: { fase: "cdc", cdc_length: cdc.length },
    };
  }

  const { data: fac, error: errFac } = await supabase
    .from("facturas")
    .select("numero_factura")
    .eq("id", facturaId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (errFac || !fac) {
    return {
      ok: false,
      mensaje: errFac?.message ?? "Factura no encontrada.",
      diagnostico: { fase: "lectura_factura" },
    };
  }

  const v = await validarXmlFirmadoFacturaOrigenParaNc(
    supabase,
    empresaId,
    {
      id: String((fe as { id: string }).id),
      factura_id: String((fe as { factura_id: string }).factura_id),
      cdc,
      xml_firmado_path:
        (fe as { xml_firmado_path?: string | null }).xml_firmado_path == null
          ? null
          : String((fe as { xml_firmado_path?: string | null }).xml_firmado_path).trim() || null,
    },
    {
      cdcEsperado: cdc,
      facturaIdEsperado: facturaId,
      numeroFacturaErp: String((fac as { numero_factura?: string }).numero_factura ?? ""),
    }
  );

  if (!v.ok) {
    return {
      ok: false,
      mensaje: v.message,
      diagnostico: {
        fase: "validacion_xml_origen",
        status: v.status,
      },
    };
  }

  return {
    ok: true,
    mensaje: null,
    diagnostico: {
      fase: "validacion_xml_origen",
      timbrado_xml: v.fiscal.timbrado_numero,
      establecimiento_xml: v.fiscal.establecimiento,
      punto_xml: v.fiscal.punto_expedicion,
      ruc_configurado: true,
      resultado: "ok",
    },
  };
}

/**
 * Pre-vuelo completo para una NC: origen + (si hay XML firmado de NC) coherencia `gTimb` vs payload.
 */
export async function evaluarPrevueloNotaCreditoCompleto(
  supabase: AppSupabaseClient,
  empresaId: string,
  notaCreditoId: string,
  opts?: { ambienteDeXml?: AmbienteSifen }
): Promise<SifenPrevueloNcCompletoDTO> {
  const nid = notaCreditoId.trim();

  const { data: nc, error: errNc } = await supabase
    .from("nota_credito")
    .select("id, factura_id, estado_erp")
    .eq("id", nid)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (errNc || !nc) {
    return {
      ok: false,
      mensaje: errNc?.message ?? "Nota de crédito no encontrada.",
      bloquea_procesar: true,
      bloquea_enviar: true,
      diagnostico: { fase: "nc" },
    };
  }

  const facturaId = String((nc as { factura_id: string }).factura_id);
  const prevFactura = await obtenerSifenPrevueloFacturaParaNcs(supabase, empresaId, facturaId);
  if (!prevFactura.ok) {
    return {
      ok: false,
      mensaje: prevFactura.mensaje,
      bloquea_procesar: true,
      bloquea_enviar: true,
      diagnostico: { ...prevFactura.diagnostico, prevuelo_factura_ok: false },
    };
  }

  const loaded = await loadValidatedNotaCreditoSifenPayload(supabase, empresaId, nid, {
    ambienteDeXml: opts?.ambienteDeXml,
  });
  if (!loaded.ok) {
    return {
      ok: false,
      mensaje: loaded.error.message,
      bloquea_procesar: true,
      bloquea_enviar: true,
      diagnostico: {
        fase: "payload_nc",
        status: loaded.error.status,
        prevuelo_factura_ok: true,
      },
    };
  }

  const { data: ne, error: errNe } = await supabase
    .from("nota_credito_electronica")
    .select("estado_sifen, xml_firmado_path")
    .eq("nota_credito_id", nid)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  const est = ne == null ? "" : String((ne as { estado_sifen?: string }).estado_sifen ?? "");
  const signedNc =
    ne == null || (ne as { xml_firmado_path?: string | null }).xml_firmado_path == null
      ? ""
      : String((ne as { xml_firmado_path?: string | null }).xml_firmado_path).trim();

  let ncGtimbradoOk: boolean | null = null;
  let ncGtimbradoDetalle: unknown = null;

  if (signedNc && (est === "firmado" || est === "error_envio")) {
    const bin = await downloadSifenObject(supabase, signedNc);
    if (!bin.ok) {
      return {
        ok: false,
        mensaje: `No se pudo descargar el XML firmado de la NC para verificación: ${bin.message}`,
        bloquea_procesar: false,
        bloquea_enviar: true,
        diagnostico: {
          fase: "nc_xml_firmado",
          prevuelo_factura_ok: true,
          download_ok: false,
        },
      };
    }
    try {
      const xmlNc = bin.data.toString("utf8");
      assertNotaCreditoXmlSinTipoTransaccionComercial(xmlNc);
      assertNotaCreditoXmlSinCondicionOperacion(xmlNc);
      const parsed = extractOrigenFiscalDesdeRdeXml(xmlNc);
      assertItideNotaCredito(parsed);
      assertGtimbradoNcCoincideConPayloadOrThrow(parsed, loaded.payload.emisor);
      ncGtimbradoOk = true;
      ncGtimbradoDetalle = compararGtimbradoXmlConEmisorPayload(parsed, loaded.payload.emisor);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        mensaje: m,
        bloquea_procesar: false,
        bloquea_enviar: true,
        diagnostico: {
          fase: "nc_xml_firmado_gtimb",
          prevuelo_factura_ok: true,
          error: m,
        },
      };
    }
  }

  return {
    ok: true,
    mensaje: null,
    bloquea_procesar: false,
    bloquea_enviar: false,
    diagnostico: {
      fase: "completo",
      prevuelo_factura_ok: true,
      timbrado_payload: loaded.payload.emisor.timbrado_numero,
      establecimiento_payload: loaded.payload.emisor.establecimiento,
      punto_payload: loaded.payload.emisor.punto_expedicion,
      ruc_payload: loaded.payload.emisor.ruc,
      nc_estado_sifen: est || null,
      nc_xml_firmado_gtimb_verificado: ncGtimbradoOk,
      nc_gtimb_detalle: ncGtimbradoDetalle,
    },
  };
}

export async function validarNcFirmadoListoParaEnvioSet(opts: {
  supabase: AppSupabaseClient;
  empresaId: string;
  ncId: string;
  xmlFirmadoUtf8: string;
  ambienteDeXml?: AmbienteSifen;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const loaded = await loadValidatedNotaCreditoSifenPayload(opts.supabase, opts.empresaId, opts.ncId, {
    ambienteDeXml: opts.ambienteDeXml,
  });
  if (!loaded.ok) {
    return { ok: false, message: loaded.error.message };
  }
  try {
    assertNotaCreditoXmlSinTipoTransaccionComercial(opts.xmlFirmadoUtf8);
    assertNotaCreditoXmlSinCondicionOperacion(opts.xmlFirmadoUtf8);
    const parsed = extractOrigenFiscalDesdeRdeXml(opts.xmlFirmadoUtf8);
    assertItideNotaCredito(parsed);
    assertGtimbradoNcCoincideConPayloadOrThrow(parsed, loaded.payload.emisor);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true };
}
