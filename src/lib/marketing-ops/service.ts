import "server-only";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import {
  MARKETING_OPS_ESTADOS_CLIENTE,
  MARKETING_OPS_ESTADOS_PRODUCCION,
  MARKETING_OPS_ESTADOS_PUBLICACION,
  MARKETING_OPS_PRIORIDADES,
  type MarketingOpsComentario,
  type MarketingOpsDashboard,
  type MarketingOpsEstadoCampo,
  type MarketingOpsFilters,
  type MarketingOpsHistorial,
  type MarketingOpsPieza,
  type MarketingOpsPiezaRow,
} from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanDate(value: unknown): string | null {
  const raw = cleanText(value);
  if (!raw) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function pickAllowed<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value : fallback;
}

function parseMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function marketingClient(empresaId: string): Promise<AppSupabaseClient> {
  return getChatServiceClientForEmpresa(empresaId);
}

async function clienteMap(
  sb: AppSupabaseClient,
  empresaId: string,
  ids: string[]
): Promise<Map<string, MarketingOpsPieza["cliente"]>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, MarketingOpsPieza["cliente"]>();
  if (uniq.length === 0) return map;
  const { data } = await sb
    .from("clientes")
    .select("id, nombre, empresa, nombre_contacto")
    .eq("empresa_id", empresaId)
    .in("id", uniq);
  for (const c of (data ?? []) as { id: string; nombre: string | null; empresa: string | null; nombre_contacto: string | null }[]) {
    map.set(c.id, c);
  }
  return map;
}

async function usuarioMap(
  empresaId: string,
  ids: string[]
): Promise<Map<string, { id: string; nombre: string | null; email: string | null }>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, { id: string; nombre: string | null; email: string | null }>();
  if (uniq.length === 0) return map;
  const catalog = createServiceRoleClient();
  const { data } = await catalog
    .from("usuarios")
    .select("id, nombre, email")
    .eq("empresa_id", empresaId)
    .in("id", uniq);
  for (const u of (data ?? []) as { id: string; nombre: string | null; email: string | null }[]) {
    map.set(u.id, u);
  }
  return map;
}

async function enrichPiezas(
  sb: AppSupabaseClient,
  empresaId: string,
  rows: MarketingOpsPiezaRow[]
): Promise<MarketingOpsPieza[]> {
  const clientes = await clienteMap(
    sb,
    empresaId,
    rows.map((r) => r.cliente_id ?? "")
  );
  const usuarios = await usuarioMap(
    empresaId,
    rows.map((r) => r.responsable_id ?? "")
  );
  return rows.map((row) => ({
    ...row,
    cliente: row.cliente_id ? clientes.get(row.cliente_id) ?? null : null,
    responsable: row.responsable_id ? usuarios.get(row.responsable_id) ?? null : null,
  }));
}

export async function listMarketingOpsPiezas(opts: {
  empresaId: string;
  filters?: MarketingOpsFilters;
}): Promise<MarketingOpsPieza[]> {
  const sb = await marketingClient(opts.empresaId);
  const f = opts.filters ?? {};
  let q = sb.from("marketing_piezas").select("*").eq("empresa_id", opts.empresaId);

  if (isValidUuid(f.cliente_id)) q = q.eq("cliente_id", f.cliente_id.trim());
  if (isValidUuid(f.responsable_id)) q = q.eq("responsable_id", f.responsable_id.trim());
  if (f.prioridad && (MARKETING_OPS_PRIORIDADES as readonly string[]).includes(f.prioridad)) q = q.eq("prioridad", f.prioridad);
  if (f.estado_produccion && (MARKETING_OPS_ESTADOS_PRODUCCION as readonly string[]).includes(f.estado_produccion)) {
    q = q.eq("estado_produccion", f.estado_produccion);
  }
  if (f.estado_cliente && (MARKETING_OPS_ESTADOS_CLIENTE as readonly string[]).includes(f.estado_cliente)) {
    q = q.eq("estado_cliente", f.estado_cliente);
  }
  if (f.estado_publicacion && (MARKETING_OPS_ESTADOS_PUBLICACION as readonly string[]).includes(f.estado_publicacion)) {
    q = q.eq("estado_publicacion", f.estado_publicacion);
  }
  if (f.vencidas) {
    q = q.lte("fecha_limite", yesterdayYmd()).neq("estado_publicacion", "publicado").neq("estado_publicacion", "cancelado");
  }
  const desde = cleanDate(f.desde);
  const hasta = cleanDate(f.hasta);
  if (desde) q = q.gte("fecha_limite", desde);
  if (hasta) q = q.lte("fecha_limite", hasta);
  const term = cleanText(f.q);
  if (term) q = q.ilike("titulo", `%${term}%`);

  const { data, error } = await q.order("fecha_limite", { ascending: true }).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return enrichPiezas(sb, opts.empresaId, (data ?? []) as MarketingOpsPiezaRow[]);
}

