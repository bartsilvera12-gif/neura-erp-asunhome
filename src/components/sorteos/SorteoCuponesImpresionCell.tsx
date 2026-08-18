import Link from "next/link";

export default function SorteoCuponesImpresionCell({
  sorteoId,
  entradaId,
  cuponesImpresosAt,
}: {
  sorteoId: string;
  entradaId: string;
  cuponesImpresosAt: string | null;
}) {
  const href = `/sorteos/${encodeURIComponent(sorteoId)}/imprimir-cupones?entrada_id=${encodeURIComponent(entradaId)}`;

  if (cuponesImpresosAt) {
    return (
      <Link
        href={href}
        className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900 hover:bg-emerald-200"
      >
        Impreso
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-950 hover:bg-amber-200"
    >
      Pendiente
    </Link>
  );
}
