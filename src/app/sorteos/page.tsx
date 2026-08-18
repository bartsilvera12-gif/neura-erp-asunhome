import SorteosListClient from "./SorteosListClient";
import { getSorteosVentasKpis } from "@/lib/sorteos/ventas-kpis";

/** KPIs dependen de sesión y ventana calendario Paraguay; evitar cache estático de respuestas en 0. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SorteosPage() {
  let ventasKpis = {
    boletosHoy: 0,
    boletosMes: 0,
    montoHoy: 0,
    montoMes: 0,
  };
  try {
    ventasKpis = await getSorteosVentasKpis();
  } catch {
    /* sin sesión o error de red: KPIs en cero */
  }
  return <SorteosListClient ventasKpis={ventasKpis} />;
}
