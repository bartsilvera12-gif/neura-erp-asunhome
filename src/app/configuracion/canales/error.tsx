"use client";

/**
 * Captura fallos de render en esta ruta (p. ej. datos inesperados en omnicanal).
 * En producción Next oculta el mensaje original; el digest ayuda a correlacionar logs.
 */
export default function ConfiguracionCanalesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-xl rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-900 space-y-3">
      <p className="font-semibold">No se pudo mostrar Canales y comunicación.</p>
      <p className="text-red-800/95 leading-relaxed">
        Suele deberse a un fallo temporal al cargar datos o a una respuesta inválida del servidor. Podés
        reintentar; si sigue igual, pasá al equipo el código{" "}
        <code className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-xs">{error.digest ?? "—"}</code> para
        revisar los logs de Vercel.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-lg bg-[#0EA5E9] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0284C7]"
      >
        Reintentar
      </button>
    </div>
  );
}
