"use client";

import Image from "next/image";

/**
 * Pantalla de carga premium con el logo oficial ZENTRA centrado sobre
 * fondo turquesa de marca. La palabra "Cargando" tiene una animación
 * "wave" letra por letra con shimmer overlay, sutil pero llamativa.
 */
export default function ZentraLoader({
  label = "Cargando",
  fullscreen = true,
  overlay = false,
}: {
  label?: string;
  /** Si es true, ocupa min-h-screen. Si es false, se acomoda al contenedor. */
  fullscreen?: boolean;
  /** Si es true, queda como overlay fixed cubriendo toda la pantalla (z-200). */
  overlay?: boolean;
}) {
  const letters = Array.from(label);
  return (
    <div
      className={`flex flex-col items-center justify-center gap-7 bg-[#4FAEB2] ${
        overlay
          ? "fixed inset-0 z-[200] h-screen w-screen overflow-hidden"
          : "w-full"
      } ${fullscreen && !overlay ? "min-h-screen" : ""} ${
        !fullscreen && !overlay ? "min-h-[40vh] py-16" : ""
      }`}
      aria-busy="true"
      role="status"
    >
      {/* Halo radial sutil de fondo para darle profundidad al turquesa */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-0 opacity-70"
        style={{
          background:
            "radial-gradient(circle at 50% 40%, rgba(255,255,255,0.10), transparent 65%)",
        }}
      />
      <div className="relative z-10 h-32 w-[15rem] sm:h-40 sm:w-[18rem]">
        <Image
          src="/brand/zentra-logo-official.png"
          alt="ZENTRA"
          fill
          sizes="(min-width: 640px) 18rem, 15rem"
          className="object-contain object-center drop-shadow-[0_8px_30px_rgba(0,0,0,0.15)]"
          priority
        />
      </div>
      {/* "Cargando" con wave + shimmer */}
      <p
        className="zentra-loader-label relative z-10 inline-flex items-end gap-[0.18em] text-sm font-semibold tracking-[0.42em] text-white uppercase"
        aria-label={`${label}…`}
      >
        {letters.map((ch, i) => (
          <span
            key={`${ch}-${i}`}
            className="zentra-loader-letter inline-block will-change-transform"
            style={{ animationDelay: `${i * 90}ms` }}
            aria-hidden="true"
          >
            {ch === " " ? " " : ch}
          </span>
        ))}
        <span className="ml-[0.4em] inline-flex items-end gap-[0.25em]">
          <span
            className="zentra-loader-letter inline-block h-1 w-1 rounded-full bg-white"
            style={{ animationDelay: `${letters.length * 90}ms` }}
            aria-hidden="true"
          />
          <span
            className="zentra-loader-letter inline-block h-1 w-1 rounded-full bg-white"
            style={{ animationDelay: `${(letters.length + 1) * 90}ms` }}
            aria-hidden="true"
          />
          <span
            className="zentra-loader-letter inline-block h-1 w-1 rounded-full bg-white"
            style={{ animationDelay: `${(letters.length + 2) * 90}ms` }}
            aria-hidden="true"
          />
        </span>
      </p>
      <style jsx>{`
        .zentra-loader-letter {
          animation: zentraLetterWave 1400ms cubic-bezier(0.4, 0, 0.2, 1) infinite both;
        }
        @keyframes zentraLetterWave {
          0%,
          60%,
          100% {
            transform: translateY(0);
            opacity: 0.55;
            text-shadow: 0 0 0 rgba(255, 255, 255, 0);
          }
          30% {
            transform: translateY(-6px);
            opacity: 1;
            text-shadow: 0 6px 18px rgba(255, 255, 255, 0.35);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .zentra-loader-letter {
            animation: none;
            opacity: 1;
            transform: none;
          }
        }
      `}</style>
      <span className="sr-only">Cargando contenido…</span>
    </div>
  );
}