export async function getMarketingOpsDashboard(empresaId: string): Promise<MarketingOpsDashboard> {
  const piezas = await listMarketingOpsPiezas({ empresaId });
  const hoy = todayYmd();
  return {
    pendientes: piezas.filter((p) => p.estado_produccion !== "listo_para_enviar" && p.estado_publicacion !== "publicado").length,
    vencidas: piezas.filter((p) => p.fecha_limite && p.fecha_limite < hoy && !["publicado", "cancelado"].includes(p.estado_publicacion)).length,
    en_produccion: piezas.filter((p) => p.estado_produccion === "en_produccion").length,
    en_revision: piezas.filter((p) => p.estado_produccion === "revision_interna").length,
    enviadas_cliente: piezas.filter((p) => p.estado_cliente === "enviado").length,
    aprobadas: piezas.filter((p) => p.estado_cliente === "aprobado").length,
    programadas: piezas.filter((p) => p.estado_publicacion === "programado").length,
    publicadas: piezas.filter((p) => p.estado_publicacion === "publicado").length,
  };
}

function buildPiezaInsert(body: Record<string, unknown>, empresaId: string, usuarioId: string): Record<string, unknown> {
  const titulo = cleanText(body.titulo);
  if (!titulo) throw new Error("El título es obligatorio");
  return {
    empresa_id: empresaId,
    calendario_id: isValidUuid(body.calendario_id) ? body.calendario_id.trim() : null,
    cliente_id: isValidUuid(body.cliente_id) ? body.cliente_id.trim() : null,
    titulo,
    tipo_pieza: cleanText(body.tipo_pieza),
    canal: cleanText(body.canal),
    responsable_id: isValidUuid(body.responsable_id) ? body.responsable_id.trim() : null,
    fecha_limite: cleanDate(body.fecha_limite),
    fecha_publicacion: cleanDate(body.fecha_publicacion),
    prioridad: pickAllowed(body.prioridad, MARKETING_OPS_PRIORIDADES, "media"),
    estado_produccion: pickAllowed(body.estado_produccion, MARKETING_OPS_ESTADOS_PRODUCCION, "por_hacer"),
    estado_cliente: pickAllowed(body.estado_cliente, MARKETING_OPS_ESTADOS_CLIENTE, "no_enviado"),
    estado_publicacion: pickAllowed(body.estado_publicacion, MARKETING_OPS_ESTADOS_PUBLICACION, "pendiente"),
    link_archivo: cleanText(body.link_archivo),
    observaciones: cleanText(body.observaciones),
    metadata: parseMetadata(body.metadata),
    created_by: usuarioId,
    updated_by: usuarioId,
  };
}

export async function createMarketingOpsPieza(opts: {
  empresaId: string;
  usuarioId: string;
  body: Record<string, unknown>;
}): Promise<MarketingOpsPieza> {
  const sb = await marketingClient(opts.empresaId);
  const insert = buildPiezaInsert(opts.body, opts.empresaId, opts.usuarioId);
  const { data, error } = await sb.from("marketing_piezas").insert(insert).select("*").single();
  if (error) throw new Error(error.message);
  const enriched = await enrichPiezas(sb, opts.empresaId, [data as MarketingOpsPiezaRow]);
  return enriched[0];
}

