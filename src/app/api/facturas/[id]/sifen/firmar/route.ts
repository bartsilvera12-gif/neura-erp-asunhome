import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { decryptSecret } from "@/lib/sifen/security";
import {
  buildSifenSignedXmlObjectPath,
  buildSifenXmlObjectPath,
  downloadSifenObject,
  ensureSifenStorageBucket,
  removeSifenObject,
  SIFEN_STORAGE_BUCKET,
  uploadSifenXml,
} from "@/lib/sifen/sifen-storage";
import { downloadSifenCertificadoObject } from "@/lib/sifen/sifen-certificados-storage";
import { extractKeyAndCertFromP12, signSifenDocumentoXml } from "@/lib/sifen/sign-xml";
import { SIFEN_TEST_CSC_GENERICO } from "@/lib/sifen/sifen-ambiente-test";
import { parseAmbiente } from "@/lib/sifen/config-validation";
import type {
  FacturaElectronicaDTO,
  SifenApiFirmarDetalle,
  SifenFirmarResponseData,
} from "@/lib/sifen/types";


const ESTADOS_BLOQUEADOS_FIRMAR = new Set<string>(["aprobado", "cancelado"]);

/**
 * POST /api/facturas/[id]/sifen/firmar
 * Firma el XML en storage con el .p12 de la empresa (XML-DSig). No envía a SET.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getFacturasSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { auth, supabase } = ctx;

    const { id: facturaId } = await params;
    if (!facturaId?.trim()) {
      return NextResponse.json(errorResponse("id de factura es obligatorio"), { status: 400 });
    }

    const debugXml = request.nextUrl.searchParams.get("debug") === "1";
    const fid = facturaId.trim();

    const { data: feRow, error: errFe } = await supabase
      .from("factura_electronica")
      .select("id, factura_id, xml_path, xml_firmado_path, estado_sifen")
      .eq("factura_id", fid)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errFe) {
      return NextResponse.json(errorResponse(errFe.message), { status: 400 });
    }
    if (!feRow) {
      return NextResponse.json(
        errorResponse(
          "No existe registro electrónico para esta factura. Cree el borrador y genere el XML antes de firmar."
        ),
        { status: 400 }
      );
    }

    if (ESTADOS_BLOQUEADOS_FIRMAR.has(String(feRow.estado_sifen))) {
      return NextResponse.json(
        errorResponse(`No se puede firmar: el documento está en estado "${feRow.estado_sifen}".`),
        { status: 409 }
      );
    }

    const xmlPathRegistrado = feRow.xml_path == null ? "" : String(feRow.xml_path).trim();
    if (!xmlPathRegistrado) {
      return NextResponse.json(
        errorResponse("No hay XML generado (xml_path vacío). Ejecute primero POST /api/facturas/{id}/sifen/xml."),
        { status: 400 }
      );
    }

    /** Siempre el mismo objeto que genera POST .../sifen/xml (evita firmar un path desalineado en BD). */
    const canonicalXmlPath = buildSifenXmlObjectPath(auth.empresa_id, fid);

    const { data: cfg, error: errCfg } = await supabase
      .from("empresa_sifen_config")
      .select("certificado_path, certificado_password_encrypted, ambiente, csc")
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errCfg) {
      return NextResponse.json(errorResponse(errCfg.message), { status: 400 });
    }
    if (!cfg) {
      return NextResponse.json(
        errorResponse("No hay configuración SIFEN para esta empresa."),
        { status: 400 }
      );
    }

    const certPath = cfg.certificado_path == null ? "" : String(cfg.certificado_path).trim();
    if (!certPath) {
      return NextResponse.json(
        errorResponse(
          "No hay certificado en storage (certificado_path vacío). Suba el .p12 con POST /api/configuracion/sifen/certificado."
        ),
        { status: 400 }
      );
    }

    const encPwd = cfg.certificado_password_encrypted;
    if (encPwd == null || String(encPwd).trim() === "") {
      return NextResponse.json(
        errorResponse(
          "No hay contraseña del certificado cifrada. Configúrela con PATCH /api/configuracion/sifen (certificado_password)."
        ),
        { status: 400 }
      );
    }

    const ambiente = parseAmbiente(cfg.ambiente);
    if (!ambiente) {
      return NextResponse.json(
        errorResponse('Configuración SIFEN: ambiente inválido (use "test" o "produccion").'),
        { status: 400 }
      );
    }
    const cscCfg = cfg.csc == null ? "" : String(cfg.csc).trim();
    const cscParaQr =
      ambiente === "test"
        ? cscCfg !== ""
          ? cscCfg
          : SIFEN_TEST_CSC_GENERICO
        : cscCfg;
    if (ambiente === "produccion" && cscParaQr === "") {
      return NextResponse.json(
        errorResponse(
          "Falta CSC en configuración SIFEN (obligatorio para el código QR / cHashQR en producción)."
        ),
        { status: 400 }
      );
    }

    let p12Password: string;
    try {
      p12Password = decryptSecret(String(encPwd));
    } catch (e) {
      const m = e instanceof Error ? e.message : "Error al descifrar la contraseña del certificado";
      return NextResponse.json(errorResponse(m), { status: 500 });
    }

    const xmlDl = await downloadSifenObject(supabase, canonicalXmlPath);
    if (!xmlDl.ok) {
      return NextResponse.json(
        errorResponse(
          `No se pudo descargar documento.xml (${canonicalXmlPath}) desde storage: ${xmlDl.message}`
        ),
        { status: 500 }
      );
    }

    const p12Dl = await downloadSifenCertificadoObject(supabase, certPath);
    if (!p12Dl.ok) {
      return NextResponse.json(
        errorResponse(`No se pudo descargar el certificado .p12: ${p12Dl.message}`),
        { status: 500 }
      );
    }

    let material;
    try {
      material = extractKeyAndCertFromP12(p12Dl.data, p12Password);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Error al leer el .p12";
      return NextResponse.json(errorResponse(m), { status: 400 });
    }

    let signedXml: string;
    try {
      signedXml = signSifenDocumentoXml(xmlDl.data.toString("utf8"), material, {
        ambiente,
        csc: cscParaQr,
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : "Error al firmar el XML";
      return NextResponse.json(errorResponse(`Firma XML-DSig falló: ${m}`), { status: 500 });
    }

    const bucketOk = await ensureSifenStorageBucket(supabase);
    if (!bucketOk.ok) {
      return NextResponse.json(errorResponse(`Storage SIFEN: ${bucketOk.message}`), { status: 500 });
    }

    const previousEstado = String(feRow.estado_sifen ?? "generado");
    const previousSignedPath =
      feRow.xml_firmado_path == null || feRow.xml_firmado_path === undefined
        ? null
        : String(feRow.xml_firmado_path);
    const previousXmlPath =
      feRow.xml_path == null || feRow.xml_path === undefined ? null : String(feRow.xml_path);

    const signedPath = buildSifenSignedXmlObjectPath(auth.empresa_id, fid);

    await removeSifenObject(supabase, signedPath);
    if (
      previousSignedPath != null &&
      String(previousSignedPath).trim() !== "" &&
      String(previousSignedPath).trim() !== signedPath
    ) {
      await removeSifenObject(supabase, String(previousSignedPath).trim());
    }

    const up = await uploadSifenXml(supabase, signedPath, signedXml);
    if (!up.ok) {
      return NextResponse.json(
        errorResponse(`No se pudo guardar el XML firmado: ${up.message}`),
        { status: 500 }
      );
    }

    const { data: updatedRow, error: errUpdate } = await supabase
      .from("factura_electronica")
      .update({
        xml_firmado_path: signedPath,
        estado_sifen: "firmado",
        xml_path: canonicalXmlPath,
      })
      .eq("id", feRow.id)
      .eq("empresa_id", auth.empresa_id)
      .select()
      .single();

    if (errUpdate || !updatedRow) {
      if (previousSignedPath == null || signedPath !== previousSignedPath) {
        await removeSifenObject(supabase, signedPath);
      }
      return NextResponse.json(
        errorResponse(
          errUpdate?.message ??
            "No se pudo actualizar factura_electronica; el XML firmado subido fue eliminado."
        ),
        { status: 500 }
      );
    }

    const detalle: SifenApiFirmarDetalle = {
      origen: "api_firmar",
      factura_id: fid,
      xml_firmado_path: signedPath,
    };

    const { error: errEvento } = await supabase.from("factura_electronica_evento").insert({
      empresa_id: auth.empresa_id,
      factura_electronica_id: feRow.id,
      tipo: "firma",
      detalle,
    });

    if (errEvento) {
      await supabase
        .from("factura_electronica")
        .update({
          xml_firmado_path: previousSignedPath,
          estado_sifen: previousEstado,
          xml_path: previousXmlPath,
        })
        .eq("id", feRow.id)
        .eq("empresa_id", auth.empresa_id);
      if (previousSignedPath == null || signedPath !== previousSignedPath) {
        await removeSifenObject(supabase, signedPath);
      }
      return NextResponse.json(
        errorResponse(`No se pudo registrar el evento; se revirtió el estado y el archivo: ${errEvento.message}`),
        { status: 500 }
      );
    }

    const data: SifenFirmarResponseData = {
      factura_electronica: updatedRow as FacturaElectronicaDTO,
      xml_path: canonicalXmlPath,
      xml_firmado_path: signedPath,
      storage_bucket: SIFEN_STORAGE_BUCKET,
    };
    if (debugXml) {
      data.xml_firmado = signedXml;
    }

    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
