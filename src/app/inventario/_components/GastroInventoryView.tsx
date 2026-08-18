"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Package, AlertCircle, ChefHat, Loader2 } from "lucide-react";
import type { Producto } from "@/lib/inventario/types";

type GastroFilter = "todos" | "vendibles" | "insumos" | "mixtos" | "stock_critico" | "sin_costo";

function classifyProducto(p: Producto): "vendible" | "insumo" | "mixto" | "sin" {
  const v = p.es_vendible !== false;
  const i = p.es_insumo === true;
  if (v && i) return "mixto";
  if (i) return "insumo";
  if (v) return "vendible";
  return "sin";
}

function badge(tipo: ReturnType<typeof classifyProducto>) {
  const map = {
    vendible: { label: "Vendible", cls: "bg-sky-100 text-sky-700" },
    insumo: { label: "Insumo", cls: "bg-emerald-100 text-emerald-700" },
    mixto: { label: "Mixto", cls: "bg-purple-100 text-purple-700" },
    sin: { label: "Sin clasificar", cls: "bg-gray-200 text-gray-600" },
  } as const;
  return map[tipo];
}

function fmtGs(n: number) {
  return "Gs. " + Number(n || 0).toLocaleString("es-PY", { maximumFractionDigits: 0 });
}

export default function GastroInventoryView({
  productos,
  loading,
}: {
  productos: Producto[];
  loading: boolean;
}) {
  const [filtro, setFiltro] = useState<GastroFilter>("todos");

  const stats = useMemo(() => {
    let total = 0,
      insumos = 0,
      vendibles = 0,
      mixtos = 0,
      stockCritico = 0,
      sinClas = 0;
    for (const p of productos) {
      total += 1;
      const t = classifyProducto(p);
      if (t === "insumo") insumos += 1;
      else if (t === "vendible") vendibles += 1;
      else if (t === "mixto") mixtos += 1;
      else sinClas += 1;
      if ((p.controla_stock !== false) && p.stock_actual <= p.stock_minimo) stockCritico += 1;
    }
    return { total, insumos, vendibles, mixtos, stockCritico, sinClas };
  }, [productos]);

  const filtrados = useMemo(() => {
    return productos.filter((p) => {
      const t = classifyProducto(p);
      const ctrlStock = p.controla_stock !== false;
      switch (filtro) {
        case "vendibles":
          return t === "vendible";
        case "insumos":
          return t === "insumo";
        case "mixtos":
          return t === "mixto";
        case "stock_critico":
          return ctrlStock && p.stock_actual <= p.stock_minimo;
        case "sin_costo":
          return !p.costo_promedio || p.costo_promedio <= 0;
        default:
          return true;
      }
    });
  }, [productos, filtro]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-10 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cards resumen */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Total" value={stats.total} icon={<Package className="h-4 w-4 text-gray-500" />} />
        <StatCard label="Vendibles" value={stats.vendibles} dot="bg-sky-500" />
        <StatCard label="Insumos" value={stats.insumos} dot="bg-emerald-500" />
        <StatCard label="Mixtos" value={stats.mixtos} dot="bg-purple-500" />
        <StatCard
          label="Stock crítico"
          value={stats.stockCritico}
          icon={<AlertCircle className="h-4 w-4 text-red-500" />}
          highlight={stats.stockCritico > 0}
        />
        <StatCard label="Sin clasificar" value={stats.sinClas} dot="bg-gray-400" />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["todos", "Todos"],
            ["vendibles", "Vendibles"],
            ["insumos", "Insumos"],
            ["mixtos", "Mixtos"],
            ["stock_critico", "Stock crítico"],
            ["sin_costo", "Sin costo"],
          ] as Array<[GastroFilter, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFiltro(key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition ${
              filtro === key
                ? "border-amber-500 bg-amber-50 text-amber-700"
                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-500">
          {filtrados.length} de {productos.length} productos
        </span>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50">
            <tr className="text-xs uppercase text-gray-500">
              <th className="py-2.5 px-3 font-medium">Producto</th>
              <th className="py-2.5 px-3 font-medium">Tipo</th>
              <th className="py-2.5 px-3 font-medium text-right">Stock</th>
              <th className="py-2.5 px-3 font-medium text-right">Stock mín.</th>
              <th className="py-2.5 px-3 font-medium text-right">Costo</th>
              <th className="py-2.5 px-3 font-medium text-right">Precio</th>
              <th className="py-2.5 px-3 font-medium">Unidad</th>
              <th className="py-2.5 px-3 font-medium">Estado</th>
              <th className="py-2.5 px-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-sm text-gray-500">
                  Sin productos para este filtro.
                </td>
              </tr>
            )}
            {filtrados.map((p) => {
              const tipo = classifyProducto(p);
              const b = badge(tipo);
              const ctrlStock = p.controla_stock !== false;
              const stockBajo = ctrlStock && p.stock_actual <= p.stock_minimo;
              const sinCosto = !p.costo_promedio || p.costo_promedio <= 0;
              const sinClas = tipo === "sin";
              const estados: { label: string; cls: string }[] = [];
              if (sinClas) estados.push({ label: "Sin clasificar", cls: "bg-gray-200 text-gray-700" });
              if (sinCosto) estados.push({ label: "Sin costo", cls: "bg-amber-100 text-amber-700" });
              if (stockBajo) estados.push({ label: "Bajo stock", cls: "bg-red-100 text-red-700" });
              if (estados.length === 0)
                estados.push({ label: "OK", cls: "bg-green-100 text-green-700" });

              return (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="py-2.5 px-3">
                    <div className="font-medium text-gray-800">{p.nombre}</div>
                    <div className="text-xs text-gray-400 font-mono">{p.sku}</div>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${b.cls}`}>
                      {b.label}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right font-medium text-gray-800">
                    {ctrlStock ? p.stock_actual : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="py-2.5 px-3 text-right text-gray-600">
                    {ctrlStock ? p.stock_minimo : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="py-2.5 px-3 text-right text-gray-700">{fmtGs(p.costo_promedio)}</td>
                  <td className="py-2.5 px-3 text-right text-gray-700">{fmtGs(p.precio_venta)}</td>
                  <td className="py-2.5 px-3 text-gray-600 text-xs">{p.unidad_medida}</td>
                  <td className="py-2.5 px-3">
                    <div className="flex flex-wrap gap-1">
                      {estados.map((e) => (
                        <span key={e.label} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${e.cls}`}>
                          {e.label}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <Link
                      href={`/inventario/${p.id}/editar`}
                      className="text-xs text-amber-600 hover:text-amber-700 font-medium"
                    >
                      Editar
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-400">
        <ChefHat className="h-3.5 w-3.5" />
        <span>
          Vista pensada para pizzería/lomitería. Mantiene el inventario actual intacto.
        </span>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  dot,
  highlight,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  dot?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-md border p-3 bg-white ${
        highlight ? "border-red-300" : "border-gray-200"
      }`}
    >
      <div className="flex items-center gap-2 text-xs uppercase text-gray-500">
        {icon}
        {dot && <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />}
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-1 text-xl font-semibold ${highlight ? "text-red-600" : "text-gray-900"}`}>
        {value}
      </div>
    </div>
  );
}
