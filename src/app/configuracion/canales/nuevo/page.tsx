import { Suspense } from "react";
import { NuevoCanalInner } from "./NuevoCanalInner";

export default function NuevoCanalPage() {
  return (
    <Suspense fallback={<div className="py-24 text-center text-sm text-slate-400">Cargando…</div>}>
      <NuevoCanalInner />
    </Suspense>
  );
}
