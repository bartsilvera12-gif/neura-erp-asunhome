/** Cliente de marcas y líneas de producto (browser). */

export interface Maestro {
  id: string;
  nombre: string;
  codigo: string | null;
  descripcion: string | null;
  activo: boolean;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  productos: number;
}

export interface MaestroInput {
  nombre: string;
  codigo?: string | null;
  descripcion?: string | null;
  activo?: boolean;
  proveedor_id?: string | null;
}

export type Res<T> = { ok: true; data: T } | { ok: false; error: string };

export type MaestroKind = "marcas" | "lineas-producto";

function endpoint(kind: MaestroKind): string {
  return `/api/${kind}`;
}

async function call<T>(url: string, init: RequestInit, pick: (d: Record<string, unknown>) => T): Promise<Res<T>> {
  try {
    const r = await fetch(url, { credentials: "include", ...init });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) return { ok: false, error: j?.error ?? `Error ${r.status}` };
    return { ok: true, data: pick(j.data as Record<string, unknown>) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error de red" };
  }
}

export async function getMaestros(kind: MaestroKind, opts?: { todas?: boolean }): Promise<Maestro[]> {
  const url = `${endpoint(kind)}${opts?.todas ? "?todas=1" : ""}`;
  const res = await call<Maestro[]>(url, { cache: "no-store" }, (d) => (d.filas as Maestro[]) ?? []);
  return res.ok ? res.data : [];
}

export function crearMaestro(kind: MaestroKind, input: MaestroInput): Promise<Res<Maestro>> {
  return call(endpoint(kind), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }, (d) => d.fila as Maestro);
}

export function actualizarMaestro(kind: MaestroKind, id: string, patch: Partial<MaestroInput>): Promise<Res<Maestro>> {
  return call(endpoint(kind), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...patch }),
  }, (d) => d.fila as Maestro);
}

export function borrarMaestro(kind: MaestroKind, id: string): Promise<Res<{ id: string; productosAfectados: number }>> {
  return call(endpoint(kind), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  }, (d) => d as unknown as { id: string; productosAfectados: number });
}
