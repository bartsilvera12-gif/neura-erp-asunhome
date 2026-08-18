import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

import {
  formatDurationHuman,
  slaTipoSnapshotLabel,
} from "@/lib/proyectos/brief-data";

export type HistorialRowRaw = {
  id: string;
  estado_anterior_id?: string | null;
  estado_nuevo_id?: string | null;
  changed_by?: string | null;
  changed_at?: string | null;
  entered_at?: string | null;
  exited_at?: string | null;
  duration_seconds?: number | null;
  tipo_sla_snapshot?: string | null;
};

export type HistorialRowEnriched = HistorialRowRaw & {
  estado_anterior_nombre: string | null;
  estado_nuevo_nombre: string;
  tipo_sla_label: string;
  usuario_cambio_label: string;
  duration_label: string;
};

export async function enrichProyectoHistorialRows(
  sb: AppSupabaseClient,
  empresaId: string,
  rows: HistorialRowRaw[]
): Promise<HistorialRowEnriched[]> {
  if (rows.length === 0) return [];

  const estadoIds = new Set<string>();
  const userIds = new Set<string>();
  for (const r of rows) {
    if (r.estado_anterior_id) estadoIds.add(r.estado_anterior_id);
    if (r.estado_nuevo_id) estadoIds.add(r.estado_nuevo_id);
    if (r.changed_by) userIds.add(r.changed_by);
  }

  const catalog = createServiceRoleClient();

  const [estRes, usrRes] = await Promise.all([
    estadoIds.size > 0
      ? sb.from("proyecto_estados").select("id,nombre").eq("empresa_id", empresaId).in("id", [...estadoIds])
      : Promise.resolve({ data: [] as { id: string; nombre?: string }[] }),
    userIds.size > 0
      ? catalog.from("usuarios").select("id,nombre,email").eq("empresa_id", empresaId).in("id", [...userIds])
      : Promise.resolve({ data: [] as { id: string; nombre?: string; email?: string }[] }),
  ]);

  const nombreEstado = new Map<string, string>();
  for (const e of estRes.data ?? []) {
    nombreEstado.set(e.id, String(e.nombre ?? ""));
  }

  const nombreUsuario = new Map<string, string>();
  for (const u of usrRes.data ?? []) {
    const label = [u.nombre, u.email].filter(Boolean).join(" · ") || u.id.slice(0, 8);
    nombreUsuario.set(u.id, label);
  }

  return rows.map((r) => {
    const antId = r.estado_anterior_id ?? null;
    const nueId = r.estado_nuevo_id ?? "";
    const uid = r.changed_by ?? null;
    let usuarioLabel = "No registrado";
    if (uid) {
      usuarioLabel = nombreUsuario.get(uid) ?? "Usuario desconocido";
    }

    return {
      ...r,
      estado_anterior_nombre: antId ? nombreEstado.get(antId) ?? "—" : null,
      estado_nuevo_nombre: nueId ? nombreEstado.get(nueId) ?? "—" : "—",
      tipo_sla_label: slaTipoSnapshotLabel(r.tipo_sla_snapshot),
      usuario_cambio_label: usuarioLabel,
      duration_label: formatDurationHuman(
        r.duration_seconds != null ? Number(r.duration_seconds) : null
      ),
    };
  });
}
