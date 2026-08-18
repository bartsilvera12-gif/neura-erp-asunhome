"use client";

/** Formatea número con separador de miles (Paraguay: 1.200.000) */
export function formatMontoDisplay(value: number | string, decimals = true): string {
  const n = typeof value === "string" ? parseMontoInput(value) : value;
  if (isNaN(n) || (typeof value === "number" && isNaN(value))) return "";
  return n.toLocaleString("es-PY", {
    minimumFractionDigits: decimals ? 0 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  });
}

/** Parsea string con formato a número (acepta "1.200.000", "1.234,50", "1234.56") */
export function parseMontoInput(value: string): number {
  if (!value || !value.trim()) return 0;
  const v = value.replace(/\s/g, "");
  if (v.includes(",")) {
    const [intPart, decPart] = v.split(",");
    const n = parseFloat((intPart || "").replace(/\./g, "") + "." + (decPart || "0"));
    return isNaN(n) ? 0 : n;
  }
  const parts = v.split(".");
  if (parts.length === 1) return parseFloat(parts[0]) || 0;
  const last = parts[parts.length - 1] || "";
  if (last.length <= 2 && /^\d+$/.test(last)) {
    return parseFloat(parts.slice(0, -1).join("") + "." + last) || 0;
  }
  return parseFloat(parts.join("")) || 0;
}

type MontoInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: number | string;
  onChange: (value: number) => void;
  /** Si true, permite decimales. Default: true */
  decimals?: boolean;
};

/**
 * Input de monto con separador de miles.
 * Muestra el valor formateado (ej: 1.200.000) y emite el número al cambiar.
 */
export default function MontoInput({
  value,
  onChange,
  decimals = true,
  className = "",
  ...rest
}: MontoInputProps) {
  const numValue = typeof value === "string"
    ? (value === "" ? 0 : parseMontoInput(value))
    : Number(value) || 0;
  const display = (typeof value === "string" && value === "") ? "" : formatMontoDisplay(numValue, decimals);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = parseMontoInput(e.target.value);
    onChange(n);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      onChange={handleChange}
      className={className}
      {...rest}
    />
  );
}