export async function getMarketingOpsPieza(empresaId: string, piezaId: string): Promise<{
  pieza: MarketingOpsPieza;
  comentarios: MarketingOpsComentario[];
  historial: MarketingOpsHistorial[];
}> {
  const sb = await marketingClient(empresaId);
  const { data, error } = await sb
    .from("marketing_piezas")
    .select("*")
    .eq("empresa_id", empresaId)
    .eq("id", piezaId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Pieza no encontrada");
  const [pieza] = await enrichPiezas(sb, empresaId, [data as MarketingOpsPiezaRow]);
  const [comentarios, historial] = await Promise.all([
    listMarketingOpsComentarios({ empresaId, piezaId }),
    listMarketingOpsHistorial({ empresaId, piezaId }),
  ]);
  return { pieza, comentarios, historial };
}

function buildPatch(body: Record<string, unknown>, usuarioId: string): Record<string, unknown> {
  const patch: Record<string, unknown> = { updated_by: usuarioId };
  if ("calendario_id" in body) patch.calendario_id = isValidUuid(body.calendario_id) ? body.calendario_id.trim() : null;
  if ("cliente_id" in body) patch.cliente_id = isValidUuid(body.cliente_id) ? body.cliente_id.trim() : null;
  if ("titulo" in body) {
    const titulo = cleanText(body.titulo);
    if (!titulo) throw new Error("El título es obligatorio");
    patch.titulo = titulo;
  }
  if ("tipo_pieza" in body) patch.tipo_pieza = cleanText(body.tipo_pieza);
  if ("canal" in body) patch.canal = cleanText(body.canal);
  if ("responsable_id" in body) patch.responsable_id = isValidUuid(body.responsable_id) ? body.responsable_id.trim() : null;
  if ("fecha_limite" in body) patch.fecha_limite = cleanDate(body.fecha_limite);
  if ("fecha_publicacion" in body) patch.fecha_publicacion = cleanDate(body.fecha_publicacion);
  if ("prioridad" in body) patch.prioridad = pickAllowed(body.prioridad, MARKETING_OPS_PRIORIDADES, "media");
  if ("estado_produccion" in body) patch.estado_produccion = pickAllowed(body.estado_produccion, MARKETING_OPS_ESTADOS_PRODUCCION, "por_hacer");
  if ("estado_cliente" in body) patch.estado_cliente = pickAllowed(body.estado_cliente, MARKETING_OPS_ESTADOS_CLIENTE, "no_enviado");
  if ("estado_publicacion" in body) patch.estado_publicacion = pickAllowed(body.estado_publicacion, MARKETING_OPS_ESTADOS_PUBLICACION, "pendiente");
  if ("link_archivo" in body) patch.link_archivo = cleanText(body.link_archivo);
  if ("observaciones" in body) patch.observaciones = cleanText(body.observaciones);
  if ("metadata" in body) patch.metadata = parseMetadata(body.metadata);
  return patch;
}

async function insertHistorial(opts: {
  sb: AppSupabaseClient;
  empresaId: string;
  piezaId: string;
  campo: MarketingOpsEstadoCampo;
  anterior: string | null;
  nuevo: string | null;
  usuarioId: string;
}) {
  if (opts.anterior === opts.nuevo) return;
  const { error } = await opts.sb.from("marketing_historial_estados").insert({
    empresa_id: opts.empresaId,
    pieza_id: opts.piezaId,
    campo: opts.campo,
    estado_anterior: opts.anterior,
    estado_nuevo: opts.nuevo,
    changed_by: opts.usuarioId,
  });
  if (error) throw new Error(error.message);
}

export async function updateMarketingOpsPieza(opts: {
  empresaId: string;
  usuarioId: string;
  piezaId: string;
  body: Record<string, unknown>;
}): Promise<MarketingOpsPieza> {
  const sb = await marketingClient(opts.empresaId);
  const current = await getMarketingOpsPieza(opts.empresaId, opts.piezaId);
  const patch = buildPatch(opts.body, opts.usuarioId);
  const { data, error } = await sb
    .from("marketing_piezas")
    .update(patch)
    .eq("empresa_id", opts.empresaId)
    .eq("id", opts.piezaId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  for (const campo of ["estado_produccion", "estado_cliente", "estado_publicacion"] as const) {
    if (campo in patch) {
      await insertHistorial({
        sb,
        empresaId: opts.empresaId,
        piezaId: opts.piezaId,
        campo,
        anterior: current.pieza[campo] ?? null,
        nuevo: (patch[campo] as string | null) ?? null,
        usuarioId: opts.usuarioId,
      });
    }
  }

  const enriched = await enrichPiezas(sb, opts.empresaId, [data as MarketingOpsPiezaRow]);
  return enriched[0];
}

export async function changeMarketingOpsEstado(opts: {
  empresaId: string;
  usuarioId: string;
  piezaId: string;
  campo: MarketingOpsEstadoCampo;
  estado: string;
}): Promise<MarketingOpsPieza> {
  const allowed =
    opts.campo === "estado_produccion"
      ? MARKETING_OPS_ESTADOS_PRODUCCION
      : opts.campo === "estado_cliente"
        ? MARKETING_OPS_ESTADOS_CLIENTE
        : MARKETING_OPS_ESTADOS_PUBLICACION;
  if (!(allowed as readonly string[]).includes(opts.estado)) {
    throw new Error("Estado no válido");
  }
  return updateMarketingOpsPieza({
    empresaId: opts.empresaId,
    usuarioId: opts.usuarioId,
    piezaId: opts.piezaId,
    body: { [opts.campo]: opts.estado },
  });
}

export async function listMarketingOpsComentarios(opts: {
  empresaId: string;
  piezaId: string;
}): Promise<MarketingOpsComentario[]> {
  const sb = await marketingClient(opts.empresaId);
  const { data, error } = await sb
    .from("marketing_comentarios")
    .select("*")
    .eq("empresa_id", opts.empresaId)
    .eq("pieza_id", opts.piezaId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as MarketingOpsComentario[];
  const users = await usuarioMap(
    opts.empresaId,
    rows.map((r) => r.usuario_id ?? "")
  );
  return rows.map((r) => ({ ...r, usuario_nombre: r.usuario_id ? users.get(r.usuario_id)?.nombre ?? null : null }));
}

export async function createMarketingOpsComentario(opts: {
  empresaId: string;
  usuarioId: string;
  piezaId: string;
  comentario: string;
}): Promise<MarketingOpsComentario> {
  const texto = cleanText(opts.comentario);
  if (!texto) throw new Error("El comentario es obligatorio");
  const sb = await marketingClient(opts.empresaId);
  const { data: pieza, error: ePieza } = await sb
    .from("marketing_piezas")
    .select("id")
    .eq("empresa_id", opts.empresaId)
    .eq("id", opts.piezaId)
    .maybeSingle();
  if (ePieza) throw new Error(ePieza.message);
  if (!pieza) throw new Error("Pieza no encontrada");

  const { data, error } = await sb
    .from("marketing_comentarios")
    .insert({
      empresa_id: opts.empresaId,
      pieza_id: opts.piezaId,
      usuario_id: opts.usuarioId,
      comentario: texto,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return { ...(data as MarketingOpsComentario), usuario_nombre: null };
}

export async function listMarketingOpsHistorial(opts: {
  empresaId: string;
  piezaId: string;
}): Promise<MarketingOpsHistorial[]> {
  const sb = await marketingClient(opts.empresaId);
  const { data, error } = await sb
    .from("marketing_historial_estados")
    .select("*")
    .eq("empresa_id", opts.empresaId)
    .eq("pieza_id", opts.piezaId)
    .order("changed_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as MarketingOpsHistorial[];
  const users = await usuarioMap(
    opts.empresaId,
    rows.map((r) => r.changed_by ?? "")
  );
  return rows.map((r) => ({ ...r, usuario_nombre: r.changed_by ? users.get(r.changed_by)?.nombre ?? null : null }));
}
