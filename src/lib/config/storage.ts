import type { ConfigGlobal } from "./types";

// ─── Valores por defecto ──────────────────────────────────────────────────────

const CONFIG_DEFAULT: ConfigGlobal = {
  // Facturación
  prefijo_factura:          "FAC-",
  numeracion_inicial:       1,
  dias_vencimiento_default: 30,
  interes_moratorio:        1.5,          // 1.5% mensual

  // Políticas
  porcentaje_descuento_maximo: 20,        // máx 20%
  dias_retencion_cliente:      180,       // 6 meses
  max_clientes_por_empresa:    0,         // 0 = ilimitado
  max_usuarios_por_empresa:    0,         // 0 = ilimitado

  // Preferencias
  moneda_base:    "GS",
  timezone:       "America/Asuncion",
  idioma_default: "es",
  formato_fecha:  "DD/MM/YYYY",

  // Metas
  meta_ventas_mensuales:    50_000_000,
  meta_clientes_nuevos:     10,
  meta_facturacion_mensual: 80_000_000,
  meta_conversion_leads:    25,

  updated_at: new Date().toISOString(),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const KEY = "neura_config";

function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeSet<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // silent
  }
}

// ─── API pública ──────────────────────────────────────────────────────────────

export function getConfig(): ConfigGlobal {
  const stored = safeGet<Partial<ConfigGlobal>>(KEY, {});
  // Merge con defaults: garantiza todos los campos aunque el storage sea viejo
  return { ...CONFIG_DEFAULT, ...stored };
}

export function saveConfig(
  datos: Omit<ConfigGlobal, "updated_at" | "updated_by">,
  updatedBy?: string
): ConfigGlobal {
  const config: ConfigGlobal = {
    ...datos,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  };
  safeSet(KEY, config);
  return config;
}

export function resetConfig(): ConfigGlobal {
  const config: ConfigGlobal = {
    ...CONFIG_DEFAULT,
    updated_at: new Date().toISOString(),
  };
  safeSet(KEY, config);
  return config;
}
