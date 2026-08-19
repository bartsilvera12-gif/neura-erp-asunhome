"use client";

import { useCallback, useEffect, useState } from "react";
import ProyectoDetalleInner from "./ProyectoDetalleInner";

export default function ProyectoDetalleModal({
  projectId,
  open,
  onClose,
  onUpdated,
}: {
  projectId: string | null;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open) setDirty(false);
  }, [open]);

  const requestClose = useCallback(() => {
    if (dirty) {
      if (!window.confirm("Hay cambios sin guardar en Datos. ¿Cerrar igualmente?")) return;
    }
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      requestClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, requestClose]);

  if (!open || !projectId) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        aria-label="Cerrar modal"
        className="absolute inset-0 bg-slate-900/55 backdrop-blur-sm"
        onClick={requestClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="proyecto-detalle-titulo"
        className="relative flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/20"
      >
        <ProyectoDetalleInner
          projectId={projectId}
          variant="modal"
          onClose={requestClose}
          onProjectUpdated={onUpdated}
          onDirtyChange={setDirty}
        />
      </div>
    </div>
  );
}
