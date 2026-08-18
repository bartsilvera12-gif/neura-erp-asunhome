"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Users, Calendar, PieChart, DollarSign, Trophy } from "lucide-react";
import { getProspectos, moveProspecto } from "@/lib/crm/storage";
import { getEtapas, getEtapaClasses, normalizeEtapaCodigo, type EtapaCrm } from "@/lib/crm/etapas";
import type { Prospecto } from "@/lib/crm/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatGs(valor: number) {
  if (valor >= 1_000_000) return `${(valor / 1_000_000).toFixed(1)}M`;
  if (valor >= 1_000) return `${(valor / 1_000).toFixed(0)}k`;
  return valor.toLocaleString("es-PY");
}

function formatFecha(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  } catch { return ""; }
}

function formatFechaCorta(yyyymmdd: string) {
  if (!yyyymmdd) return "";
  const [, m, d] = yyyymmdd.split("-");
  return `${d}/${m}`;
}

function esHoy(isoStr: string): boolean {
  const d = new Date(isoStr);
  const hoy = new Date();
  return d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth() && d.getDate() === hoy.getDate();
}

function esMesActual(isoStr: string): boolean {
  const d = new Date(isoStr);
  const hoy = new Date();
  return d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth();
}

/** Top 5 productos/planes en negociación por valor. servicio = "Plan A, Plan B", valor_estimado se reparte. */
function topProductosEnNegociacion(prospectos: Prospecto[]): { nombre: string; valor: number }[] {
  const enNeg = prospectos.filter((p) => normalizeEtapaCodigo(p.etapa) === "NEGOCIACION");
  const map: Record<string, number> = {};
  for (const p of enNeg) {
    const productos = p.servicio.split(",").map((s) => s.trim()).filter(Boolean);
    const n = productos.length || 1;
    const valorPorUno = p.valor_estimado / n;
    for (const nom of productos) {
      const key = nom || "Otros";
      map[key] = (map[key] ?? 0) + valorPorUno;
    }
  }
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([nombre, valor]) => ({ nombre, valor }));
}

// ── Avatar ────────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ["bg-blue-500", "bg-violet-500", "bg-amber-500", "bg-green-600", "bg-pink-500", "bg-cyan-600"];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function getInitials(name: string) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "xs" }) {
  const sizeClass = size === "xs" ? "w-5 h-5 text-[9px]" : "w-6 h-6 text-[10px]";
  return (
    <span className={`inline-flex items-center justify-center rounded-full ${sizeClass} ${getAvatarColor(name)} text-white font-bold shrink-0`}>
      {getInitials(name)}
    </span>
  );
}

// ── ProspectoCard (compacto) ───────────────────────────────────────────────────

