"use client";

import Link from "next/link";
import { useEffect } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * Selector de tipo de canal al hacer clic en "Conectar canal".
 * Solo WhatsApp crea canal real; el resto deshabilitado hasta implementación.
 */
export function ConectarCanalModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="conectar-canal-title"
        className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
      >
        <h2 id="conectar-canal-title" className="text-lg font-bold text-slate-900">
          Conectar canal
        </h2>
        <p className="text-sm text-slate-500 mt-1">Elegí el tipo de canal que querés conectar a tu empresa.</p>

        <ul className="mt-5 space-y-2 list-none p-0 m-0">
          <li>
            <Link
              href="/configuracion/canales/nuevo"
              onClick={onClose}
              className="flex w-full items-center justify-between rounded-xl border-2 border-[#0EA5E9] bg-sky-50 px-4 py-3 text-left font-semibold text-slate-900 hover:bg-sky-100 transition-colors"
            >
              <span>WhatsApp (Meta)</span>
              <span className="text-[11px] font-bold uppercase text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                Activo
              </span>
            </Link>
          </li>
          <li>
            <button
              type="button"
              disabled
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-slate-400 cursor-not-allowed"
            >
              <span>Instagram</span>
              <span className="text-[10px] font-semibold uppercase text-slate-400">Próximamente</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              disabled
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-slate-400 cursor-not-allowed"
            >
              <span>Facebook</span>
              <span className="text-[10px] font-semibold uppercase text-slate-400">Próximamente</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              disabled
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-slate-400 cursor-not-allowed"
            >
              <span>Email</span>
              <span className="text-[10px] font-semibold uppercase text-slate-400">Próximamente</span>
            </button>
          </li>
        </ul>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
