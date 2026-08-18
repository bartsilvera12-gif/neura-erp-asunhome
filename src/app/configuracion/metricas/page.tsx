"use client";

import MontoInput from "@/components/ui/MontoInput";
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

export default function ConfiguracionMetricasPage() {
  const { config, form, setForm, handleChange, handleGuardar, success, ready } = useGlobalConfigForm();

  if (!ready || !config || !form) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-slate-400">
        Cargando configuración…
      </div>
    );
  }

  return (
    <GlobalConfigSubpageShell
      title="Métricas"
      description="Metas mensuales usadas como referencia en tableros y seguimiento."
    >
      {success && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Configuración guardada correctamente.
        </div>
      )}

      <div className="space-y-5">
        <ConfigFormCard>
          <ConfigSectionTitle>Metas comerciales</ConfigSectionTitle>
          <p className="mb-4 text-xs leading-relaxed text-slate-400">
            Define los objetivos mensuales del equipo. Estos valores se usarán como referencia en el Dashboard para
            mostrar el progreso hacia cada meta.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={F_LABEL}>Meta de ventas mensuales (Gs.)</label>
              <MontoInput
                value={form.meta_ventas_mensuales}
                onChange={(n) => setForm((prev) => (prev ? { ...prev, meta_ventas_mensuales: n } : prev))}
                className={F_INPUT}
                decimals={false}
              />
              <ConfigHelpText>Ingreso total en ventas esperado cada mes.</ConfigHelpText>
            </div>
            <div>
              <label className={F_LABEL}>Meta de clientes nuevos / mes</label>
              <input
                type="number"
                name="meta_clientes_nuevos"
                value={form.meta_clientes_nuevos}
                onChange={handleChange}
                min={0}
                step={1}
                className={F_INPUT}
              />
              <ConfigHelpText>Cantidad de nuevos clientes a incorporar mensualmente.</ConfigHelpText>
            </div>
          </div>
        </ConfigFormCard>

        <ConfigFormCard>
          <ConfigSectionTitle>Metas financieras</ConfigSectionTitle>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={F_LABEL}>Meta de facturación mensual (Gs.)</label>
              <MontoInput
                value={form.meta_facturacion_mensual}
                onChange={(n) => setForm((prev) => (prev ? { ...prev, meta_facturacion_mensual: n } : prev))}
                className={F_INPUT}
                decimals={false}
              />
              <ConfigHelpText>Monto total de facturas emitidas esperado al mes.</ConfigHelpText>
            </div>
            <div>
              <label className={F_LABEL}>Meta de conversión de leads (%)</label>
              <div className="relative">
                <input
                  type="number"
                  name="meta_conversion_leads"
                  value={form.meta_conversion_leads}
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
              <ConfigHelpText>Porcentaje objetivo de leads que deben convertirse en clientes.</ConfigHelpText>
            </div>
          </div>
        </ConfigFormCard>

        <ConfigFormCard>
          <ConfigSectionTitle>Metas configuradas actualmente</ConfigSectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ConfigMetricCard label="Ventas / mes" value={`Gs. ${config.meta_ventas_mensuales.toLocaleString("es-PY")}`} />
            <ConfigMetricCard label="Clientes nuevos" value={config.meta_clientes_nuevos} sub="por mes" />
            <ConfigMetricCard
              label="Facturación / mes"
              value={`Gs. ${config.meta_facturacion_mensual.toLocaleString("es-PY")}`}
            />
            <ConfigMetricCard label="Conversión leads" value={`${config.meta_conversion_leads}%`} sub="objetivo" />
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
