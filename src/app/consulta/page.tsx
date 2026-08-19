/**
 * Backward-compat: /consulta era el nombre viejo del modulo. Ahora vive
 * como 'Pedidos'. Redirect server-side para preservar bookmarks.
 */
import { redirect } from "next/navigation";

export default function ConsultaPage() {
  redirect("/pedidos");
}
