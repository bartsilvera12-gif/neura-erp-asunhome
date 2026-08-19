"use client";

import { memo, useEffect, useState } from "react";
import { formatWaitHuman } from "@/lib/chat/format-wait-human";

/**
 * Etiqueta que muestra "hace X tiempo" actualizándose cada segundo.
 *
 * Extraído de ConversacionesClient.tsx para:
 *  - Aislamiento: cada instancia tiene su propio setInterval(1s) + useState.
 *    Si esto vive como helper local del monolito, cualquier cambio en el padre
 *    re-monta más de lo necesario.
 *  - memo(): si el inbox tiene 100 conversaciones, cada una tiene su instancia
 *    de LiveElapsedLabel. memo evita re-renderizar la etiqueta cuando el padre
 *    re-renderea por algo no relacionado con esta fila (selectedId cambió, etc).
 *
 * Guard de visibility: si la pestaña está oculta no tiene sentido re-renderizar
 * cada segundo (timers siguen corriendo pero el setTick no dispara). Aplicado
 * desde el lote 1 de optimización.
 */

type Props = { sinceIso: string | null };

function LiveElapsedLabelInner({ sinceIso }: Props) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      setTick((x) => x + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!sinceIso) return <span className="text-slate-400">—</span>;
  return <span className="tabular-nums font-medium">{formatWaitHuman(sinceIso)}</span>;
}

export const LiveElapsedLabel = memo(LiveElapsedLabelInner);
