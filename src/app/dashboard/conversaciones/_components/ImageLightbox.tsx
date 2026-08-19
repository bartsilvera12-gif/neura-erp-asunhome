"use client";

import { memo } from "react";

/**
 * Modal lightbox para ampliar una imagen del chat. Click fuera o en el botón
 * cierra. Click en la imagen NO cierra (stopPropagation).
 *
 * Extraído de ConversacionesClient.tsx + memo() porque el padre re-rendea
 * muy seguido (cada mensaje nuevo, cada selección, cada polling). Sin memo,
 * el lightbox se re-renderea aunque la URL no haya cambiado, generando
 * micro-jank al hacer cualquier acción mientras está abierto.
 */

type Props = {
  url: string | null;
  onClose: () => void;
};

function ImageLightboxInner({ url, onClose }: Props) {
  if (!url) return null;
  return (
    <button
      type="button"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 border-0 cursor-zoom-out"
      onClick={onClose}
      aria-label="Cerrar vista ampliada"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Vista ampliada"
        className="max-h-[92vh] max-w-full object-contain rounded-lg shadow-2xl"
        onClick={(ev) => ev.stopPropagation()}
      />
    </button>
  );
}

export const ImageLightbox = memo(ImageLightboxInner);
