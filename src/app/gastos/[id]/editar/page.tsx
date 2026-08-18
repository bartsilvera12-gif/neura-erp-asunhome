"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getGastos } from "@/lib/gastos/actions";
import GastoForm from "@/components/gastos/GastoForm";
import type { Gasto } from "@/lib/gastos/actions";

export default function EditarGastoPage() {
  const params = useParams();
  const id = String(params?.id ?? "");
  const [gasto, setGasto] = useState<Gasto | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    getGastos()
      .then((lista) => setGasto(lista.find((g) => g.id === id) ?? null))
      .catch(() => setGasto(null))
      .finally(() => setCargando(false));
  }, [id]);

  if (cargando) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Link href="/gastos" className="hover:text-gray-700 transition-colors">
            Gastos
          </Link>
          <span>/</span>
          <span className="text-gray-700 font-medium">Cargando…</span>
        </div>
        <div className="py-16 text-center text-gray-400 text-sm animate-pulse">Cargando…</div>
      </div>
    );
  }

  if (!gasto) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Link href="/gastos" className="hover:text-gray-700 transition-colors">
            Gastos
          </Link>
          <span>/</span>
          <span className="text-gray-700 font-medium">No encontrado</span>
        </div>
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          Gasto no encontrado
        </div>
        <Link href="/gastos" className="text-sm text-[#0EA5E9] hover:underline">
          ← Volver a gastos
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link href="/gastos" className="hover:text-gray-700 transition-colors">
          Gastos
        </Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Editar</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Editar gasto</h1>
        <p className="text-sm text-gray-500 mt-1">
          {gasto.categoria || gasto.descripcion || "Gasto"}
        </p>
      </div>

      <GastoForm gasto={gasto} />
    </div>
  );
}
