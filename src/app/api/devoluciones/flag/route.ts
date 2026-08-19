import { NextResponse } from "next/server";
import { devolucionesEnabled } from "@/lib/devoluciones/feature-flag";

/**
 * GET /api/devoluciones/flag
 * Estado del feature flag para que la UI oculte botones y enlaces.
 * No requiere auth: solo expone un booleano de configuracion.
 */
export async function GET() {
  return NextResponse.json(
    { success: true, data: { enabled: devolucionesEnabled() } },
    { headers: { "Cache-Control": "no-store" } }
  );
}
