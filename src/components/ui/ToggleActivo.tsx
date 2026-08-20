"use client";

/**
 * Interruptor Activo Sí/No de las tablas de maestros.
 *
 * Se ve como botón —borde, sombra y punto de estado— porque el chip plano
 * anterior no se leía como algo clickeable. Vive acá para que todas las
 * pantallas de maestros muestren exactamente el mismo control.
 */
export default function ToggleActivo({
  activo,
  onToggle,
  disabled = false,
  etiquetas = { si: "Sí", no: "No" },
}: {
  activo: boolean;
  onToggle: () => void;
  disabled?: boolean;
  etiquetas?: { si: string; no: string };
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={activo}
      title={activo ? "Desactivar" : "Activar"}
      className={`inline-flex min-w-[3.25rem] items-center justify-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold shadow-sm transition-colors disabled:opacity-50 ${
        activo
          ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          : "border-slate-300 bg-slate-50 text-slate-500 hover:bg-slate-100"
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${activo ? "bg-emerald-500" : "bg-slate-400"}`}
      />
      {activo ? etiquetas.si : etiquetas.no}
    </button>
  );
}
