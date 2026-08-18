import { NextRequest, NextResponse } from "next/server";
import { getFacturasSupabaseFromAuth } from "@/lib/facturacion/facturas-service-client";
import { errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { downloadSifenObject } from "@/lib/sifen/sifen-storage";


/**
 * GET /api/facturas/[id]/sifen/documento
 * Devuelve el XML rDE almacenado en el bucket `sifen`: firmado si existe, si no el generado.
 * Content-Type: application/xml; charset=utf-8
 */
export async function GET(
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

    const fid = facturaId.trim();

    const { data: feRow, error: errFe } = await supabase
      .from("factura_electronica")
      .select("xml_path, xml_firmado_path")
      .eq("factura_id", fid)
      .eq("empresa_id", auth.empresa_id)
      .maybeSingle();

    if (errFe) {
      return NextResponse.json(errorResponse(errFe.message), { status: 400 });
    }
    if (!feRow) {
      return NextResponse.json(
        errorResponse("No hay documento electrónico para esta factura. Cree el borrador y genere el XML."),
        { status: 404 }
      );
    }

    const firmado =
      feRow.xml_firmado_path == null ? "" : String(feRow.xml_firmado_path).trim();
    const generado = feRow.xml_path == null ? "" : String(feRow.xml_path).trim();

    const tryPaths: { path: string; label: string }[] = [];
    if (firmado) tryPaths.push({ path: firmado, label: "firmado" });
    if (generado) tryPaths.push({ path: generado, label: "generado" });

    if (tryPaths.length === 0) {
      return NextResponse.json(
        errorResponse("Aún no hay XML en storage. Ejecute POST .../sifen/xml."),
        { status: 404 }
      );
    }

    let lastErr = "";
    for (const { path: objectPath, label } of tryPaths) {
      const dl = await downloadSifenObject(supabase, objectPath);
      if (dl.ok) {
        const body = dl.data.toString("utf8");
        return new NextResponse(body, {
          status: 200,
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "private, no-store",
            "X-Sifen-Xml-Origen": label,
          },
        });
      }
      lastErr = dl.message;
    }

    return NextResponse.json(
      errorResponse(`No se pudo leer el XML desde storage: ${lastErr}`),
      { status: 502 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