function ProspectoCard({
  prospecto,
  etapas,
  onDragStart,
  onMoverEtapa,
}: {
  prospecto: Prospecto;
  etapas: EtapaCrm[];
  onDragStart: (id: string) => void;
  onMoverEtapa: (id: string, etapaCodigo: string) => void;
}) {
  const codigoProspecto = normalizeEtapaCodigo(prospecto.etapa);
  const esGanado = codigoProspecto === "GANADO";
  const esPerdido = codigoProspecto === "PERDIDO";
  const hayGanado = etapas.some((e) => normalizeEtapaCodigo(e.codigo) === "GANADO");
  const hayPerdido = etapas.some((e) => normalizeEtapaCodigo(e.codigo) === "PERDIDO");

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(prospecto.id));
        e.dataTransfer.effectAllowed = "move";
        onDragStart(prospecto.id);
      }}
      className="bg-white border border-gray-200 rounded-lg p-2 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-all select-none group"
    >
      <div className="flex items-start justify-between gap-1.5 mb-0.5">
        <div className="min-w-0">
          <p className="font-semibold text-gray-800 text-xs leading-tight truncate">{prospecto.empresa}</p>
          <p className="text-[10px] text-gray-400 font-mono">{prospecto.numero_control}</p>
          {prospecto.origen_creacion === "whatsapp" && (
            <span className="text-[10px] bg-sky-50 text-[#0284C7] border border-sky-100 px-1 py-0.5 rounded inline-block mt-1">
              WhatsApp
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {prospecto.notas.length > 0 && (
            <span className="text-[10px] bg-gray-100 text-gray-500 px-1 py-0.5 rounded">{prospecto.notas.length}💬</span>
          )}
          <Link
            href={`/crm/${prospecto.id}`}
            onClick={(e) => e.stopPropagation()}
            className="p-0.5 rounded text-gray-300 hover:text-gray-600 hover:bg-gray-100 opacity-0 group-hover:opacity-100"
            title="Editar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
              <path d="M2.695 14.763l-1.262 3.154a.5.5 0 0 0 .65.65l3.155-1.262a4 4 0 0 0 1.343-.885L17.5 5.5a2.121 2.121 0 0 0-3-3L3.58 13.42a4 4 0 0 0-.885 1.343Z" />
            </svg>
          </Link>
        </div>
      </div>
      <p className="text-[10px] text-gray-500 line-clamp-1 mb-0.5">{prospecto.servicio}</p>
      <p className="text-xs font-bold text-gray-900 tabular-nums mb-1">Gs. {prospecto.valor_estimado.toLocaleString("es-PY")}</p>
      <div className="text-[10px] text-gray-600 truncate mb-1">👤 {prospecto.contacto}</div>
      {prospecto.proxima_accion && (
        <div className="flex items-start gap-0.5 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5 mb-1">
          <span className="text-amber-500 shrink-0">⏰</span>
          <p className="text-[10px] text-amber-800 truncate">{prospecto.proxima_accion}</p>
        </div>
      )}
      <div className="flex items-center justify-between border-t border-gray-100 pt-1 mt-0.5">
        {prospecto.responsable ? (
          <div className="flex items-center gap-1 min-w-0">
            <Avatar name={prospecto.responsable} size="xs" />
            <span className="text-[10px] text-gray-500 truncate">{prospecto.responsable}</span>
          </div>
        ) : (
          <span className="text-[10px] text-gray-300 italic">Sin responsable</span>
        )}
        <span className="text-[10px] text-gray-400 shrink-0">{formatFecha(prospecto.fecha_creacion)}</span>
      </div>
      {!esGanado && !esPerdido && hayGanado && hayPerdido && (
        <div className="mt-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMoverEtapa(prospecto.id, "GANADO"); }}
            className="flex-1 text-[10px] text-green-600 hover:bg-green-50 border border-green-200 rounded px-1 py-0.5 font-medium"
          >
            ✓ Ganado
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMoverEtapa(prospecto.id, "PERDIDO"); }}
            className="flex-1 text-[10px] text-red-500 hover:bg-red-50 border border-red-200 rounded px-1 py-0.5 font-medium"
          >
            ✗ Perdido
          </button>
        </div>
      )}
      {esGanado && (
        <div className="mt-1 bg-green-50 border border-green-200 rounded px-1.5 py-0.5 flex items-center justify-between gap-1">
          <span className="text-[10px] text-green-700 font-medium">{prospecto.cliente_creado ? "✓ Cliente creado" : "✓ Ganado"}</span>
          {!prospecto.cliente_creado && (
            <Link href={`/clientes/nuevo?from_crm=${prospecto.id}`} onClick={(e) => e.stopPropagation()} className="text-[10px] text-green-600 font-semibold underline shrink-0">
              Crear cliente →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// ── Columna Kanban (compacta) ─────────────────────────────────────────────────

function Columna({
  etapa,
  prospectos,
  etapas,
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
  onMoverEtapa,
}: {
  etapa: EtapaCrm;
  prospectos: Prospecto[];
  etapas: EtapaCrm[];
  isDragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragStart: (id: string) => void;
  onMoverEtapa: (id: string, etapaCodigo: string) => void;
}) {
  const cfg = getEtapaClasses(etapa.color);
  const total = prospectos.reduce((s, p) => s + p.valor_estimado, 0);

  return (
    <div
      className={`flex flex-col w-52 min-w-52 rounded-lg border-2 transition-colors duration-150 ${
        isDragOver ? "border-gray-400 bg-gray-100/60" : `${cfg.border} bg-gray-50/30`
      }`}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) onDragLeave();
      }}
      onDrop={onDrop}
    >
      <div className={`${cfg.headerBg} rounded-t-lg px-2 py-1.5`}>
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
            <span className={`font-semibold text-xs ${cfg.headerText}`}>{etapa.nombre}</span>
            <span className="text-[10px] bg-white/70 text-gray-600 px-1 py-0.5 rounded font-semibold">{prospectos.length}</span>
          </div>
          {total > 0 && <span className="text-[10px] text-gray-500 tabular-nums font-semibold">Gs. {formatGs(total)}</span>}
        </div>
      </div>
      <div className="flex-1 p-1.5 space-y-1.5 overflow-y-auto min-h-16 max-h-[calc(100vh-260px)]">
        {prospectos.length === 0 ? (
          <div className={`flex items-center justify-center h-14 rounded border-2 border-dashed text-[10px] text-gray-300 ${isDragOver ? "border-gray-400 text-gray-500" : "border-gray-200"}`}>
            Arrastrá aquí
          </div>
        ) : (
          prospectos.map((p) => (
            <ProspectoCard key={p.id} prospecto={p} etapas={etapas} onDragStart={onDragStart} onMoverEtapa={onMoverEtapa} />
          ))
        )}
      </div>
    </div>
  );
}

// ── MetricCard ─────────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  color,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className={`bg-white rounded-lg border ${color} p-3 shadow-sm`}>
      <div className="flex items-center gap-1.5 mb-0.5">
        {Icon && <Icon className="w-3.5 h-3.5 text-slate-500" />}
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
      </div>
      <p className="text-lg font-bold text-gray-800 tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Top Productos Widget ───────────────────────────────────────────────────────

function TopProductosWidget({ items, total }: { items: { nombre: string; valor: number }[]; total: number }) {
  if (items.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm">
        <div className="flex items-center gap-1.5 mb-1">
          <PieChart className="w-3.5 h-3.5 text-slate-500" />
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Top en negociación</p>
        </div>
        <p className="text-sm text-gray-400 italic">Sin datos</p>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-lg border border-amber-200 p-3 shadow-sm">
      <div className="flex items-center gap-1.5 mb-1.5">
        <PieChart className="w-3.5 h-3.5 text-slate-500" />
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Top en negociación</p>
      </div>
      <div className="space-y-0.5">
        {items.map((it, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-[10px]">
            <span className="truncate font-medium text-gray-700">{it.nombre}</span>
            <span className="shrink-0 text-gray-500 tabular-nums">{formatGs(it.valor)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────────────

export default function CrmPage() {
  const [prospectos, setProspectos] = useState<Prospecto[]>([]);
  const [etapas, setEtapas] = useState<EtapaCrm[]>([]);
  const [dragOverEtapa, setDragOverEtapa] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);

  function recargar() {
    getProspectos().then(setProspectos);
    getEtapas().then(setEtapas);
  }

  useEffect(() => { recargar(); }, []);

  useEffect(() => {
    console.info("[crm-funnel][board-data]", {
      context: "client",
      etapas_count: etapas.length,
      prospectos_count: prospectos.length,
      codigos_columnas: etapas.map((e) => e.codigo),
    });
  }, [etapas, prospectos]);

  function handleDragStart(id: string) {
    dragIdRef.current = id;
  }

  async function handleDrop(e: React.DragEvent, etapaCodigo: string) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (id) {
      await moveProspecto(id, etapaCodigo);
      recargar();
    }
    setDragOverEtapa(null);
    dragIdRef.current = null;
  }

  async function handleMoverEtapa(id: string, etapaCodigo: string) {
    await moveProspecto(id, etapaCodigo);
    recargar();
  }

  const porEtapa = (codigo: string) =>
    prospectos.filter((p) => normalizeEtapaCodigo(p.etapa) === normalizeEtapaCodigo(codigo));

  const leadsHoy = prospectos.filter((p) => esHoy(p.fecha_creacion)).length;
  const leadsMes = prospectos.filter((p) => esMesActual(p.fecha_creacion)).length;
  const enNegociacion = prospectos.filter((p) => normalizeEtapaCodigo(p.etapa) === "NEGOCIACION");
  const valorNegociacion = enNegociacion.reduce((s, p) => s + p.valor_estimado, 0);
  const topProductos = topProductosEnNegociacion(prospectos);
  const ganadosHoy = prospectos.filter(
    (p) => normalizeEtapaCodigo(p.etapa) === "GANADO" && esHoy(p.fecha_actualizacion)
  ).length;
  const ganadosMes = prospectos.filter(
    (p) => normalizeEtapaCodigo(p.etapa) === "GANADO" && esMesActual(p.fecha_actualizacion)
  ).length;

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">CRM Funnel</h1>
          <p className="text-gray-500 text-xs mt-0.5">Pipeline comercial · {prospectos.length} oportunidades</p>
        </div>
        <Link
          href="/crm/nuevo"
          className="flex items-center gap-1.5 bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-3 py-2 rounded-lg text-xs font-medium transition-colors shadow-sm shrink-0 active:scale-95"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          Nuevo prospecto
        </Link>
      </div>

      {/* Mini dashboard: una sola fila, 6 widgets */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <MetricCard label="Leads Hoy" value={leadsHoy} sub="creados hoy" color="border-slate-200" icon={Users} />
        <MetricCard label="Leads del Mes" value={leadsMes} sub="creados en el mes" color="border-slate-200" icon={Calendar} />
        <TopProductosWidget items={topProductos} total={valorNegociacion} />
        <MetricCard label="Valor en Negociación" value={`Gs. ${formatGs(valorNegociacion)}`} sub="pipeline activo" color="border-amber-200" icon={DollarSign} />
        <MetricCard label="Ganados Hoy" value={ganadosHoy} sub="cierres del día" color="border-green-200" icon={Trophy} />
        <MetricCard label="Ganados del Mes" value={ganadosMes} sub="cierres del mes" color="border-green-200" icon={Trophy} />
      </div>

      {/* Kanban compacto */}
      <div className="overflow-x-auto pb-2 -mx-1 px-1 flex-1 min-h-0">
        <div className="flex gap-2 min-w-max items-start h-full">
          {etapas.map((etapa) => (
            <Columna
              key={etapa.id}
              etapa={etapa}
              prospectos={porEtapa(etapa.codigo)}
              etapas={etapas}
              isDragOver={dragOverEtapa === etapa.codigo}
              onDragOver={(e) => { e.preventDefault(); setDragOverEtapa(etapa.codigo); }}
              onDragLeave={() => setDragOverEtapa(null)}
              onDrop={(e) => handleDrop(e, etapa.codigo)}
              onDragStart={handleDragStart}
              onMoverEtapa={handleMoverEtapa}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
