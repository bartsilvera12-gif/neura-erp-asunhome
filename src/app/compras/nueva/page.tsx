"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MontoInput from "@/components/ui/MontoInput";
import { saveCompra } from "@/lib/compras/storage";
import { getProveedores, proveedorExiste, createProveedor } from "@/lib/proveedores/storage";
import {
  getProductos,
  productoExiste,
  saveProducto,
} from "@/lib/inventario/storage";
import type { TipoIva, TipoPago, Moneda } from "@/lib/compras/types";
import type { Proveedor } from "@/lib/proveedores/types";
import type { MetodoValuacion, Producto } from "@/lib/inventario/types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatGs(valor: number) {
  return `Gs. ${valor.toLocaleString("es-PY")}`;
}

function margenColor(m: number) {
  if (m >= 40) return "text-green-600";
  if (m >= 20) return "text-yellow-600";
  return "text-red-600";
}

// ── Estilos ────────────────────────────────────────────────────────────────────

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm";
const inputSmClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm";
const labelClass = "block text-sm font-medium text-slate-700 mb-2";
const labelSmClass = "block text-xs font-medium text-slate-600 mb-1.5";

// ── SegmentedControl ───────────────────────────────────────────────────────────

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  small = false,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  small?: boolean;
}) {
  return (
    <div className="flex border border-slate-200 rounded-lg overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex-1 font-medium transition-colors ${
            small ? "py-2 text-xs" : "py-2.5 text-sm"
          } ${
            value === opt.value
              ? "bg-[#0EA5E9] text-white"
              : "bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────

export default function NuevaCompraPage() {
  const router = useRouter();

  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);

  // ── Formulario principal ─────────────────────────────────────────────────

  const [form, setForm] = useState({
    proveedor_id: "",
    producto_id: "",
    nro_timbrado: "",
    cantidad: "",
    moneda: "PYG" as Moneda,
    tipo_cambio: "",
    costo_unitario_input: "",
    iva_tipo: "10" as TipoIva,
    precio_venta: "",
    tipo_pago: "contado" as TipoPago,
    plazo_dias: "",
  });

  // ── Estado inline: PROVEEDOR ─────────────────────────────────────────────

  const [mostrarFormProveedor, setMostrarFormProveedor] = useState(false);
  const [formProveedor, setFormProveedor] = useState({
    nombre: "", ruc: "", telefono: "", email: "", contacto: "",
  });
  const [errorRuc, setErrorRuc] = useState<string | null>(null);
  const [proveedorCreado, setProveedorCreado] = useState<string | null>(null);

  // ── Estado inline: PRODUCTO ──────────────────────────────────────────────

  const [mostrarFormProducto, setMostrarFormProducto] = useState(false);
  const [formProducto, setFormProducto] = useState({
    nombre: "",
    sku: "",
    unidad_medida: "Unidad",
    metodo_valuacion: "CPP" as MetodoValuacion,
    stock_minimo: "0",
    precio_venta_sugerido: "",
  });
  const [errorSku, setErrorSku] = useState<string | null>(null);
  const [productoCreado, setProductoCreado] = useState<string | null>(null);
  const [errorSubmit, setErrorSubmit] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ── Carga inicial ────────────────────────────────────────────────────────

  async function recargarProveedores() {
    const data = await getProveedores();
    setProveedores(data.filter((p) => p.estado === "activo"));
  }

  function recargarProductos() {
    getProductos().then(setProductos);
  }

  useEffect(() => {
    recargarProveedores();
    recargarProductos();
  }, []);

  // ── Cálculos reactivos del formulario principal ──────────────────────────

  const cantidadNum = parseFloat(form.cantidad) || 0;
  const costoInputNum = parseFloat(form.costo_unitario_input) || 0;
  const tipoCambioNum = form.moneda === "USD"
    ? (parseFloat(form.tipo_cambio) || 0)
    : 1;
  const costoUnitarioPYG = costoInputNum * tipoCambioNum;
  const precioVentaNum = parseFloat(form.precio_venta) || 0;

  const subtotal = cantidadNum > 0 && costoUnitarioPYG > 0
    ? cantidadNum * costoUnitarioPYG
    : 0;
  const montoIva =
    form.iva_tipo === "exenta" ? 0
    : form.iva_tipo === "5"    ? subtotal * 0.05
    :                            subtotal * 0.10;
  const total = subtotal + montoIva;

  const margenVenta =
    precioVentaNum > 0 && costoUnitarioPYG > 0
      ? ((precioVentaNum - costoUnitarioPYG) / precioVentaNum) * 100
      : null;

  const calculosListos = subtotal > 0 && precioVentaNum > 0;
  const productoSeleccionado = productos.find((p) => p.id === form.producto_id);

  // Margen preview dentro del formulario de nuevo producto
  const costoParaPreview = costoUnitarioPYG > 0 ? costoUnitarioPYG : 0;
  const precioSugeridoNum = parseFloat(formProducto.precio_venta_sugerido) || 0;
  const margenPreview =
    precioSugeridoNum > 0 && costoParaPreview > 0
      ? ((precioSugeridoNum - costoParaPreview) / precioSugeridoNum) * 100
      : null;

  // ── Handlers: formulario principal ──────────────────────────────────────

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function handleProductoSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    const p = productos.find((x) => x.id === id);
    setProductoCreado(null);
    setForm((prev) => ({
      ...prev,
      producto_id: e.target.value,
      costo_unitario_input: p ? String(p.costo_promedio) : "",
      precio_venta: p ? String(p.precio_venta) : "",
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorSubmit(null);

    // Validaciones visibles (antes silenciosas)
    if (!form.proveedor_id) return setErrorSubmit("Seleccioná o agregá un proveedor.");
    if (!form.producto_id) return setErrorSubmit("Seleccioná o agregá un producto.");
    if (cantidadNum <= 0) return setErrorSubmit("La cantidad debe ser mayor a 0.");
    if (costoUnitarioPYG <= 0) return setErrorSubmit("El costo unitario debe ser mayor a 0.");
    if (precioVentaNum <= 0) return setErrorSubmit("El precio de venta debe ser mayor a 0.");
    if (!form.nro_timbrado?.trim()) return setErrorSubmit("Ingresá el N° de timbrado.");

    const todosProductos = await getProductos();
    const proveedor = proveedores.find((p) => String(p.id) === form.proveedor_id);
    const producto = todosProductos.find((p) => p.id === form.producto_id);
    if (!proveedor) return setErrorSubmit("Proveedor no encontrado. Recargá e intentá de nuevo.");
    if (!producto) return setErrorSubmit("Producto no encontrado. Recargá e intentá de nuevo.");

    setSubmitting(true);
    try {
      const res = await saveCompra({
        proveedor_id: String(proveedor.id),
        proveedor_nombre: proveedor.nombre,
        producto_id: producto.id,
        producto_nombre: producto.nombre,
        cantidad: cantidadNum,
        moneda: form.moneda,
        tipo_cambio: tipoCambioNum,
        costo_unitario_original: costoInputNum,
        costo_unitario: costoUnitarioPYG,
        iva_tipo: form.iva_tipo,
        subtotal,
        monto_iva: montoIva,
        total,
        precio_venta: precioVentaNum,
        margen_venta: margenVenta ?? 0,
        tipo_pago: form.tipo_pago,
        plazo_dias:
          form.tipo_pago === "credito" && form.plazo_dias
            ? parseInt(form.plazo_dias)
            : undefined,
        nro_timbrado: form.nro_timbrado,
      });

      if (!res.success) {
        setErrorSubmit(res.error);
        return;
      }
      if (res.warning) alert(res.warning);
      router.push("/compras");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Handlers: inline PROVEEDOR ───────────────────────────────────────────

  function handleProveedorInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.name === "ruc") setErrorRuc(null);
    const { name, value } = e.target;
    const type = e.target.type;
    let normalized = value;
    if (name === "email" || type === "email") normalized = value.toLowerCase();
    else if (["nombre", "contacto"].includes(name)) normalized = value.toUpperCase();
    setFormProveedor((prev) => ({ ...prev, [name]: normalized }));
  }

  async function handleAgregarProveedor() {
    if (!formProveedor.nombre.trim() || !formProveedor.ruc.trim()) return;
    setErrorRuc(null);
    const dup = await proveedorExiste(formProveedor.ruc);
    if (dup) {
      setErrorRuc(`RUC ya registrado para "${dup.nombre}".`);
      return;
    }
    const resultado = await createProveedor({
      nombre: formProveedor.nombre.trim().toUpperCase(),
      ruc: formProveedor.ruc.trim(),
      telefono: formProveedor.telefono.trim(),
      email: formProveedor.email.trim(),
      contacto: formProveedor.contacto.trim().toUpperCase(),
      direccion: "",
      estado: "activo",
    });
    if (!resultado.ok) {
      setErrorRuc(resultado.error);
      return;
    }
    const creado = resultado.proveedor;
    await recargarProveedores();
    setForm((prev) => ({ ...prev, proveedor_id: String(creado.id) }));
    setProveedorCreado(creado.nombre);
    setMostrarFormProveedor(false);
    setFormProveedor({ nombre: "", ruc: "", telefono: "", email: "", contacto: "" });
  }

  function handleCancelarProveedor() {
    setMostrarFormProveedor(false);
    setFormProveedor({ nombre: "", ruc: "", telefono: "", email: "", contacto: "" });
    setErrorRuc(null);
  }

  // ── Handlers: inline PRODUCTO ────────────────────────────────────────────

  function handleProductoInputChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    if (e.target.name === "sku") setErrorSku(null);
    setFormProducto((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleAgregarProducto() {
    if (!formProducto.nombre.trim() || !formProducto.sku.trim()) return;
    setErrorSku(null);

    const dup = await productoExiste(formProducto.sku, formProducto.nombre);
    if (dup) {
      setErrorSku(
        `Ya existe un producto con ese SKU o nombre ("${dup.nombre}" — ${dup.sku}).`
      );
      return;
    }

    const creado = await saveProducto({
      nombre: formProducto.nombre.trim().toUpperCase(),
      sku: formProducto.sku.trim().toUpperCase(),
      unidad_medida: formProducto.unidad_medida.toUpperCase(),
      metodo_valuacion: formProducto.metodo_valuacion,
      stock_actual: 0,   // la compra sumará el stock via ENTRADA
      stock_minimo: parseInt(formProducto.stock_minimo) || 0,
      costo_promedio: costoUnitarioPYG || 0,
      precio_venta: precioSugeridoNum || 0,
    });

    if (!creado) return;

    recargarProductos();
    setForm((prev) => ({
      ...prev,
      producto_id: creado.id,
      precio_venta: formProducto.precio_venta_sugerido || prev.precio_venta,
    }));
    setProductoCreado(creado.nombre);
    setMostrarFormProducto(false);
    setFormProducto({
      nombre: "", sku: "", unidad_medida: "Unidad",
      metodo_valuacion: "CPP", stock_minimo: "0", precio_venta_sugerido: "",
    });
  }

  function handleCancelarProducto() {
    setMostrarFormProducto(false);
    setFormProducto({
      nombre: "", sku: "", unidad_medida: "Unidad",
      metodo_valuacion: "CPP", stock_minimo: "0", precio_venta_sugerido: "",
    });
    setErrorSku(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">

      <div>
        <h1 className="text-3xl font-bold text-gray-800">Nueva compra</h1>
        <p className="text-gray-600">Cada compra guardada impacta inmediatamente en el inventario</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 max-w-2xl">
        <form className="space-y-8" onSubmit={handleSubmit}>

          {/* ── 1. Comprobante ────────────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionTitle>Comprobante</SectionTitle>
            <div>
              <label className={labelClass}>N° de timbrado</label>
              <input
                type="text"
                name="nro_timbrado"
                value={form.nro_timbrado}
                onChange={handleChange}
                placeholder="Ej: 001-001-0000001"
                className={inputClass}
              />
            </div>
          </section>

          {/* ── 2. Proveedor ──────────────────────────────────────────────── */}
          <section className="space-y-3">
            <SectionTitle>Proveedor</SectionTitle>

            <div>
              <label className={labelClass}>
                Proveedor <span className="text-red-500">*</span>
              </label>
              <select
                name="proveedor_id"
                value={form.proveedor_id}
                onChange={(e) => { handleChange(e); setProveedorCreado(null); }}
                className={inputClass}
                required
              >
                <option value="">Seleccionar proveedor...</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} — RUC {p.ruc}
                  </option>
                ))}
              </select>

              {proveedorCreado && (
                <p className="mt-1.5 text-xs text-green-600">
                  ✓ Proveedor &quot;{proveedorCreado}&quot; creado y seleccionado.
                </p>
              )}

              {!mostrarFormProveedor ? (
                <button
                  type="button"
                  onClick={() => { setMostrarFormProveedor(true); setProveedorCreado(null); }}
                  className="mt-2 text-xs text-gray-400 hover:text-gray-700 underline transition-colors"
                >
                  ¿No encontrás el proveedor? Crear nuevo
                </button>
              ) : (
                <InlineFormBox titulo="Nuevo proveedor" onCancel={handleCancelarProveedor} onSave={handleAgregarProveedor}
                  saveDisabled={!formProveedor.nombre.trim() || !formProveedor.ruc.trim()}
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className={labelSmClass}>Nombre / Razón social <span className="text-red-500">*</span></label>
                      <input type="text" name="nombre" value={formProveedor.nombre}
                        onChange={handleProveedorInputChange} placeholder="Ej: TEXTILES DEL SUR S.A."
                        className={`${inputSmClass} uppercase`} />
                    </div>
                    <div>
                      <label className={labelSmClass}>RUC <span className="text-red-500">*</span></label>
                      <input type="text" name="ruc" value={formProveedor.ruc}
                        onChange={handleProveedorInputChange} placeholder="Ej: 80012345-1"
                        className={`${inputSmClass} ${errorRuc ? "border-red-300 bg-red-50" : ""}`} />
                      {errorRuc && <p className="mt-1 text-xs text-red-600">{errorRuc}</p>}
                    </div>
                    <div>
                      <label className={labelSmClass}>Teléfono</label>
                      <input type="text" name="telefono" value={formProveedor.telefono}
                        onChange={handleProveedorInputChange} placeholder="Ej: 0981 111 222"
                        className={inputSmClass} />
                    </div>
                    <div>
                      <label className={labelSmClass}>Email</label>
                      <input type="email" name="email" value={formProveedor.email}
                        onChange={handleProveedorInputChange} placeholder="Ej: ventas@empresa.com"
                        className={inputSmClass} />
                    </div>
                    <div className="col-span-2">
                      <label className={labelSmClass}>Persona de contacto</label>
                      <input type="text" name="contacto" value={formProveedor.contacto}
                        onChange={handleProveedorInputChange} placeholder="Ej: CARLOS MENDOZA"
                        className={`${inputSmClass} uppercase`} />
                    </div>
                  </div>
                </InlineFormBox>
              )}
            </div>
          </section>

          {/* ── 3. Producto ───────────────────────────────────────────────── */}
          <section className="space-y-3">
            <SectionTitle>Producto</SectionTitle>

            <div>
              <label className={labelClass}>
                Producto <span className="text-red-500">*</span>
              </label>
              <select
                name="producto_id"
                value={form.producto_id}
                onChange={handleProductoSelectChange}
                className={inputClass}
                required
              >
                <option value="">Seleccionar producto...</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} — {p.sku} (stock: {p.stock_actual})
                  </option>
                ))}
              </select>

              {productoSeleccionado && !productoCreado && (
                <p className="mt-1.5 text-xs text-gray-400">
                  Costo promedio actual: {formatGs(productoSeleccionado.costo_promedio)}
                  &nbsp;·&nbsp;Precio de venta actual: {formatGs(productoSeleccionado.precio_venta)}
                </p>
              )}
              {productoCreado && (
                <p className="mt-1.5 text-xs text-green-600">
                  ✓ Producto &quot;{productoCreado}&quot; creado y seleccionado.
                </p>
              )}

              {!mostrarFormProducto ? (
                <button
                  type="button"
                  onClick={() => { setMostrarFormProducto(true); setProductoCreado(null); }}
                  className="mt-2 text-xs text-gray-400 hover:text-gray-700 underline transition-colors"
                >
                  ¿No encontrás el producto? Crear nuevo
                </button>
              ) : (
                <InlineFormBox titulo="Nuevo producto" onCancel={handleCancelarProducto} onSave={handleAgregarProducto}
                  saveDisabled={!formProducto.nombre.trim() || !formProducto.sku.trim()}
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className={labelSmClass}>Nombre <span className="text-red-500">*</span></label>
                      <input type="text" name="nombre" value={formProducto.nombre}
                        onChange={handleProductoInputChange} placeholder="Ej: REMERA OVERSIZE BLANCA"
                        className={`${inputSmClass} uppercase`} />
                    </div>
                    <div>
                      <label className={labelSmClass}>SKU / Código <span className="text-red-500">*</span></label>
                      <input type="text" name="sku" value={formProducto.sku}
                        onChange={handleProductoInputChange} placeholder="Ej: OOTD-005"
                        className={`${inputSmClass} uppercase ${errorSku ? "border-red-300 bg-red-50" : ""}`} />
                      {errorSku && <p className="mt-1 text-xs text-red-600">{errorSku}</p>}
                    </div>
                    <div>
                      <label className={labelSmClass}>Unidad de medida</label>
                      <select name="unidad_medida" value={formProducto.unidad_medida}
                        onChange={handleProductoInputChange} className={inputSmClass}>
                        <option value="Unidad">Unidad</option>
                        <option value="Par">Par</option>
                        <option value="Caja">Caja</option>
                        <option value="Kg">Kg</option>
                        <option value="Litro">Litro</option>
                        <option value="Metro">Metro</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelSmClass}>Stock mínimo</label>
                      <input type="number" name="stock_minimo" value={formProducto.stock_minimo}
                        onChange={handleProductoInputChange} placeholder="Ej: 5" min={0}
                        className={inputSmClass} />
                    </div>
                    <div className="col-span-2">
                      <label className={labelSmClass}>Método de valuación</label>
                      <SegmentedControl<MetodoValuacion>
                        small
                        value={formProducto.metodo_valuacion}
                        options={[
                          { value: "CPP",  label: "CPP" },
                          { value: "FIFO", label: "FIFO" },
                          { value: "LIFO", label: "LIFO" },
                        ]}
                        onChange={(v) =>
                          setFormProducto((prev) => ({ ...prev, metodo_valuacion: v }))
                        }
                      />
                    </div>
                    <div className="col-span-2">
                      <label className={labelSmClass}>Precio de venta sugerido (Gs.)</label>
                      <MontoInput
                        value={formProducto.precio_venta_sugerido}
                        onChange={(n) => setFormProducto((prev) => ({ ...prev, precio_venta_sugerido: String(n) }))}
                        placeholder="Ej: 75000"
                        className={inputSmClass}
                        decimals={false}
                      />
                      {/* Preview de margen usando el costo del formulario principal */}
                      {margenPreview !== null && (
                        <p className={`mt-1 text-xs font-medium ${margenColor(margenPreview)}`}>
                          Margen s/venta: {margenPreview.toFixed(2)}%
                          {costoUnitarioPYG > 0
                            ? ` (costo: ${formatGs(costoUnitarioPYG)})`
                            : " — completá el costo de compra para ver el margen real"}
                        </p>
                      )}
                      {!margenPreview && costoUnitarioPYG === 0 && (
                        <p className="mt-1 text-xs text-gray-400">
                          El margen se calculará con el costo de compra que ingreses abajo.
                        </p>
                      )}
                    </div>
                  </div>
                </InlineFormBox>
              )}
            </div>
          </section>

          {/* ── 4. Condiciones de pago ────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionTitle>Condiciones de pago</SectionTitle>

            <div>
              <label className={labelClass}>Tipo de pago</label>
              <SegmentedControl<TipoPago>
                value={form.tipo_pago}
                options={[
                  { value: "contado", label: "Contado" },
                  { value: "credito", label: "Crédito" },
                ]}
                onChange={(v) => setForm((prev) => ({ ...prev, tipo_pago: v }))}
              />
            </div>

            {form.tipo_pago === "credito" && (
              <div>
                <label className={labelClass}>Plazo (días)</label>
                <input type="number" name="plazo_dias" value={form.plazo_dias}
                  onChange={handleChange} placeholder="Ej: 30"
                  className={inputClass} min={1} />
              </div>
            )}
          </section>

          {/* ── 5. Moneda y costos ────────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionTitle>Moneda y costos</SectionTitle>

            <div>
              <label className={labelClass}>Moneda</label>
              <SegmentedControl<Moneda>
                value={form.moneda}
                options={[
                  { value: "PYG", label: "Guaraníes (₲)" },
                  { value: "USD", label: "Dólares (USD)" },
                ]}
                onChange={(v) =>
                  setForm((prev) => ({ ...prev, moneda: v, tipo_cambio: "" }))
                }
              />
            </div>

            {form.moneda === "USD" && (
              <div>
                <label className={labelClass}>
                  Tipo de cambio (USD → Gs.) <span className="text-red-500">*</span>
                </label>
                <MontoInput
                  value={form.tipo_cambio}
                  onChange={(n) => setForm((prev) => ({ ...prev, tipo_cambio: String(n) }))}
                  placeholder="Ej: 7500"
                  className={inputClass}
                  decimals={false}
                  required={form.moneda === "USD"}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className={labelClass}>
                  Cantidad <span className="text-red-500">*</span>
                </label>
                <input type="number" name="cantidad" value={form.cantidad}
                  onChange={handleChange} placeholder="Ej: 50"
                  className={inputClass} min={1} step={1} required />
              </div>
              <div>
                <label className={labelClass}>
                  Costo unitario ({form.moneda === "USD" ? "USD" : "Gs."})
                  <span className="text-red-500"> *</span>
                </label>
                <MontoInput
                  value={form.costo_unitario_input}
                  onChange={(n) => setForm((prev) => ({ ...prev, costo_unitario_input: String(n) }))}
                  placeholder={form.moneda === "USD" ? "Ej: 12" : "Ej: 35000"}
                  className={inputClass}
                  decimals={form.moneda === "USD"}
                  required
                />
                {form.moneda === "USD" && costoInputNum > 0 && tipoCambioNum > 0 && (
                  <p className="mt-1 text-xs text-gray-400">
                    ≈ {formatGs(costoUnitarioPYG)} por unidad
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* ── 6. IVA ───────────────────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionTitle>IVA</SectionTitle>

            <SegmentedControl<TipoIva>
              value={form.iva_tipo}
              options={[
                { value: "exenta", label: "Exenta" },
                { value: "5",      label: "IVA 5%" },
                { value: "10",     label: "IVA 10%" },
              ]}
              onChange={(v) => setForm((prev) => ({ ...prev, iva_tipo: v }))}
            />

            {subtotal > 0 && (
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-3 text-center">
                  <p className="text-xs text-gray-400 mb-1">Subtotal</p>
                  <p className="text-sm font-semibold tabular-nums text-gray-700">{formatGs(subtotal)}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-3 text-center">
                  <p className="text-xs text-gray-400 mb-1">IVA</p>
                  <p className="text-sm font-semibold tabular-nums text-gray-700">
                    {form.iva_tipo === "exenta" ? "—" : formatGs(montoIva)}
                  </p>
                </div>
                <div className="bg-[#0EA5E9] text-white rounded-lg px-3 py-3 text-center">
                  <p className="text-xs text-gray-300 mb-1">Total</p>
                  <p className="text-sm font-bold tabular-nums">{formatGs(total)}</p>
                </div>
              </div>
            )}
          </section>

          {/* ── 7. Precio de venta ────────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionTitle>Precio de venta</SectionTitle>

            <div>
              <label className={labelClass}>
                Precio de venta (Gs.) <span className="text-red-500">*</span>
              </label>
              <MontoInput
                value={form.precio_venta}
                onChange={(n) => setForm((prev) => ({ ...prev, precio_venta: String(n) }))}
                placeholder="Ej: 75000"
                className={inputClass}
                decimals={false}
                required
              />
              <p className="mt-1 text-xs text-gray-400">
                Se actualizará en inventario al guardar la compra.
              </p>
            </div>

            {margenVenta !== null && calculosListos && (
              <div
                className={`rounded-lg px-4 py-3 border flex justify-between items-center ${
                  margenVenta < 0 ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200"
                }`}
              >
                <span className="text-sm text-gray-600">Margen sobre venta</span>
                <span className={`text-lg font-bold tabular-nums ${margenColor(margenVenta)}`}>
                  {margenVenta < 0 ? "⚠ " : ""}{margenVenta.toFixed(2)}%
                  {margenVenta < 0 && (
                    <span className="ml-2 text-xs font-normal text-red-500">pérdida</span>
                  )}
                </span>
              </div>
            )}
          </section>

          {/* ── Banner impacto en inventario ──────────────────────────────── */}
          {calculosListos && productoSeleccionado && (
            <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-xs text-green-700">
              <span className="mt-0.5 text-base leading-none">✓</span>
              <span>
                Al guardar se registrará una{" "}
                <strong>entrada de {cantidadNum} unidades</strong> de{" "}
                <strong>{productoSeleccionado.nombre}</strong> en inventario.
              </span>
            </div>
          )}

          {errorSubmit && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700">{errorSubmit}</p>
            </div>
          )}

          {/* ── Acciones ─────────────────────────────────────────────────── */}
          <div className="flex gap-4 pt-2">
            <button
              type="submit"
              disabled={!calculosListos || submitting}
              className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-5 py-3 rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
            >
              {submitting ? "Guardando..." : "Guardar compra"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/compras")}
              className="border border-slate-200 px-5 py-3 rounded-lg text-sm hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
          </div>

        </form>
      </div>

    </div>
  );
}

// ── Sub-componentes ────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
      {children}
    </h3>
  );
}

function InlineFormBox({
  titulo,
  children,
  onSave,
  onCancel,
  saveDisabled,
}: {
  titulo: string;
  children: React.ReactNode;
  onSave: () => void;
  onCancel: () => void;
  saveDisabled: boolean;
}) {
  return (
    <div className="mt-4 border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-4">
      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
        {titulo}
      </p>
      {children}
      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onSave}
          disabled={saveDisabled}
          className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
        >
          Guardar {titulo.toLowerCase()}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="border border-slate-200 px-4 py-2 rounded-lg text-xs hover:bg-white transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
