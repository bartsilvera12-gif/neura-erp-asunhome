"use client";

import {
  ConfigFormCard,
  ConfigHelpText,
  ConfigMetricCard,
  ConfigSectionTitle,
  F_INPUT,
  F_LABEL,
} from "@/components/config/global-config-primitives";
import { GlobalConfigSubpageShell } from "@/components/config/GlobalConfigSubpageShell";
import { useGlobalConfigForm } from "@/lib/config/use-global-config-form";

export default function ConfiguracionPoliticasPage() {
  const { config, form, handleChange, handleGuardar, success, ready } = useGlobalConfigForm();

  if (!ready || !config || !form) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-slate-400">
        Cargando configuración…
      </div>
    );
  }

  return (
    <GlobalConfigSubpageShell
      title="Políticas del sistema"
      description="Descuentos, retención de clientes y límites por empresa."
    >
      {success && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Configuración guardada correctamente.
        </div>
      )}

      <div className="space-y-5">
        <ConfigFormCard>
          <ConfigSectionTitle>Control comercial</ConfigSectionTitle>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={F_LABEL}>Descuento máximo permitido</label>
              <div className="relative">
                <input
                  type="number"
                  name="porcentaje_descuento_maximo"
                  value={form.porcentaje_descuento_maximo}
                  onChange={handleChange}
                  min={0}
                  max={100}
                  step={0.5}
                  className={F_INPUT}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                  %
                </span>
              </div>
              <ConfigHelpText>
                Porcentaje máximo que cualquier usuario puede aplicar como descuento en ventas. 0 = sin descuento.
              </ConfigHelpText>
            </div>
            <div>
              <label className={F_LABEL}>Días de retención de cliente</label>
              <div className="relative">
                <input
                  type="number"
                  name="dias_retencion_cliente"
                  value={form.dias_retencion_cliente}
                  onChange={handleChange}
                  min={0}
                  step={1}
                  className={F_INPUT}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                  días
                </span>
              </div>
              <ConfigHelpText>
                Días de inactividad antes de que un cliente sea marcado como inactivo automáticamente. 0 = desactivado.
              </ConfigHelpText>
            </div>
          </div>
        </ConfigFormCard>

        <ConfigFormCard>
          <ConfigSectionTitle>Límites por empresa</ConfigSectionTitle>
          <p className="mb-4 text-xs leading-relaxed text-slate-400">
            Define el máximo de registros permitidos por empresa dentro de la plataforma. Ingresa{" "}
            <strong>0</strong> para indicar que el límite es <strong>ilimitado</strong>.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={F_LABEL}>Máximo de clientes por empresa</label>
              <input
                type="number"
                name="max_clientes_por_empresa"
                value={form.max_clientes_por_empresa}
                onChange={handleChange}
                min={0}
                step={1}
                placeholder="0 = ilimitado"
                className={F_INPUT}
              />
              <ConfigHelpText>Límite de clientes que puede registrar cada empresa en el sistema.</ConfigHelpText>
            </div>
            <div>
              <label className={F_LABEL}>Máximo de usuarios por empresa</label>
              <input
                type="number"
                name="max_usuarios_por_empresa"
                value={form.max_usuarios_por_empresa}
                onChange={handleChange}
                min={0}
                step={1}
                placeholder="0 = ilimitado"
                className={F_INPUT}
              />
              <ConfigHelpText>Límite de usuarios activos que puede gestionar cada empresa.</ConfigHelpText>
            </div>
          </div>
        </ConfigFormCard>

        <ConfigFormCard>
          <ConfigSectionTitle>Resumen actual</ConfigSectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ConfigMetricCard
              label="Descuento máx."
              value={`${config.porcentaje_descuento_maximo}%`}
              sub={config.porcentaje_descuento_maximo === 0 ? "Sin descuento" : undefined}
            />
            <ConfigMetricCard
              label="Retención cliente"
              value={
                config.dias_retencion_cliente === 0 ? "Desactivado" : `${config.dias_retencion_cliente} días`
              }
            />
            <ConfigMetricCard
              label="Máx. clientes"
              value={config.max_clientes_por_empresa === 0 ? "Ilimitado" : config.max_clientes_por_empresa}
            />
            <ConfigMetricCard
              label="Máx. usuarios"
              value={config.max_usuarios_por_empresa === 0 ? "Ilimitado" : config.max_usuarios_por_empresa}
            />
          </div>
        </ConfigFormCard>

        <div className="flex flex-wrap items-center gap-4 pt-2">
          <button
            type="button"
            onClick={handleGuardar}
            className="rounded-lg bg-[#0EA5E9] px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#0284C7] active:scale-95"
          >
            Guardar configuración
          </button>
          <p className="text-xs text-slate-400">Los cambios se aplican de inmediato en todo el sistema.</p>
        </div>
      </div>
    </GlobalConfigSubpageShell>
  );
}
