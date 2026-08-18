"use client";

import Link from "next/link";
import type { OmnichannelCardDefinition } from "@/lib/chat/omnichannel-catalog";
import { normalizeChannelType } from "@/lib/chat/channel-type-utils";
import type { ChatChannelRow } from "@/lib/chat/actions";

export type ChannelCardUiStatus = "inactive" | "incomplete" | "active";

function badgeClasses(status: ChannelCardUiStatus): string {
  if (status === "active") {
    return "bg-emerald-50 text-emerald-900 border-emerald-200";
  }
  if (status === "incomplete") {
    return "bg-amber-50 text-amber-900 border-amber-200";
  }
  return "bg-slate-100 text-slate-600 border-slate-200";
}

function badgeLabel(status: ChannelCardUiStatus): string {
  if (status === "active") return "Activo";
  if (status === "incomplete") return "Config. incompleta";
  return "Inactivo";
}

function resolveRowsForType(rows: ChatChannelRow[], type: string): ChatChannelRow[] {
  const want = type.trim().toLowerCase();
  return rows.filter((r) => normalizeChannelType(r.type) === want);
}

export function resolveCardUiStatus(rows: ChatChannelRow[]): ChannelCardUiStatus {
  if (rows.length === 0) return "inactive";
  const st = (r: ChatChannelRow) => String(r.config_status ?? "incomplete");
  const anyActive = rows.some((r) => r.activo && st(r) === "active");
  if (anyActive) return "active";
  const anyIncomplete = rows.some((r) => r.activo && st(r) === "incomplete");
  if (anyIncomplete) return "incomplete";
  const anyRow = rows.some((r) => r.activo);
  if (!anyRow) return "inactive";
  return "incomplete";
}

function primaryRow(rows: ChatChannelRow[]): ChatChannelRow | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => {
    const score = (r: ChatChannelRow) => (r.activo && r.config_status === "active" ? 2 : r.activo ? 1 : 0);
    return score(b) - score(a);
  });
  return sorted[0] ?? null;
}

function summarizeIdentifier(row: ChatChannelRow | null, def: OmnichannelCardDefinition): string {
  if (!row) return "Sin configurar";
  const mp = row.meta_phone_number_id?.trim();
  if (def.type === "whatsapp" && row.provider === "ycloud") {
    const sid = typeof row.config?.ycloud_sender_id === "string" ? row.config.ycloud_sender_id : "";
    const cid = typeof row.config?.ycloud_channel_id === "string" ? row.config.ycloud_channel_id : "";
    return [sid && `Sender: ${sid}`, cid && `Canal: ${cid}`].filter(Boolean).join(" · ") || "YCloud";
  }
  if (mp) return `ID: ${mp}`;
  const pc = row.provider_channel_id?.trim();
  if (pc) return pc;
  return row.id.slice(0, 8) + "…";
}

export function OmnichannelChannelCard({
  def,
  rows,
}: {
  def: OmnichannelCardDefinition;
  rows: ChatChannelRow[];
}) {
  const ofType = resolveRowsForType(rows, def.type);
  const status = resolveCardUiStatus(ofType);
  const primary = primaryRow(ofType);
  const Icon = def.icon;
  const editHref =
    primary && ofType.length <= 1
      ? `/configuracion/canales/${primary.id}`
      : primary && ofType.length > 1
        ? def.type === "whatsapp"
          ? `/configuracion/canales#whatsapp-canales`
          : `/configuracion/canales?tipo=${def.type}`
        : `/configuracion/canales/nuevo?tipo=${def.type}`;

  return (
    <article className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-300 hover:shadow-md transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 border border-slate-200 text-slate-700">
            <Icon className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-slate-900 truncate">{def.label}</h2>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 mt-0.5">
              {def.type} · {String(primary?.provider ?? def.defaultProvider)}
            </p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide border ${badgeClasses(status)}`}
        >
          {badgeLabel(status)}
        </span>
      </div>
      {ofType.length > 1 && (
        <p className="mt-2 text-xs font-medium text-slate-500">{ofType.length} conexiones configuradas</p>
      )}
      <p className="mt-3 text-xs text-slate-500 font-mono truncate" title={summarizeIdentifier(primary, def)}>
        {summarizeIdentifier(primary, def)}
      </p>
      <div className="mt-auto pt-5">
        <Link
          href={editHref}
          className="inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
        >
          {ofType.length > 1 ? "Ver conexiones" : "Editar"}
        </Link>
      </div>
    </article>
  );
}
