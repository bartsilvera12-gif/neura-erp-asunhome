import type { EstadoUsuario, Usuario } from "./types";

// ─── Datos de ejemplo ─────────────────────────────────────────────────────────
// Vacío: los usuarios reales de Ferrecolor viven en ferrecolor.usuarios (DB).
// Este mock legacy quedó desconectado del backend real; devolverlo vacío evita
// que aparezcan "usuarios de demo" (JUAN PÉREZ, MARIA LOPEZ, etc.) en el
// selector "Viendo como" del dashboard.

const USUARIOS_MOCK: Usuario[] = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const KEY = "neura_usuarios";

function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeSet<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // silent
  }
}

function getBase(): Usuario[] {
  const stored = safeGet<Usuario[]>(KEY, []);
  if (stored.length === 0) {
    return USUARIOS_MOCK.map((u) => ({ ...u }));
  }
  // Migración: campos nuevos ausentes en datos viejos
  return stored.map((u) => ({
    ...u,
    ips:   u.ips ?? false,
    nivel: u.nivel ?? "usuario",
    area:  u.area ?? "administracion",
  }));
}

function generarCodigo(usuarios: Usuario[]): string {
  const max = usuarios.reduce((m, u) => {
    const n = parseInt(u.codigo_usuario.replace("USR-", ""), 10) || 0;
    return n > m ? n : m;
  }, 0);
  return `USR-${String(max + 1).padStart(4, "0")}`;
}

// ─── API pública ──────────────────────────────────────────────────────────────

export function getUsuarios(): Usuario[] {
  return getBase();
}

export function getUsuario(id: number): Usuario | undefined {
  return getBase().find((u) => u.id === id);
}

export function emailExiste(email: string, excludeId?: number): boolean {
  return getBase().some(
    (u) => u.email.toLowerCase() === email.toLowerCase() && u.id !== excludeId
  );
}

export type NuevoUsuarioData = Omit<Usuario, "id" | "codigo_usuario" | "created_at" | "updated_at">;

export function saveUsuario(datos: NuevoUsuarioData): Usuario {
  const usuarios = getBase();
  const maxId    = usuarios.reduce((m, u) => (u.id > m ? u.id : m), 0);
  const now      = new Date().toISOString();

  const nuevo: Usuario = {
    ...datos,
    id:             maxId + 1,
    codigo_usuario: generarCodigo(usuarios),
    created_at:     now,
    updated_at:     now,
  };

  safeSet(KEY, [...usuarios, nuevo]);
  return nuevo;
}

export function updateUsuario(
  id: number,
  datos: Partial<Omit<Usuario, "id" | "codigo_usuario" | "created_at">>
): Usuario | null {
  const usuarios = getBase();
  const idx      = usuarios.findIndex((u) => u.id === id);
  if (idx === -1) return null;

  const actualizado: Usuario = {
    ...usuarios[idx],
    ...datos,
    updated_at: new Date().toISOString(),
  };

  usuarios[idx] = actualizado;
  safeSet(KEY, usuarios);
  return actualizado;
}

export function toggleEstadoUsuario(id: number, estado: EstadoUsuario): void {
  updateUsuario(id, { estado });
}

export function deleteUsuario(id: number): void {
  const usuarios = getBase().filter((u) => u.id !== id);
  safeSet(KEY, usuarios);
}

export function usuarioNombre(u: Usuario): string {
  return u.nombre;
}
