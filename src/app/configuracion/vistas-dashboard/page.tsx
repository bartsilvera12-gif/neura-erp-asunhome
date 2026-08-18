"use client";

import Link from "next/link";
import { GlobalConfigSubpageShell } from "@/components/config/GlobalConfigSubpageShell";
import { Building2, UserCircle } from "lucide-react";

/**
 * Hub de configuración de qué "pestañas" o vistas del inicio aplica la empresa
 * y qué ve cada usuario. No reemplaza la edición en Admin o Usuarios: enlaza a ambas.
 */
export default function VistasDashboardConfigPage() {
  return (
    <GlobalConfigSubpageShell
      title="Vistas del dashboard"
      description="Las vistas del inicio se definen a dos niveles: qué ofrece la empresa (catálogo habilitado) y qué ve cada usuario dentro de lo permitido."
    >
      <div className="space-y-6 max-w-3xl">
        <p className="text-sm text-slate-600">
          En el sistema, las <strong>vistas del tablero principal</strong> (ventas, cobros, caja, etc.) se administran
          en los datos de <strong>empresa</strong> (super admin) y en el perfil de cada <strong>usuario</strong>{" "}
          (administrador de la empresa), según el alcance de tu rol.
        </p>

        <div className="grid gap-4 sm:grid-cols-1">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-slate-900">
              <Building2 className="h-5 w-5 shrink-0" aria-hidden />
              <h2 className="text-base font-semibold">Nivel empresa (super admin)</h2>
            </div>
            <p className="text-sm text-slate-600">
              Elegir qué vistas del dashboard están <strong>habilitadas para la organización</strong> al editar la
              empresa (pestañas asociadas a la compañía).
            </p>
            <div className="mt-4">
              <Link
                href="/admin/empresas"
                className="inline-flex rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-100"
              >
                Ir a administración de empresas
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-slate-900">
              <UserCircle className="h-5 w-5 shrink-0" aria-hidden />
              <h2 className="text-base font-semibold">Nivel usuario (admin de empresa)</h2>
            </div>
            <p className="text-sm text-slate-600">
              Dentro de las vistas habilitadas en la empresa, asignar <strong>qué puede ver cada colaborador</strong> y
              la vista de inicio por defecto, editando al usuario en el listado.
            </p>
            <div className="mt-4">
              <Link
                href="/usuarios"
                className="inline-flex rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-100"
              >
                Ir a Usuarios
              </Link>
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-400">
          Nota: el botón de la tarjeta en Configuración global te trae a esta guía. Desde acá abrís el flujo que
          corresponda; no reemplazamos el listado de usuarios por un formulario aislado sin contexto.
        </p>
      </div>
    </GlobalConfigSubpageShell>
  );
}
