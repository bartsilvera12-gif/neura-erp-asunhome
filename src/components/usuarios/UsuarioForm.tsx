"use client";

import MontoInput from "@/components/ui/MontoInput";
import type { AreaUsuario, NivelUsuario, TipoContrato } from "@/lib/usuarios/types";

export const usuarioFormLabel =
  "block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1";
export const usuarioFormInput =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white";
export const usuarioFormInputGray =
  "w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900/20 bg-white";
export const usuarioFormSelect =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white";

export function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-5 pb-2 border-b border-gray-100">
        <span className="text-base">{icon}</span>
        <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">{title}</h3>
      </div>
      {children}
    </section>
  );
}

export type UsuarioFormValues = {
  nombre: string;
  email: string;
  telefono: string;
  fecha_nacimiento: string;
  fecha_ingreso: string;
  tipo_contrato: TipoContrato;
  salario_base: string;
  porcentaje_comision: string;
  ips: boolean;
  nivel: NivelUsuario;
  area: AreaUsuario;
  estado: "activo" | "inactivo";
  password: string;
  password2: string;
  /** Solo edición: módulos asignados (ids). */
  modulo_ids: string[];
  /** Vistas de dashboard permitidas (ids de catálogo). */
  dashboard_view_ids: string[];
  /** Vista por defecto al abrir el tablero (id de catálogo). */
  default_dashboard_view_id: string;
};

export function emptyUsuarioForm(): UsuarioFormValues {
  return {
    nombre: "",
    email: "",
    telefono: "",
    fecha_nacimiento: "",
    fecha_ingreso: "",
    tipo_contrato: "salario",
    salario_base: "",
    porcentaje_comision: "",
    ips: false,
    nivel: "usuario",
    area: "ventas",
    estado: "activo",
    password: "",
    password2: "",
    modulo_ids: [],
    dashboard_view_ids: [],
    default_dashboard_view_id: "",
  };
}

export function nivelFromRolDb(rol: string | null | undefined): NivelUsuario {
  const r = (rol ?? "").trim().toLowerCase();
  if (r === "administrador" || r === "admin") return "administrador";
  if (r === "supervisor") return "supervisor";
  return "usuario";
}

export function rolFromNivelForm(nivel: NivelUsuario): string {
  return nivel === "administrador" ? "administrador" : nivel;
}

export type UsuarioFormProps = {
  variant: "create" | "edit";
  form: UsuarioFormValues;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  onSalarioBaseChange: (n: number | "") => void;
  /** Clases de campo: create usa focus sky, edit usa gray (misma página detalle). */
  fieldClassName?: typeof usuarioFormInput | string;
  showPwd?: boolean;
  setShowPwd?: (v: boolean | ((p: boolean) => boolean)) => void;
  showPwd2?: boolean;
  setShowPwd2?: (v: boolean | ((p: boolean) => boolean)) => void;
  /** Debajo de “Accesos”, antes de seguridad / pie (p. ej. módulos en edición). */
  extraSections?: React.ReactNode;
  /** Solo administradores pueden cambiar nivel (rol ERP). */
  nivelAccesoDisabled?: boolean;
};

