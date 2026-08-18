import { Suspense } from "react";
import { CanalesHubInner } from "./CanalesHubInner";

/** Evita prerender estático; la vista usa search params en el cliente. */
export const dynamic = "force-dynamic";

/**
 * Server Component que envuelve `CanalesHubInner` en Suspense.
 * No marcar esta página como "use client": en App Router, `useSearchParams()` dentro del hijo
 * cliente debe colgar de un boundary Suspense cuyo padre sea Server Component; si el padre es
 * cliente, en producción Next puede fallar el render con el mensaje genérico de error en RSC.
 */
export default function ConfiguracionCanalesHubPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-24 text-sm text-slate-400">Cargando…</div>}>
      <CanalesHubInner />
    </Suspense>
  );
}
