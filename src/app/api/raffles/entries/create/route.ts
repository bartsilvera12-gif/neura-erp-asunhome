import { NextRequest, NextResponse } from "next/server";
import { registrarCompraSorteoN8n } from "@/lib/sorteos/raffles-service";
import type { CreateRaffleEntryPayload } from "@/lib/sorteos/types";

function validarSecret(request: NextRequest): boolean {
  const secret = process.env.RAFFLES_N8N_SECRET;
  if (!secret || secret.length === 0) return true;

  const auth = request.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const apiKey =
    request.headers.get("x-api-key") ?? request.headers.get("x-raffles-secret");

  if (bearer === secret || apiKey === secret) return true;
  return false;
}

function parseBody(raw: unknown): CreateRaffleEntryPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const empresa_id = typeof o.empresa_id === "string" ? o.empresa_id : null;
  const sorteo_id = typeof o.sorteo_id === "string" ? o.sorteo_id : null;
  const whatsapp_numero = typeof o.whatsapp_numero === "string" ? o.whatsapp_numero.trim() : "";
  const nombre_completo = typeof o.nombre_completo === "string" ? o.nombre_completo.trim() : "";
  const cedula = typeof o.cedula === "string" ? o.cedula : "";
  const celular = typeof o.celular === "string" ? o.celular : "";
  const ciudad = typeof o.ciudad === "string" ? o.ciudad : "";
  const cantidad_boletos = typeof o.cantidad_boletos === "number" ? o.cantidad_boletos : NaN;
  const fecha_pago = typeof o.fecha_pago === "string" ? o.fecha_pago : "";
  const monto_pago = typeof o.monto_pago === "number" ? o.monto_pago : NaN;
  const banco_origen = typeof o.banco_origen === "string" ? o.banco_origen : "";
  const comprobante_url =
    o.comprobante_url === null || o.comprobante_url === undefined
      ? null
      : typeof o.comprobante_url === "string"
        ? o.comprobante_url
        : null;
  const ultimo_mensaje =
    o.ultimo_mensaje === null || o.ultimo_mensaje === undefined
      ? null
      : typeof o.ultimo_mensaje === "string"
        ? o.ultimo_mensaje
        : null;

  if (!empresa_id || !sorteo_id || !whatsapp_numero || !nombre_completo) return null;
  if (!Number.isFinite(cantidad_boletos) || cantidad_boletos < 1) return null;
  if (!Number.isFinite(monto_pago)) return null;

  return {
    empresa_id,
    sorteo_id,
    whatsapp_numero,
    nombre_completo,
    cedula,
    celular,
    ciudad,
    cantidad_boletos,
    fecha_pago,
    monto_pago,
    banco_origen,
    comprobante_url,
    ultimo_mensaje,
  };
}

/**
 * POST /api/raffles/entries/create
 * Integración n8n / WhatsApp. No usa PostgREST directo; ejecuta RPC atómica con service role.
 *
 * Seguridad opcional: si existe RAFFLES_N8N_SECRET, exige Authorization: Bearer <secret>
 * o header x-api-key / x-raffles-secret con el mismo valor.
 */
export async function POST(request: NextRequest) {
  try {
    if (!validarSecret(request)) {
      return NextResponse.json(
        { ok: false, message: "No autorizado", detalle: "Token o API key inválida" },
        { status: 401 }
      );
    }

    const raw = await request.json().catch(() => null);
    const payload = parseBody(raw);
    if (!payload) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Body inválido: se requieren empresa_id, sorteo_id, whatsapp_numero, nombre_completo, cantidad_boletos (>0), fecha_pago, monto_pago y campos de contacto",
        },
        { status: 400 }
      );
    }

    const result = await registrarCompraSorteoN8n(payload);

    if (!result.ok) {
      const status =
        result.message.includes("no pertenece") || result.message.includes("no encontrado")
          ? 404
          : result.message.includes("no está activo") || result.message.includes("habilitado")
            ? 403
            : result.message.includes("No hay boletos")
              ? 409
              : 400;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json(result);
  } catch (e) {
    console.error("[api/raffles/entries/create]", e);
    return NextResponse.json(
      { ok: false, message: "Error interno al registrar la compra" },
      { status: 500 }
    );
  }
}

/** HEAD para health checks desde proxies */
export async function HEAD() {
  return new NextResponse(null, { status: 204 });
}
