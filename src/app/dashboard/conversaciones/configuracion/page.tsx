import { redirect } from "next/navigation";

/** Compatibilidad: la gestión de canales vive solo en /configuracion/canales */
export default function DashboardConversacionesConfigRedirectPage() {
  redirect("/configuracion/canales");
}
