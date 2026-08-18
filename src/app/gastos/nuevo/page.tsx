"use client";

import Link from "next/link";
import GastoForm from "@/components/gastos/GastoForm";

export default function NuevoGastoPage() {
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link href="/gastos" className="hover:text-gray-700 transition-colors">
          Gastos
        </Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Nuevo gasto</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Nuevo gasto</h1>
        <p className="text-sm text-gray-500 mt-1">Registrar un gasto operativo</p>
      </div>

      <GastoForm />
    </div>
  );
}
