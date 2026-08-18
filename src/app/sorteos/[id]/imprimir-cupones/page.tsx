import { notFound } from "next/navigation";
import {
  fetchPhysicalCouponsForPrintServer,
  fetchSorteoNombreForEmpresaServer,
  type EntradaImpresionContext,
} from "@/lib/sorteos/physical-coupons-print";
import type { SorteoEntradaEstadoPago } from "@/lib/sorteos/types";
import PhysicalCouponsPrintClient from "./PhysicalCouponsPrintClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Sp = Record<string, string | string[] | undefined>;

function pickStr(sp: Sp, key: string): string {
  const v = sp[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v[0]) return v[0];
  return "";
}

function parseEstado(raw: string): SorteoEntradaEstadoPago {
  const t = raw.trim();
  if (
    t === "confirmado" ||
    t === "pendiente" ||
    t === "pendiente_revision" ||
    t === "rechazado"
  ) {
    return t;
  }
  return "confirmado";
}

export default async function ImprimirCuponesSorteoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Sp>;
}) {
  const { id: sorteoId } = await params;
  const sp = await Promise.resolve(searchParams ?? {});

  const sorteoNombre = await fetchSorteoNombreForEmpresaServer(sorteoId);
  if (!sorteoNombre) {
    notFound();
  }

  const q = pickStr(sp, "q").trim();
  const estado = parseEstado(pickStr(sp, "estado"));
  const fechaDesde = pickStr(sp, "fecha_desde").trim();
  const fechaHasta = pickStr(sp, "fecha_hasta").trim();
  const entradaIdRaw = pickStr(sp, "entrada_id").trim();

  const result = await fetchPhysicalCouponsForPrintServer({
    sorteoId,
    entradaId: entradaIdRaw || null,
    estadoPago: estado,
    q: q || null,
    fechaDesde: fechaDesde || null,
    fechaHasta: fechaHasta || null,
  });

  const entradaContext: EntradaImpresionContext | null = result.entrada_context ?? null;

  return (
    <PhysicalCouponsPrintClient
      sorteoId={sorteoId}
      sorteoNombre={sorteoNombre}
      rows={result.data}
      error={result.error}
      q={q}
      estado={estado}
      fechaDesde={fechaDesde}
      fechaHasta={fechaHasta}
      entradaId={entradaIdRaw || null}
      entradaContext={entradaContext}
    />
  );
}
