"use client";

import Link from "next/link";
import EmpresaForm from "@/components/empresas/EmpresaForm";

export default function NuevaEmpresaPage() {
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link href="/admin/empresas" className="hover:text-gray-700 transition-colors">
          Empresas
        </Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Nueva empresa</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Nueva empresa</h1>
        <p className="text-sm text-gray-500 mt-1">
          Crear empresa, usuario administrador y seleccionar módulos habilitados.
        </p>
      </div>

      <EmpresaForm />
    </div>
  );
}
