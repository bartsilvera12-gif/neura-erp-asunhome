"use client";

import { useEffect, useState } from "react";

/**
 * Pantalla de carga global — En lo de Mari.
 * Fondo teal con gradiente + logo Z animado (las dos mitades se separan y
 * vuelven a su sitio) + texto "Z E N T R A".
 *
 * Maneja su propia animación de salida con fade-out + min-duration para
 * cubrir el lag entre que termina la auth y el sidebar/dashboard renderiza.
 */
export default function AppLoadingScreen({
  active = true,
  minDurationMs = 1200,
  fadeOutMs = 400,
}: {
  /** Mientras true, el overlay se mantiene visible. Al volverse false, espera el resto del minDuration y hace fade-out. */
  active?: boolean;
  minDurationMs?: number;
  fadeOutMs?: number;
}) {
  const [mounted, setMounted] = useState(true);
  const [visible, setVisible] = useState(true);
  const [mountedAt] = useState(() => Date.now());

  useEffect(() => {
    if (active) {
      setVisible(true);
      setMounted(true);
      return;
    }
    const elapsed = Date.now() - mountedAt;
    const remaining = Math.max(0, minDurationMs - elapsed);
    const hideTimer = setTimeout(() => setVisible(false), remaining);
    const unmountTimer = setTimeout(() => setMounted(false), remaining + fadeOutMs);
    return () => {
      clearTimeout(hideTimer);
      clearTimeout(unmountTimer);
    };
  }, [active, mountedAt, minDurationMs, fadeOutMs]);

  if (!mounted) return null;

  return (
    <div
      className="app-loading-bg fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{
        opacity: visible ? 1 : 0,
        transition: `opacity ${fadeOutMs}ms ease-out`,
        pointerEvents: visible ? "auto" : "none",
      }}
      aria-hidden={!visible}
    >
      <ZentraLogo />
      <p
        className="mt-10 text-xs font-semibold text-white/85"
        style={{ letterSpacing: "0.5em" }}
      >
        C A R G A N D O
        <span className="app-loading-dots" aria-hidden>...</span>
      </p>
    </div>
  );
}

function ZentraLogo() {
  // El logo se compone de dos chevrons que se separan ligeramente y vuelven a
  // unirse en loop (animación en globals.css: .app-loading-z-top / .app-loading-z-bot).
  return (
    <div className="flex flex-col items-center gap-4">
      <svg
        viewBox="0 0 200 200"
        className="h-28 w-28 drop-shadow-[0_4px_18px_rgba(0,0,0,0.25)]"
        aria-label="Zentra"
      >
        <g fill="#FFFFFF">
          <polygon className="app-loading-z-top" points="8,12 192,12 192,52 122,92 8,92" />
          <polygon className="app-loading-z-bot" points="78,108 192,108 192,188 8,188 8,148" />
        </g>
      </svg>
      <span
        className="text-xl font-bold text-white"
        style={{ letterSpacing: "0.55em", paddingLeft: "0.55em" }}
      >
        ZENTRA
      </span>
    </div>
  );
}