export function UsuarioFormFields({
  variant,
  form,
  onChange,
  onSalarioBaseChange,
  fieldClassName,
  showPwd = false,
  setShowPwd = () => {},
  showPwd2 = false,
  setShowPwd2 = () => {},
  extraSections,
  nivelAccesoDisabled,
}: UsuarioFormProps) {
  const fLabel = usuarioFormLabel;
  const fInput = fieldClassName ?? usuarioFormInput;
  const fSelect = usuarioFormSelect;
  const showComision = form.tipo_contrato === "comision" || form.tipo_contrato === "mixto";
  const showSalario = form.tipo_contrato !== "comision";

  return (
    <>
      <SectionCard title="Datos personales" icon="👤">
        <div className="space-y-4">
          <div>
            <label className={fLabel}>Nombre completo *</label>
            <input
              type="text"
              name="nombre"
              value={form.nombre}
              onChange={onChange}
              placeholder="Ej: JUAN PÉREZ"
              className={`${fInput} uppercase`}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={fLabel}>Email *</label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={onChange}
                placeholder="usuario@empresa.com"
                className={fInput}
                required
              />
            </div>
            <div>
              <label className={fLabel}>Teléfono</label>
              <input
                type="text"
                name="telefono"
                value={form.telefono}
                onChange={onChange}
                placeholder="0981-000000"
                className={fInput}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={fLabel}>Fecha de nacimiento</label>
              <input type="date" name="fecha_nacimiento" value={form.fecha_nacimiento} onChange={onChange} className={fInput} />
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Datos laborales" icon="💼">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={fLabel}>Fecha de ingreso</label>
              <input type="date" name="fecha_ingreso" value={form.fecha_ingreso} onChange={onChange} className={fInput} />
            </div>
            <div>
              <label className={fLabel}>Tipo de contrato</label>
              <select name="tipo_contrato" value={form.tipo_contrato} onChange={onChange} className={fSelect}>
                <option value="salario">Salario fijo</option>
                <option value="comision">Comisión</option>
                <option value="mixto">Mixto (salario + comisión)</option>
                <option value="prestador_servicio">Prestador de servicio</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {showSalario && (
              <div>
                <label className={fLabel}>Salario base (Gs.)</label>
                <MontoInput
                  value={form.salario_base}
                  onChange={(n) => onSalarioBaseChange(n)}
                  placeholder="0"
                  className={fInput}
                  decimals={false}
                />
              </div>
            )}
            {showComision && (
              <div>
                <label className={fLabel}>Comisión (%)</label>
                <input
                  type="number"
                  name="porcentaje_comision"
                  value={form.porcentaje_comision}
                  onChange={onChange}
                  min={0}
                  max={100}
                  step="0.5"
                  placeholder="0"
                  className={fInput}
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <input
              type="checkbox"
              id="ips"
              name="ips"
              checked={form.ips}
              onChange={onChange}
              className="w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900/20"
            />
            <label htmlFor="ips" className="text-sm text-gray-700 font-medium cursor-pointer">
              Cotiza IPS
              <span className="ml-1 text-xs text-gray-400 font-normal">(Instituto de Previsión Social)</span>
            </label>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Accesos del sistema" icon="🔐">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={fLabel}>Nivel de acceso</label>
            <select
              name="nivel"
              value={form.nivel}
              onChange={onChange}
              className={fSelect}
              disabled={nivelAccesoDisabled}
              aria-disabled={nivelAccesoDisabled}
            >
              <option value="usuario">Usuario</option>
              <option value="supervisor">Supervisor</option>
              <option value="administrador">Administrador</option>
            </select>
            {nivelAccesoDisabled ? (
              <p className="text-xs text-amber-700 mt-1">Solo un administrador puede cambiar el nivel de acceso.</p>
            ) : (
              <p className="text-xs text-gray-400 mt-1">
                {form.nivel === "administrador" && "Acceso total al sistema."}
                {form.nivel === "supervisor" && "Supervisión de equipo y reportes acotados."}
                {form.nivel === "usuario" && "Acceso operativo estándar."}
              </p>
            )}
          </div>
          <div>
            <label className={fLabel}>Área</label>
            <select name="area" value={form.area} onChange={onChange} className={fSelect}>
              <option value="ventas">Ventas</option>
              <option value="soporte">Soporte</option>
              <option value="finanzas">Finanzas</option>
              <option value="operaciones">Operaciones</option>
              <option value="administracion">Administración</option>
            </select>
          </div>
          <div>
            <label className={fLabel}>Estado</label>
            <select name="estado" value={form.estado} onChange={onChange} className={fSelect}>
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
            </select>
          </div>
        </div>
      </SectionCard>

      {extraSections}

      {variant === "create" ? (
        <SectionCard title="Seguridad" icon="🔑">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={fLabel}>Contraseña *</label>
              <div className="relative">
                <input
                  type={showPwd ? "text" : "password"}
                  name="password"
                  value={form.password}
                  onChange={onChange}
                  placeholder="Mínimo 6 caracteres"
                  className={`${fInput} pr-10`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                >
                  <EyeIcon open={showPwd} />
                </button>
              </div>
            </div>
            <div>
              <label className={fLabel}>Confirmar contraseña *</label>
              <div className="relative">
                <input
                  type={showPwd2 ? "text" : "password"}
                  name="password2"
                  value={form.password2}
                  onChange={onChange}
                  placeholder="Repetir contraseña"
                  className={`${fInput} pr-10`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPwd2((v) => !v)}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                >
                  <EyeIcon open={showPwd2} />
                </button>
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            La contraseña se gestiona en Supabase Auth (servidor seguro).
          </p>
        </SectionCard>
      ) : null}
    </>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path
        fillRule="evenodd"
        d="M3.28 2.22a.75.75 0 0 0-1.06 1.06l14.5 14.5a.75.75 0 1 0 1.06-1.06l-1.745-1.745a10.029 10.029 0 0 0 3.3-4.38 1.651 1.651 0 0 0 0-1.185A10.004 10.004 0 0 0 9.999 3a9.956 9.956 0 0 0-4.744 1.194L3.28 2.22ZM7.752 6.69l1.092 1.092a2.5 2.5 0 0 1 3.374 3.373l1.091 1.092a4 4 0 0 0-5.557-5.557Z"
        clipRule="evenodd"
      />
      <path d="M10.748 13.93l2.523 2.523a9.987 9.987 0 0 1-3.27.547c-4.258 0-7.894-2.66-9.337-6.41a1.651 1.651 0 0 1 0-1.186A10.007 10.007 0 0 1 2.839 6.02L6.07 9.252a4 4 0 0 0 4.678 4.678Z" />
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
      <path
        fillRule="evenodd"
        d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
