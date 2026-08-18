"use server";

import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { requireEmpresaTenantServiceRole } from "@/lib/chat/empresa-tenant-service-role";
import { isErpRolSupervisor, isErpRolUsuario } from "@/lib/usuarios/erp-rol-normalize";
import {
  getOmnicanalScope,
  isOmnicanalAdminScope,
  shouldBypassOmnicanalConversationScope,
} from "@/lib/chat/omnicanal-scope";

async function validateSupervisorErpProfile(
  catalogSr: AppSupabaseClient,
  empresaId: string,
  usuarioId: string
): Promise<void> {
  const { data, error } = await catalogSr
    .from("usuarios")
    .select("rol")
    .eq("id", usuarioId.trim())
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Supervisor no encontrado en la empresa.");
  if (!isErpRolSupervisor((data as { rol?: string }).rol)) {
    throw new Error("Solo usuarios con perfil Supervisor en el ERP pueden ser supervisores.");
  }
}

async function validateAgentErpProfileAndQueue(
  supabase: AppSupabaseClient,
  catalogSr: AppSupabaseClient,
  empresaId: string,
  usuarioId: string
): Promise<void> {
  const { data, error } = await catalogSr
    .from("usuarios")
    .select("rol")
    .eq("id", usuarioId.trim())
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Agente no encontrado en la empresa.");
  if (!isErpRolUsuario((data as { rol?: string }).rol)) {
    throw new Error("Solo usuarios con perfil Usuario en el ERP pueden ser agentes en esta relación.");
  }

  const { data: rows, error: e2 } = await supabase
    .from("chat_agents")
    .select("id, is_active")
    .eq("empresa_id", empresaId)
    .eq("usuario_id", usuarioId.trim());
  if (e2) throw new Error(e2.message);
  const ok = (rows ?? []).some((r) => (r as { is_active?: boolean }).is_active !== false);
  if (!ok) {
    throw new Error("El agente debe estar asignado a al menos una cola omnicanal activa.");
  }
}

async function assertManageSupervision() {
  const ctx = await requireEmpresaTenantServiceRole();
  const scope = await getOmnicanalScope(ctx.supabase, ctx.empresa_id, ctx.usuario_id);
  const bypass = await shouldBypassOmnicanalConversationScope(ctx.catalogSr, ctx.usuario_id, scope);
  if (!bypass && !isOmnicanalAdminScope(scope)) {
    throw new Error("No tenés permisos para gestionar equipos y supervisión omnicanal.");
  }
  return ctx;
}

export type SupervisionLinkRow = {
  id: string;
  supervisor_usuario_id: string;
  agent_usuario_id: string;
  created_at: string;
  supervisor_nombre: string | null;
  supervisor_email: string | null;
  agent_nombre: string | null;
  agent_email: string | null;
};

export async function fetchSupervisionLinks(): Promise<SupervisionLinkRow[]> {
  const { supabase, catalogSr, empresa_id } = await assertManageSupervision();
  const { data, error } = await supabase
    .from("chat_supervisor_agents")
    .select("id, supervisor_usuario_id, agent_usuario_id, created_at")
    .eq("empresa_id", empresa_id)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  const rows = (data ?? []) as {
    id: string;
    supervisor_usuario_id: string;
    agent_usuario_id: string;
    created_at: string;
  }[];

  const uids = [...new Set(rows.flatMap((r) => [r.supervisor_usuario_id, r.agent_usuario_id]))];
  let usuarioById: Record<string, { nombre: string | null; email: string | null }> = {};
  if (uids.length > 0) {
    const { data: urows, error: uErr } = await catalogSr
      .from("usuarios")
      .select("id, nombre, email")
      .in("id", uids);
    if (uErr) throw new Error(uErr.message);
    usuarioById = Object.fromEntries(
      (urows ?? []).map((u) => {
        const row = u as { id: string; nombre?: string | null; email?: string | null };
        return [
          row.id,
          { nombre: row.nombre ?? null, email: row.email ?? null },
        ] as const;
      })
    );
  }

  return rows.map((r) => {
    const s = usuarioById[r.supervisor_usuario_id];
    const a = usuarioById[r.agent_usuario_id];
    return {
      id: r.id,
      supervisor_usuario_id: r.supervisor_usuario_id,
      agent_usuario_id: r.agent_usuario_id,
      created_at: r.created_at,
      supervisor_nombre: s?.nombre ?? null,
      supervisor_email: s?.email ?? null,
      agent_nombre: a?.nombre ?? null,
      agent_email: a?.email ?? null,
    };
  });
}

export async function linkAgentToSupervisor(supervisorUsuarioId: string, agentUsuarioId: string): Promise<void> {
  const { supabase, catalogSr, empresa_id } = await assertManageSupervision();
  const sid = supervisorUsuarioId.trim();
  const aid = agentUsuarioId.trim();
  if (!sid || !aid) throw new Error("Seleccioná supervisor y agente.");
  if (sid === aid) throw new Error("El supervisor y el agente no pueden ser la misma persona.");

  await validateSupervisorErpProfile(catalogSr, empresa_id, sid);
  await validateAgentErpProfileAndQueue(supabase, catalogSr, empresa_id, aid);

  const { error: roleErr } = await supabase.from("chat_empresa_operator_roles").upsert(
    {
      empresa_id,
      usuario_id: sid,
      role: "supervisor",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "empresa_id,usuario_id" }
  );
  if (roleErr) throw new Error(roleErr.message);

  const { error } = await supabase.from("chat_supervisor_agents").insert({
    empresa_id,
    supervisor_usuario_id: sid,
    agent_usuario_id: aid,
  });

  if (error) {
    const code = String((error as { code?: string }).code ?? "");
    const msg = (error.message ?? "").toLowerCase();
    if (code === "23505" || msg.includes("duplicate") || msg.includes("unique")) {
      throw new Error("Ese agente ya está asignado a este supervisor.");
    }
    throw new Error(error.message);
  }
}

export async function removeSupervisionLink(linkId: string): Promise<void> {
  const { supabase, empresa_id } = await assertManageSupervision();
  const id = linkId.trim();
  if (!id) return;
  const { error } = await supabase
    .from("chat_supervisor_agents")
    .delete()
    .eq("id", id)
    .eq("empresa_id", empresa_id);
  if (error) throw new Error(error.message);
}
