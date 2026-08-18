"use server";

import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import {
  getOmnicanalScope,
  isOmnicanalAdminScope,
  shouldBypassOmnicanalConversationScope,
} from "@/lib/chat/omnicanal-scope";

export type OmnicanalWorkScheduleRow = {
  id: string;
  empresa_id: string;
  nombre: string;
  time_start: string;
  time_end: string;
  days_of_week: number[];
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

async function assertManageSchedules() {
  const ctx = await requireEmpresaTenantServiceRole();
  const scope = await getOmnicanalScope(ctx.supabase, ctx.empresa_id, ctx.usuario_id);
  const bypass = await shouldBypassOmnicanalConversationScope(ctx.catalogSr, ctx.usuario_id, scope);
  if (!bypass && !isOmnicanalAdminScope(scope)) {
    throw new Error("No tenés permisos para gestionar horarios omnicanal.");
  }
  return ctx;
}

export async function listOmnicanalWorkSchedules(): Promise<OmnicanalWorkScheduleRow[]> {
  const ctx = await assertManageSchedules();
  const { data, error } = await ctx.supabase
    .from("chat_omnicanal_work_schedules")
    .select("id, empresa_id, nombre, time_start, time_end, days_of_week, is_active, created_at, updated_at")
    .eq("empresa_id", ctx.empresa_id)
    .order("nombre", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as OmnicanalWorkScheduleRow[];
}

export async function upsertOmnicanalWorkSchedule(input: {
  id?: string | null;
  nombre: string;
  time_start: string;
  time_end: string;
  days_of_week: number[];
  is_active: boolean;
}): Promise<{ id: string }> {
  const ctx = await assertManageSchedules();
  const nombre = input.nombre.trim();
  if (!nombre) throw new Error("El nombre del horario es obligatorio.");
  const ts = new Date().toISOString();
  const days = [...new Set(input.days_of_week.filter((n) => n >= 1 && n <= 7))].sort((a, b) => a - b);

  const id = input.id?.trim();
  if (id) {
    const { error } = await ctx.supabase
      .from("chat_omnicanal_work_schedules")
      .update({
        nombre,
        time_start: input.time_start,
        time_end: input.time_end,
        days_of_week: days,
        is_active: input.is_active,
        updated_at: ts,
      })
      .eq("id", id)
      .eq("empresa_id", ctx.empresa_id);
    if (error) throw new Error(error.message);
    return { id };
  }

  const { data, error } = await ctx.supabase
    .from("chat_omnicanal_work_schedules")
    .insert({
      empresa_id: ctx.empresa_id,
      nombre,
      time_start: input.time_start,
      time_end: input.time_end,
      days_of_week: days,
      is_active: input.is_active,
      created_at: ts,
      updated_at: ts,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: (data as { id: string }).id };
}

export async function deleteOmnicanalWorkSchedule(scheduleId: string): Promise<void> {
  const ctx = await assertManageSchedules();
  const { error } = await ctx.supabase
    .from("chat_omnicanal_work_schedules")
    .delete()
    .eq("id", scheduleId.trim())
    .eq("empresa_id", ctx.empresa_id);
  if (error) throw new Error(error.message);
}
