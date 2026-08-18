export type NivelUsuario    = "usuario" | "supervisor" | "administrador";
export type AreaUsuario     = "ventas" | "soporte" | "finanzas" | "operaciones" | "administracion";
export type TipoContrato    = "salario" | "comision" | "mixto" | "prestador_servicio";
export type EstadoUsuario   = "activo" | "inactivo";

export interface Usuario {
  id:             number;
  codigo_usuario: string;         // USR-0001

  // ── Datos personales ─────────────────────────────────────────────
  nombre:            string;
  email:             string;
  telefono?:         string;
  fecha_nacimiento?: string;      // YYYY-MM-DD

  // ── Datos laborales ──────────────────────────────────────────────
  fecha_ingreso?:        string;  // YYYY-MM-DD
  tipo_contrato?:        TipoContrato;
  salario_base?:         number;
  porcentaje_comision?:  number;  // 0-100
  ips:                   boolean; // cotiza IPS

  // ── Accesos del sistema ──────────────────────────────────────────
  nivel: NivelUsuario;
  area:  AreaUsuario;

  // ── Seguridad ────────────────────────────────────────────────────
  password_hash?: string;

  estado:    EstadoUsuario;
  created_at: string;             // ISO string
  updated_at: string;             // ISO string
}
