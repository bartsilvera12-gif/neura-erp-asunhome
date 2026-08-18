import { redirect } from "next/navigation";

/** El módulo operativo pasó a Monitoreo (`/dashboard/monitoreo`). */
export default function ColasAgentesRedirectPage() {
  redirect("/dashboard/monitoreo");
}
