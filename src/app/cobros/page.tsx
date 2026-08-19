import { redirect } from "next/navigation";

/**
 * La interfaz de cuentas por cobrar / cobros vive ahora dentro del módulo Pagos.
 * Se conserva /cobros solo como redirección por compatibilidad de enlaces.
 */
export default function CobrosRedirect() {
  redirect("/pagos");
}
