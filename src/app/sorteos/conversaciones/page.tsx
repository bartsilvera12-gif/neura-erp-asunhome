import { redirect } from "next/navigation";

/** El inbox de chat vive en Dashboard → Conversaciones; evitamos duplicar la vista aquí. */
export default function SorteoConversacionesRedirectPage() {
  redirect("/dashboard/conversaciones");
}
