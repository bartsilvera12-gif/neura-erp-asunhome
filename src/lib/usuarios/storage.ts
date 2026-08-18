import type { EstadoUsuario, Usuario } from "./types";

// ─── Datos de ejemplo ─────────────────────────────────────────────────────────

const USUARIOS_MOCK: Usuario[] = [
  {
    id:                  1,
    codigo_usuario:      "USR-0001",
    nombre:              "ADMIN SISTEMA",
    email:               "admin@neura.com",
    telefono:            "0981-000001",
    fecha_nacimiento:    "1985-03-15",
    fecha_ingreso:       "2024-01-01",
    tipo_contrato:       "salario",
    salario_base:        5000000,
    porcentaje_comision: undefined,
    ips:                 true,
    nivel:               "administrador",
    area:                "administracion",
    estado:              "activo",
    created_at:          "2026-01-01T00:00:00.000Z",
    updated_at:          "2026-01-01T00:00:00.000Z",
  },
  {
    id:                  2,
    codigo_usuario:      "USR-0002",
    nombre:              "JUAN PÉREZ",
    email:               "jperez@neura.com",
    telefono:            "0991-112233",
    fecha_nacimiento:    "1990-07-22",
    fecha_ingreso:       "2024-03-01",
    tipo_contrato:       "mixto",
    salario_base:        2500000,
    porcentaje_comision: 5,
    ips:                 true,
    nivel:               "usuario",
    area:                "ventas",
    estado:              "activo",
    created_at:          "2026-01-15T08:00:00.000Z",
    updated_at:          "2026-01-15T08:00:00.000Z",
  },
  {
    id:                  3,
    codigo_usuario:      "USR-0003",
    nombre:              "MARIA LOPEZ",
    email:               "mlopez@neura.com",
    telefono:            "0981-445566",
    fecha_nacimiento:    "1988-11-05",
    fecha_ingreso:       "2024-06-15",
    tipo_contrato:       "salario",
    salario_base:        3500000,
    ips:                 true,
    nivel:               "supervisor",
    area:                "finanzas",
    estado:              "activo",
    created_at:          "2026-02-01T08:00:00.000Z",
    updated_at:          "2026-02-01T08:00:00.000Z",
  },
  {
    id:                  4,
    codigo_usuario:      "USR-0004",
    nombre:              "CARLOS BENÍTEZ",
    email:               "cbenitez@neura.com",
    telefono:            "0981-778899",
    fecha_ingreso:       "2025-01-10",
    tipo_contrato:       "prestador_servicio",
    salario_base:        1500000,
    ips:                 false,
    nivel:               "usuario",
    area:                "soporte",
    estado:              "inactivo",
    created_at:          "2026-02-10T08:00:00.000Z",
    updated_at:          "2026-03-01T08:00:00.000Z",
  },
];

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
