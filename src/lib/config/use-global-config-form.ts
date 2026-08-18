"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConfigGlobal } from "@/lib/config/types";
import { getConfig, resetConfig, saveConfig } from "@/lib/config/storage";
import { useAutoClearFlag } from "@/hooks/useAutoClearFlag";

export type GlobalConfigFormState = Omit<ConfigGlobal, "updated_at" | "updated_by">;

function formFromConfig(cfg: ConfigGlobal): GlobalConfigFormState {
  return {
    prefijo_factura: cfg.prefijo_factura,
    numeracion_inicial: cfg.numeracion_inicial,
    dias_vencimiento_default: cfg.dias_vencimiento_default,
    interes_moratorio: cfg.interes_moratorio,
    porcentaje_descuento_maximo: cfg.porcentaje_descuento_maximo,
    dias_retencion_cliente: cfg.dias_retencion_cliente,
    max_clientes_por_empresa: cfg.max_clientes_por_empresa,
    max_usuarios_por_empresa: cfg.max_usuarios_por_empresa,
    moneda_base: cfg.moneda_base,
    timezone: cfg.timezone,
    idioma_default: cfg.idioma_default,
    formato_fecha: cfg.formato_fecha,
    meta_ventas_mensuales: cfg.meta_ventas_mensuales,
    meta_clientes_nuevos: cfg.meta_clientes_nuevos,
    meta_facturacion_mensual: cfg.meta_facturacion_mensual,
    meta_conversion_leads: cfg.meta_conversion_leads,
  };
}

/**
 * Estado y persistencia de `Configuración Global` (localStorage) para páginas hijas bajo `/configuracion/*`.
 */
export function useGlobalConfigForm() {
  const [config, setConfig] = useState<ConfigGlobal | null>(null);
  const [form, setForm] = useState<GlobalConfigFormState | null>(null);
  // Antes: setSuccess(true) + setTimeout(...setSuccess(false), 3000) sin cleanup.
  // Si la pagina se desmontaba durante esos 3s, setState-after-unmount + memory leak.
  // useAutoClearFlag cancela el timer en cleanup automaticamente.
  const [successValue, setSuccessFlag] = useAutoClearFlag<true>(3000);
  const success = successValue === true;
  const setSuccess = (v: boolean) => setSuccessFlag(v ? true : null);

  const reload = useCallback(() => {
    const cfg = getConfig();
    setConfig(cfg);
    setForm(formFromConfig(cfg));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value, type } = e.target;
    setForm((prev) =>
      prev
        ? {
            ...prev,
            [name]: type === "number" ? parseFloat(value) || 0 : value,
          }
        : prev
    );
  }

  function handleGuardar() {
    if (!form) return;
    const saved = saveConfig(form);
    setConfig(saved);
    // useAutoClearFlag programa el reset a los 3s con cleanup seguro.
    setSuccess(true);
  }

  function handleResetFormToDefaults() {
    const cfg = resetConfig();
    setConfig(cfg);
    setForm(formFromConfig(cfg));
    setSuccess(true);
  }

  return {
    config,
    form,
    setForm,
    handleChange,
    handleGuardar,
    handleResetFormToDefaults,
    reload,
    success,
    ready: Boolean(config && form),
  };
}
