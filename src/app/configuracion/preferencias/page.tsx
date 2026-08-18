"use client";

import { useState } from "react";
import {
  ConfigFormCard,
  ConfigHelpText,
  ConfigMetricCard,
  ConfigSectionTitle,
  F_LABEL,
  F_SELECT,
} from "@/components/config/global-config-primitives";
import { GlobalConfigSubpageShell } from "@/components/config/GlobalConfigSubpageShell";
import { useGlobalConfigForm } from "@/lib/config/use-global-config-form";

export default function ConfiguracionPreferenciasPage() {
  const { config, form, handleChange, handleGuardar, handleResetFormToDefaults, success, ready } =
    useGlobalConfigForm();
  const [showReset, setShowReset] = useState(false);

  if (!ready || !config || !form) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-slate-400">
        Cargando configuración…
      </div>
    );
  }

  const idiomaLabel =
    ({ es: "Español", en: "English", pt: "Português" } as const)[config.idioma_default] ?? config.idioma_default;

  return (
    <GlobalConfigSubpageShell
      title="Preferencias"
      description="Moneda base, formato de fecha, zona horaria e idioma por defecto."
    >
      {success && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Configuración guardada correctamente.
        </div>
      )}

      <div className="space-y-5">
        <ConfigFormCard>
          <ConfigSectionTitle>Moneda y región</ConfigSectionTitle>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={F_LABEL}>Moneda base del sistema</label>
              <select name="moneda_base" value={form.moneda_base} onChange={handleChange} className={F_SELECT}>
                <option value="GS">Guaraníes (GS)</option>
                <option value="USD">Dólares (USD)</option>
                <option value="BRL">Reales (BRL)</option>
                <option value="ARS">Pesos argentinos (ARS)</option>
              </select>
              <ConfigHelpText>Moneda utilizada por defecto en todos los módulos financieros.</ConfigHelpText>
            </div>
            <div>
              <label className={F_LABEL}>Formato de fecha</label>
              <select name="formato_fecha" value={form.formato_fecha} onChange={handleChange} className={F_SELECT}>
                <option value="DD/MM/YYYY">DD/MM/YYYY (ej: 09/03/2026)</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY (ej: 03/09/2026)</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD (ej: 2026-03-09)</option>
              </select>
              <ConfigHelpText>Formato de presentación de fechas en toda la interfaz.</ConfigHelpText>
            </div>
          </div>
        </ConfigFormCard>

        <ConfigFormCard>
          <ConfigSectionTitle>Localización</ConfigSectionTitle>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={F_LABEL}>Zona horaria</label>
              <select name="timezone" value={form.timezone} onChange={handleChange} className={F_SELECT}>
                <option value="America/Asuncion">América/Asunción (Paraguay, UTC-4)</option>
                <option value="America/Sao_Paulo">América/São Paulo (Brasil, UTC-3)</option>
                <option value="America/Buenos_Aires">América/Buenos Aires (Argentina, UTC-3)</option>
                <option value="America/Lima">América/Lima (Perú, UTC-5)</option>
                <option value="America/Bogota">América/Bogotá (Colombia, UTC-5)</option>
              </select>
              <ConfigHelpText>Zona horaria usada para registrar fechas y horas en el sistema.</ConfigHelpText>
            </div>
            <div>
              <label className={F_LABEL}>Idioma por defecto</label>
              <select name="idioma_default" value={form.idioma_default} onChange={handleChange} className={F_SELECT}>
                <option value="es">Español</option>
                <option value="en">English</option>
                <option value="pt">Português</option>
              </select>
              <ConfigHelpText>Idioma predeterminado para nuevos usuarios del sistema.</ConfigHelpText>
            </div>
          </div>
        </ConfigFormCard>

        <ConfigFormCard>
          <ConfigSectionTitle>Configuración activa</ConfigSectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ConfigMetricCard label="Moneda base" value={config.moneda_base} />
            <ConfigMetricCard label="Formato fecha" value={config.formato_fecha} />
            <ConfigMetricCard label="Zona horaria" value={config.timezone.split("/")[1] ?? config.timezone} />
            <ConfigMetricCard label="Idioma" value={idiomaLabel} />
          </div>
        </ConfigFormCard>

        <ConfigFormCard>
          <div className="mb-4 flex items-center gap-2 border-b border-red-50 pb-2">
            <span className="text-base">⚠️</span>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Zona peligrosa</h4>
          </div>
          {!showReset ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-700">Restaurar valores por defecto</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  Restablece toda la configuración global a los valores originales del sistema.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowReset(true)}
                className="shrink-0 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
              >
                Restaurar
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-medium text-red-700">
                ¿Confirmar restauración de toda la configuración global a valores por defecto? Esta acción no se puede
                deshacer.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => {
                    handleResetFormToDefaults();
                    setShowReset(false);
                  }}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
                >
                  Sí, restaurar
                </button>
                <button
                  type="button"
                  onClick={() => setShowReset(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
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
