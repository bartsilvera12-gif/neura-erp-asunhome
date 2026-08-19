"use client";

import Link from "next/link";
import { Plus } from "lucide-react";

/**
 * Floating Action Button — solo mobile (md:hidden).
 *
 * Botón flotante grande para la acción primaria de una pantalla (ej: "+" en
 * /ventas que va a /ventas/nueva). Patrón Material Design / Google: la
 * acción más usada accesible en 1 tap desde cualquier posición de scroll.
 *
 * Position fixed bottom-right, por encima del MobileBottomNav (z-30 vs nav z-40,
 * pero offset de bottom-20 para no superponerse).
 *
 * Tap target generoso: 56x56px (recomendación M3). Sombra para indicar
 * elevación. Color turquesa Zentra. Animación al tap.
 */

type Props = {
  href: string;
  label: string;
  /** Override del bottom offset si necesitás cambiarlo (ej: footer extra alto) */
  bottomOffset?: string;
};

export default function MobileFab({ href, label, bottomOffset = "bottom-20" }: Props) {
  return (
    <Link
      href={href}
      className={`fixed right-4 ${bottomOffset} z-30 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#4FAEB2] text-white shadow-lg shadow-[#4FAEB2]/40 transition-all active:scale-95 active:bg-[#3F8E91] lg:hidden`}
      aria-label={label}
      title={label}
    >
      <Plus className="h-6 w-6" strokeWidth={2.5} aria-hidden />
    </Link>
  );
}
