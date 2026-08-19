"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Chart de cobrado por día — extraído del dashboard root (page.tsx) para que
 * recharts (~90 KB gzipped) NO entre al bundle inicial. El padre hace:
 *
 *   const ChartCobradoPorDia = dynamic(
 *     () => import("@/app/_components/ChartCobradoPorDia"),
 *     { ssr: false, loading: () => <div className="h-[300px]" /> }
 *   );
 *
 * Y recharts se descarga solo cuando el user entra al tab "Financiero".
 *
 * Por qué un archivo aparte (y no dynamic() directo en page.tsx): recharts
 * hace introspección de children por tipo (LineChart inspecciona XAxis/YAxis
 * por className). Si los envolvés con next/dynamic individualmente, los hijos
 * se vuelven componentes proxy y la introspección falla → no renderea ejes.
 * Solución: dynamic-importar el chart COMPLETO como una sola unidad.
 */

type Punto = {
  fecha: string; // YYYY-MM-DD
  monto: number;
  count: number;
};

type Props = {
  data: Punto[];
  accentColor: string;
  formatGs: (n: number) => string;
  formatGsM: (n: number) => string;
  formatFecha: (s: string) => string;
};

export default function ChartCobradoPorDia({
  data,
  accentColor,
  formatGs,
  formatGsM,
  formatFecha,
}: Props) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="#e2e8f0" vertical={false} />
        <XAxis
          dataKey="fecha"
          tick={{ fill: "#64748b", fontSize: 10 }}
          tickLine={false}
          axisLine={{ stroke: "#cbd5e1" }}
          tickFormatter={(ymd: string) => {
            if (!ymd || ymd.length < 10) return ymd;
            return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
          }}
          minTickGap={28}
        />
        <YAxis
          tick={{ fill: "#64748b", fontSize: 10 }}
          tickLine={false}
          axisLine={{ stroke: "#cbd5e1" }}
          tickFormatter={(v: number) => formatGsM(Number(v))}
          width={52}
        />
        <Tooltip
          cursor={{ stroke: "rgba(37,99,235,0.25)", strokeWidth: 1 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0].payload as Punto;
            return (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 shadow-lg">
                <p className="font-medium text-slate-500">{formatFecha(row.fecha)}</p>
                <p className="mt-1.5 text-sm font-semibold tabular-nums text-slate-900">
                  Gs. {formatGs(row.monto)}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {row.count} pago{row.count === 1 ? "" : "s"}
                </p>
              </div>
            );
          }}
        />
        <Line
          type="monotone"
          dataKey="monto"
          stroke={accentColor}
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 5, fill: accentColor, stroke: "#fff", strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
