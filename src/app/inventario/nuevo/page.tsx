"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MontoInput from "@/components/ui/MontoInput";
import SelectFromList from "@/components/inventario/SelectFromList";
import { productoExiste, saveProducto } from "@/lib/inventario/storage";
import type { MetodoValuacion } from "@/lib/inventario/types";

// Opciones estándar de unidad de medida para gastro
const UNIDADES_OPCIONES = [
  "UNIDAD","KG","G","LT","ML","CAJA","BOLSA","PAQUETE","DOCENA","LATA","BOTELLA","PORCION","COMBO",
] as const;

const TIPO_SUMMARY = {
  reventa: { titulo: "Producto de reventa", descripcion: "Se compra y se vende tal cual. Controla stock y descuenta al vender.", icono: "🥤" },
  menu:    { titulo: "Producto del menú",   descripcion: "Se vende en Ventas y genera pedido. No descuenta stock directo.",     icono: "🍕" },
  materia: { titulo: "Materia prima / insumo", descripcion: "Se usa para recetas y costeo. No aparece como producto de venta.", icono: "🌾" },
} as const;

interface CatRow { id: string; nombre: string }
interface UbiRow { id: string; nombre: string; tipo: string }
interface ProvRow { id: string; nombre: string }

export default function NuevoProductoPage() {
  const router = useRouter();
  const [errorDuplicado, setErrorDuplicado] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  const [form, setForm] = useState({
    nombre: "",
    descripcion: "",
    sku: "",
    codigo_barras: "",
    costo_promedio: "",
    markup: "",
    precio_venta: "",
    stock_actual: "",
    stock_minimo: "",
    unidad_medida: "",
    metodo_valuacion: "CPP" as MetodoValuacion,
  });
  const [submitting, setSubmitting] = useState(false);
  const [generandoCodigo, setGenerandoCodigo] = useState(false);
  const [codigoGeneradoInterno, setCodigoGeneradoInterno] = useState(false);

  // Relaciones opcionales
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [ubicacionId, setUbicacionId] = useState<string | null>(null);
  const [proveedorId, setProveedorId] = useState<string | null>(null);

  // Clasificación gastronómica
  const [esVendible, setEsVendible] = useState(true);
  const [esInsumo, setEsInsumo] = useState(false);

  // Selector inicial de tipo gastronómico — aplica presets a los flags
  type TipoGastro = "reventa" | "menu" | "materia" | null;
  const [tipoGastro, setTipoGastro] = useState<TipoGastro>(null);
  function aplicarTipoGastro(tipo: Exclude<TipoGastro, null>) {
    setTipoGastro(tipo);
    if (tipo === "reventa") {
      setEsVendible(true);
      setEsInsumo(false);
      setControlaStock(true);
      setForm((prev) => ({ ...prev, unidad_medida: prev.unidad_medida || "UNIDAD" }));
    } else if (tipo === "menu") {
      setEsVendible(true);
      setEsInsumo(false);
      setControlaStock(false);
      setForm((prev) => ({ ...prev, unidad_medida: prev.unidad_medida || "UNIDAD" }));
    } else {
      setEsVendible(false);
      setEsInsumo(true);
      setControlaStock(false);
      setForm((prev) => ({ ...prev, unidad_medida: prev.unidad_medida || "G" }));
    }
  }

  // Configuración gastronómica
  const [controlaStock, setControlaStock] = useState(true);
  const [valorizado, setValorizado] = useState(true);
  const [unidadCompra, setUnidadCompra] = useState("");
  const [unidadReceta, setUnidadReceta] = useState("");
  const [factorCompraReceta, setFactorCompraReceta] = useState("1");
  const [tiempoPrepMinutos, setTiempoPrepMinutos] = useState("0");
  const [categorias, setCategorias] = useState<CatRow[]>([]);
  const [ubicaciones, setUbicaciones] = useState<UbiRow[]>([]);
  const [proveedores, setProveedores] = useState<ProvRow[]>([]);

  useEffect(() => {
    let cancel = false;
    async function load(url: string) {
      try {
        const r = await fetch(url, { credentials: "include" });
        const j = await r.json();
        return r.ok && j?.success ? j.data : null;
      } catch { return null; }
    }
    (async () => {
      const [cats, ubis, provs] = await Promise.all([
        load("/api/inventario/categorias"),
        load("/api/inventario/ubicaciones"),
        load("/api/proveedores"),
      ]);
      if (cancel) return;
      if (cats?.categorias) setCategorias(cats.categorias as CatRow[]);
      if (ubis?.ubicaciones) setUbicaciones(ubis.ubicaciones as UbiRow[]);
      if (provs?.proveedores) setProveedores(provs.proveedores as ProvRow[]);
    })();
    return () => { cancel = true; };
  }, []);

  // Imagen pendiente de subir (se sube luego de crear el producto, con su ID).
  const [imagenFile, setImagenFile] = useState<File | null>(null);
  const [imagenPreview, setImagenPreview] = useState<string | null>(null);
  const [imagenError, setImagenError] = useState<string | null>(null);

  const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
  const MAX_IMG_BYTES = 5 * 1024 * 1024;

  function handleImagenChange(e: React.ChangeEvent<HTMLInputElement>) {
    setImagenError(null);
    const f = e.target.files?.[0] ?? null;
    if (!f) {
      setImagenFile(null);
      setImagenPreview(null);
      return;
    }
    if (!ALLOWED_MIME.includes(f.type)) {
      setImagenError("Formato no permitido. Usá JPG, PNG o WebP.");
      e.target.value = "";
      return;
    }
    if (f.size > MAX_IMG_BYTES) {
      setImagenError("Imagen demasiado grande (máx. 5 MB).");
      e.target.value = "";
      return;
    }
    setImagenFile(f);
    setImagenPreview(URL.createObjectURL(f));
  }

  function quitarImagen() {
    setImagenFile(null);
    setImagenPreview(null);
    setImagenError(null);
  }

  async function handleGenerarCodigoInterno() {
    if (generandoCodigo) return;
    setGenerandoCodigo(true);
    setErrorDuplicado(null);
    setErrorGeneral(null);
    try {
      const res = await fetch("/api/productos/codigo-interno", {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json();
      if (res.ok && json?.success && json.data?.codigo) {
        setForm((prev) => ({ ...prev, codigo_barras: json.data.codigo as string }));
        setCodigoGeneradoInterno(true);
      } else {
        setErrorGeneral(json?.error ?? "No se pudo generar el código.");
      }
    } catch (err) {
      setErrorGeneral(err instanceof Error ? err.message : "Error de red");
    } finally {
      setGenerandoCodigo(false);
    }
  }

  // Campos sin lógica reactiva
  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) {
    setErrorDuplicado(null);
    setErrorGeneral(null);
    if (e.target.name === "codigo_barras") setCodigoGeneradoInterno(false);
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  /**
   * Al cambiar costo: NO movemos el precio (es lo que el cliente paga).
   * Recalculamos markup a partir del gap precio-costo cuando ambos son válidos.
   */
  function handleCostoChange(costo: number) {
    setErrorDuplicado(null);
    const precio = parseFloat(form.precio_venta);

    if (!isNaN(costo) && costo > 0 && !isNaN(precio) && precio > 0) {
      const nuevoMarkup = ((precio - costo) / costo) * 100;
      setForm((prev) => ({
        ...prev,
        costo_promedio: String(costo),
        markup: nuevoMarkup.toFixed(2),
      }));
    } else {
      setForm((prev) => ({ ...prev, costo_promedio: String(costo) }));
    }
  }

  /**
   * Al cambiar markup → recalcula precio_venta (permite markup negativo = venta a pérdida)
   */
  function handleMarkupChange(e: React.ChangeEvent<HTMLInputElement>) {
    setErrorDuplicado(null);
    const markup = parseFloat(e.target.value);
    const costo = parseFloat(form.costo_promedio);

    if (!isNaN(markup) && !isNaN(costo) && costo > 0) {
      const nuevoPrecio = costo * (1 + markup / 100);
      setForm((prev) => ({
        ...prev,
        markup: e.target.value,
        precio_venta: nuevoPrecio.toFixed(0),
      }));
    } else {
      setForm((prev) => ({ ...prev, markup: e.target.value }));
    }
  }

  /**
   * Al cambiar precio → recalcula markup (puede resultar negativo si precio < costo)
   */
  function handlePrecioChange(precio: number) {
    setErrorDuplicado(null);
    const costo = parseFloat(form.costo_promedio);

    if (!isNaN(precio) && !isNaN(costo) && costo > 0) {
      const nuevoMarkup = ((precio - costo) / costo) * 100;
      setForm((prev) => ({
        ...prev,
        precio_venta: String(precio),
        markup: nuevoMarkup.toFixed(2),
      }));
    } else {
      setForm((prev) => ({ ...prev, precio_venta: String(precio) }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    console.log("[inventario/nuevo] handleSubmit start", { tipoGastro });
    if (submitting) return;
    setErrorDuplicado(null);
    setErrorGeneral(null);
    setSubmitting(true);

    const showErr = (msg: string) => {
      setErrorGeneral(msg);
      try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
    };

    try {
      // Validaciones básicas en JS (HTML5 desactivado con noValidate).
      const nombreT = form.nombre.trim();
      if (!nombreT) { showErr("El nombre es obligatorio."); return; }
      if (tipoGastro === "reventa" && !form.sku.trim()) { showErr("El SKU es obligatorio para productos de reventa."); return; }

      const codigoEnInput = form.codigo_barras.trim();
      const esIntManual = !!codigoEnInput && /^INT-/i.test(codigoEnInput) && !codigoGeneradoInterno;
      if (esIntManual) {
        showErr('El prefijo "INT-" está reservado para códigos internos generados por el sistema. Dejá el campo vacío y guardá, o usá el botón "Generar código interno".');
        return;
      }

      // Pre-chequeo duplicado tolerante a fallos de red.
      try {
        const duplicado = await productoExiste(form.sku, form.nombre);
        if (duplicado) {
          setErrorDuplicado(`Ya existe "${duplicado.nombre}" con SKU ${duplicado.sku}.`);
          try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
          return;
        }
      } catch (err) {
        console.warn("[inventario/nuevo] productoExiste failed, ignorando:", err);
      }
      // Resolver codigo: si vino del botón → ya está en el input con interno=true.
      // Si el usuario escribió uno → manual (interno=false).
      // Si está vacío → pedir uno interno al backend.
      let codigo: string | null = codigoEnInput || null;
      let interno = codigoGeneradoInterno && !!codigoEnInput;
      if (!codigo) {
        try {
          const res = await fetch("/api/productos/codigo-interno", {
            method: "POST",
            credentials: "include",
          });
          const json = await res.json();
          if (res.ok && json?.success && json.data?.codigo) {
            codigo = json.data.codigo as string;
            interno = true;
          }
        } catch {
          codigo = null;
        }
      }

      let guardado;
      try {
        guardado = await saveProducto({
          nombre: form.nombre.trim().toUpperCase(),
          descripcion: form.descripcion.trim() || null,
          sku: form.sku.trim().toUpperCase(),
          costo_promedio: parseFloat(form.costo_promedio) || 0,
          precio_venta: parseFloat(form.precio_venta) || 0,
          stock_actual: parseInt(form.stock_actual) || 0,
          stock_minimo: parseInt(form.stock_minimo) || 0,
          unidad_medida: form.unidad_medida.trim().toUpperCase(),
          metodo_valuacion: form.metodo_valuacion,
          codigo_barras: codigo,
          codigo_barras_interno: interno,
          categoria_principal_id: categoriaId,
          ubicacion_principal_id: ubicacionId,
          proveedor_principal_id: proveedorId,
          es_vendible: esVendible,
          es_insumo: esInsumo,
          controla_stock: controlaStock,
          valorizado: valorizado,
          unidad_compra: unidadCompra.trim() || null,
          unidad_receta: unidadReceta.trim() || null,
          factor_compra_receta: Math.max(parseFloat(factorCompraReceta) || 1, 0.0001),
          tiempo_prep_minutos: Math.max(parseInt(tiempoPrepMinutos) || 0, 0),
        });
      } catch (err) {
        console.error("[inventario/nuevo] saveProducto error:", err);
        showErr(err instanceof Error ? err.message : "No se pudo guardar el producto.");
        return;
      }

      if (!guardado) {
        showErr("No se pudo guardar el producto. Revisá los datos e intentá nuevamente.");
        return;
      }

      // Subir imagen (post-creacion, con producto_id real)
      if (imagenFile) {
        try {
          const fd = new FormData();
          fd.append("file", imagenFile);
          const up = await fetch(`/api/productos/${guardado.id}/imagen`, {
            method: "POST",
            body: fd,
            credentials: "include",
          });
          const upJson = await up.json();
          if (!up.ok || !upJson?.success) {
            // Producto creado, imagen falló. No perder el producto: ir a editar con aviso.
            const msg = upJson?.error ?? "No se pudo subir la imagen.";
            alert(`Producto creado correctamente, pero la imagen no pudo subirse: ${msg}\n\nPodés intentar subirla nuevamente desde la edición del producto.`);
            router.push(`/inventario/${guardado.id}/editar`);
            return;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Error de red";
          alert(`Producto creado correctamente, pero la imagen no pudo subirse: ${msg}\n\nPodés intentar subirla nuevamente desde la edición del producto.`);
          router.push(`/inventario/${guardado.id}/editar`);
          return;
        }
      }

      router.push("/inventario");
    } catch (err) {
      console.error("[inventario/nuevo] handleSubmit error:", err);
      showErr(err instanceof Error ? err.message : "No se pudo guardar el producto.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Cálculos en tiempo real ──────────────────────────────────────────────────
  const costo = parseFloat(form.costo_promedio);
  const precio = parseFloat(form.precio_venta);
  const tieneAmbos = !isNaN(costo) && !isNaN(precio) && costo > 0 && precio > 0;
  const markupCalc = tieneAmbos ? ((precio - costo) / costo) * 100 : null;
  const margenVentaCalc = tieneAmbos ? ((precio - costo) / precio) * 100 : null;
  const esPerdida = markupCalc !== null && markupCalc < 0;

  const inputClass =
    "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm";
  const labelClass = "block text-sm font-medium text-slate-700 mb-2";

  // Paso 0: selector inicial de tipo de producto
  if (tipoGastro === null) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Nuevo producto</h1>
          <p className="text-gray-600">¿Qué tipo de producto vas a cargar?</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-5xl">
          {([
            {
              tipo: "reventa" as const,
              titulo: "Producto de reventa",
              icono: "🥤",
              ejemplo: "Gaseosas, agua, jugos, postres comprados",
              descripcion: "Se compra y se vende tal cual. Controla stock y descuenta al vender.",
              acento: "border-sky-300 bg-sky-50/40 hover:border-sky-500",
            },
            {
              tipo: "menu" as const,
              titulo: "Producto del menú",
              icono: "🍕",
              ejemplo: "Pizzas, lomitos, hamburguesas, combos",
              descripcion: "Producto preparado por el local. No descuenta stock directo (usá receta para costeo).",
              acento: "border-amber-300 bg-amber-50/40 hover:border-amber-500",
            },
            {
              tipo: "materia" as const,
              titulo: "Materia prima / insumo",
              icono: "🌾",
              ejemplo: "Harina, queso, salsa, carne, envases",
              descripcion: "Insumo para recetas. Sólo se usa para costear productos del menú.",
              acento: "border-emerald-300 bg-emerald-50/40 hover:border-emerald-500",
            },
          ]).map((opt) => (
            <button
              key={opt.tipo}
              type="button"
              onClick={() => aplicarTipoGastro(opt.tipo)}
              className={`text-left rounded-xl border-2 ${opt.acento} p-5 transition-all hover:shadow-md`}
            >
              <div className="text-3xl mb-2">{opt.icono}</div>
              <div className="text-base font-semibold text-slate-900">{opt.titulo}</div>
              <div className="mt-1 text-xs italic text-slate-500">Ej: {opt.ejemplo}</div>
              <div className="mt-3 text-sm text-slate-700">{opt.descripcion}</div>
            </button>
          ))}
        </div>
        <div>
          <button
            type="button"
            onClick={() => router.push("/inventario")}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Cancelar
          </button>
        </div>
      </div>
    );
  }

  const summary = TIPO_SUMMARY[tipoGastro];
  const showStock = tipoGastro === "reventa";
  const showPrecioVenta = tipoGastro !== "materia";

  return (
    <div className="space-y-8">

      <div>
        <h1 className="text-3xl font-bold text-gray-800">Nuevo producto</h1>
      </div>

      <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-5 max-w-5xl">
        <div className="flex items-start gap-4">
          <div className="text-3xl">{summary.icono}</div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-semibold text-slate-900">{summary.titulo}</div>
            <div className="text-sm text-slate-600 mt-0.5">{summary.descripcion}</div>
          </div>
          <button
            type="button"
            onClick={() => setTipoGastro(null)}
            className="text-xs text-amber-700 hover:text-amber-900 underline shrink-0"
          >
            Cambiar tipo
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-6 max-w-5xl">
        <form className="space-y-6" onSubmit={handleSubmit} noValidate>

          {/* Error general (validacion de codigo, duplicado de codigo barras, etc.) */}
          {errorGeneral && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700">{errorGeneral}</p>
            </div>
          )}

          {/* Error de duplicado (mismo SKU o mismo nombre) */}
          {errorDuplicado && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-1">
              <p className="text-sm font-semibold text-red-700">
                Este producto ya existe en el inventario.
              </p>
              <p className="text-xs text-red-600">{errorDuplicado}</p>
              <p className="text-xs text-red-500">
                Para modificar su stock debés registrar un movimiento de inventario.
              </p>
              <Link
                href="/inventario/movimientos"
                className="inline-block mt-2 text-xs text-red-700 underline hover:text-red-900"
              >
                Ir a Movimientos →
              </Link>
            </div>
          )}

          {/* Nombre */}
          <div>
            <label className={labelClass}>Nombre del producto</label>
            <input
              type="text"
              name="nombre"
              value={form.nombre}
              onChange={handleChange}
              placeholder="Ej: HAMBURGUESA CASERA"
              className={`${inputClass} uppercase`}
              required
            />
          </div>

          {/* Descripción */}
          <div>
            <label className={labelClass}>
              Descripción
              {tipoGastro === "menu" && <span className="text-xs font-normal text-amber-700 ml-2">(visible al cliente)</span>}
            </label>
            <textarea
              name="descripcion"
              value={form.descripcion}
              onChange={handleChange}
              placeholder={
                tipoGastro === "menu"
                  ? "Ej: Pan, carne, huevo, doble queso, lechuga, tomate, mayonesa."
                  : "Descripción opcional del producto"
              }
              rows={tipoGastro === "menu" ? 3 : 2}
              className={inputClass}
            />
          </div>

          {/* SKU + Unidad de medida */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className={labelClass}>
                SKU{tipoGastro === "reventa" ? "" : <span className="text-xs font-normal text-gray-400 ml-1">(opcional)</span>}
              </label>
              <input
                type="text"
                name="sku"
                value={form.sku}
                onChange={handleChange}
                placeholder="Ej: OOTD-001"
                className={`${inputClass} uppercase`}
                required={tipoGastro === "reventa"}
              />
            </div>

            <div className={tipoGastro === "menu" ? "hidden" : ""}>
              <label className={labelClass}>Unidad de medida</label>
              <select
                name="unidad_medida"
                value={form.unidad_medida}
                onChange={handleChange}
                className={`${inputClass} uppercase`}
                required={tipoGastro !== "menu"}
              >
                {UNIDADES_OPCIONES.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Código de barras */}
          <div>
            <label className={labelClass}>
              Código de barras
              {codigoGeneradoInterno && form.codigo_barras && (
                <span className="ml-2 align-middle text-[10px] uppercase tracking-wider bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded">
                  Interno
                </span>
              )}
            </label>
            <input
              type="text"
              name="codigo_barras"
              value={form.codigo_barras}
              onChange={handleChange}
              placeholder="Escaneá o escribí — dejá vacío para autogenerar"
              className={inputClass}
              autoComplete="off"
            />
            <div className="mt-2">
              <button
                type="button"
                onClick={handleGenerarCodigoInterno}
                disabled={generandoCodigo}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 hover:text-sky-900 border border-sky-200 hover:bg-sky-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                  <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0v2.431l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z" clipRule="evenodd" />
                </svg>
                {generandoCodigo ? "Generando..." : "Generar código interno"}
              </button>
              <span className="ml-2 text-xs text-gray-400">(opcional)</span>
            </div>
          </div>

          {/* Imagen del producto */}
          <div>
            <label className={labelClass}>Imagen del producto</label>
            <div className="flex items-start gap-4">
              <div className="w-28 h-28 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                {imagenPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imagenPreview} alt="Vista previa" className="w-full h-full object-cover" />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-8 h-8 text-slate-300">
                    <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909.47.47a.75.75 0 1 1-1.06 1.06L6.53 8.091a.75.75 0 0 0-1.06 0L2.5 11.06ZM12 6.5a1 1 0 1 1 2 0 1 1 0 0 1-2 0Z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm px-4 py-2 rounded-lg cursor-pointer transition-colors">
                    {imagenFile ? "Cambiar imagen" : "Seleccionar imagen"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={handleImagenChange}
                    />
                  </label>
                  {imagenFile && (
                    <button
                      type="button"
                      onClick={quitarImagen}
                      className="text-sm text-red-600 hover:text-red-800 px-3 py-2 rounded-lg border border-slate-200 hover:bg-red-50"
                    >
                      Quitar
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-slate-400">
                  JPG, PNG o WebP — máx. 5 MB. Se asociará al producto al guardarlo.
                </p>
                {imagenError && (
                  <p className="mt-1.5 text-xs text-red-600">{imagenError}</p>
                )}
              </div>
            </div>
          </div>

          {/* Costo + Markup + Precio — bloque reactivo */}
          <div>
            <p className="text-xs text-gray-400 mb-3 uppercase tracking-wide font-semibold">
              Precios — los tres campos son reactivos entre sí
            </p>
            <div className="grid grid-cols-3 gap-6">

              <div>
                <label className={labelClass}>Costo promedio (Gs.)</label>
                <MontoInput
                  value={form.costo_promedio}
                  onChange={handleCostoChange}
                  placeholder="Ej: 52000"
                  className={inputClass}
                  decimals={false}
                  required
                />
              </div>

              <div>
                <label className={labelClass}>Markup s/costo (%)</label>
                <div className="relative">
                  <input
                    type="number"
                    name="markup"
                    value={form.markup}
                    onChange={handleMarkupChange}
                    placeholder="Ej: 50.00"
                    className={`${inputClass} pr-8`}
                    step="0.01"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">
                    %
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-gray-400">(precio − costo) / costo</p>
              </div>

              <div className={showPrecioVenta ? "" : "hidden"}>
                <label className={labelClass}>Precio de venta (Gs.)</label>
                <MontoInput
                  value={form.precio_venta}
                  onChange={handlePrecioChange}
                  placeholder="Ej: 78000"
                  className={inputClass}
                  decimals={false}
                  required={showPrecioVenta}
                />
              </div>

            </div>

            {/* Indicadores de rentabilidad en tiempo real */}
            {tieneAmbos && markupCalc !== null && margenVentaCalc !== null && (
              <div className="mt-4 space-y-3">

                {/* Advertencia de pérdida */}
                {esPerdida && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-600">
                    <span className="mt-0.5 text-base leading-none">⚠</span>
                    <span>
                      El precio de venta es <strong>menor al costo</strong>. Cada unidad vendida generará una pérdida neta.
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* Markup */}
                  <div className={`border rounded-lg px-4 py-3 ${esPerdida ? "bg-red-50 border-red-200" : "bg-blue-50 border-blue-100"}`}>
                    <p className={`text-xs font-medium mb-1 ${esPerdida ? "text-red-500" : "text-blue-500"}`}>
                      Markup sobre costo
                    </p>
                    <p className={`text-lg font-bold tabular-nums ${esPerdida ? "text-red-700" : "text-blue-700"}`}>
                      {markupCalc.toFixed(2)}%
                    </p>
                    <p className={`text-xs mt-0.5 ${esPerdida ? "text-red-400" : "text-blue-400"}`}>
                      {esPerdida
                        ? `Se vende ${Math.abs(markupCalc).toFixed(0)}% por debajo del costo`
                        : `Se agrega ${markupCalc.toFixed(0)}% encima del costo`}
                    </p>
                  </div>

                  {/* Margen sobre venta */}
                  <div className={`border rounded-lg px-4 py-3 ${esPerdida ? "bg-red-50 border-red-200" : "bg-green-50 border-green-100"}`}>
                    <p className={`text-xs font-medium mb-1 ${esPerdida ? "text-red-500" : "text-green-500"}`}>
                      Margen sobre venta
                    </p>
                    <p className={`text-lg font-bold tabular-nums ${esPerdida ? "text-red-700" : "text-green-700"}`}>
                      {margenVentaCalc.toFixed(2)}%
                    </p>
                    <p className={`text-xs mt-0.5 ${esPerdida ? "text-red-400" : "text-green-400"}`}>
                      {esPerdida
                        ? "Este precio genera pérdida neta en cada venta"
                        : `De cada Gs. vendido, ${margenVentaCalc.toFixed(0)}% es ganancia`}
                    </p>
                  </div>
                </div>

              </div>
            )}
          </div>

          {/* Clasificación, Proveedor, Ubicación */}
          <div className="border-t border-slate-100 pt-6">
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold">
                Clasificación y ubicación
              </p>
              <span className="text-xs text-gray-400">Opcional</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              {/* Categoría — 4 cols */}
              <div className="md:col-span-4 min-w-0">
                <label className={labelClass}>Categoría principal</label>
                <SelectFromList
                  value={categoriaId}
                  onChange={setCategoriaId}
                  options={categorias.map((c) => ({ id: c.id, label: c.nombre }))}
                  emptyShort="Sin categorías"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-400 truncate">
                    {categorias.length === 0 ? "Todavía no cargaste categorías." : `${categorias.length} disponibles`}
                  </span>
                  <Link
                    href="/inventario/categorias"
                    className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900 border border-sky-200 hover:bg-sky-50 px-2.5 py-1 rounded-md transition-colors"
                  >
                    + Crear
                  </Link>
                </div>
              </div>

              {/* Proveedor — 4 cols. Oculto para Menú (productos preparados no tienen proveedor). */}
              <div className={`md:col-span-4 min-w-0 ${tipoGastro === "menu" ? "hidden" : ""}`}>
                <label className={labelClass}>Proveedor principal</label>
                <SelectFromList
                  value={proveedorId}
                  onChange={setProveedorId}
                  options={proveedores.map((p) => ({ id: p.id, label: p.nombre }))}
                  emptyShort="Sin proveedores"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-400 truncate">
                    {proveedores.length === 0 ? "Todavía no cargaste proveedores." : `${proveedores.length} disponibles`}
                  </span>
                  <Link
                    href="/proveedores/nuevo"
                    className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900 border border-sky-200 hover:bg-sky-50 px-2.5 py-1 rounded-md transition-colors"
                  >
                    + Crear
                  </Link>
                </div>
              </div>

              {/* Ubicación principal — oculta en instancia En lo de Mari (no aplica para gastronomía).
                  Lógica/state preservados; submit envía ubicacionId que queda en null por defecto. */}
              <div className="hidden md:col-span-4 min-w-0">
                <label className={labelClass}>Ubicación principal</label>
                <SelectFromList
                  value={ubicacionId}
                  onChange={setUbicacionId}
                  options={ubicaciones.map((u) => ({ id: u.id, label: u.nombre, sublabel: u.tipo }))}
                  emptyShort="Sin ubicaciones"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-400 truncate">
                    {ubicaciones.length === 0 ? "Todavía no cargaste ubicaciones." : `${ubicaciones.length} disponibles`}
                  </span>
                  <Link
                    href="/inventario/ubicaciones"
                    className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900 border border-sky-200 hover:bg-sky-50 px-2.5 py-1 rounded-md transition-colors"
                  >
                    + Crear
                  </Link>
                </div>
              </div>
            </div>

            {/* Clasificación gastronómica — oculta (presets aplicados por el tipo seleccionado) */}
            <div className="hidden mt-5 pt-4 border-t border-gray-100">
              <label className={labelClass}>Clasificación</label>
              <div className="flex flex-wrap gap-4 mt-1">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={esVendible}
                    onChange={(e) => setEsVendible(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                  />
                  Vendible (se vende al cliente final)
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={esInsumo}
                    onChange={(e) => setEsInsumo(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                  />
                  Insumo (se usa en recetas)
                </label>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Puede ser ambos (producto mixto). Por defecto: vendible.
              </p>
            </div>

            {/* Configuración gastronómica — oculta (campos técnicos no necesarios en UX gastro simplificada) */}
            <div className="hidden mt-5 pt-4 border-t border-gray-100">
              <p className="text-xs uppercase tracking-wide font-semibold text-gray-500 mb-3">
                Configuración gastronómica
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={controlaStock}
                    onChange={(e) => setControlaStock(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                  />
                  Controlar stock
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={valorizado}
                    onChange={(e) => setValorizado(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                  />
                  Valorizado
                </label>
                <div>
                  <label className={labelClass}>Unidad de compra</label>
                  <input
                    type="text"
                    value={unidadCompra}
                    onChange={(e) => setUnidadCompra(e.target.value)}
                    placeholder='Ej: "Bolsa 25kg"'
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Unidad de receta</label>
                  <input
                    type="text"
                    value={unidadReceta}
                    onChange={(e) => setUnidadReceta(e.target.value)}
                    placeholder='Ej: "g"'
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Factor compra → receta</label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0.0001"
                    value={factorCompraReceta}
                    onChange={(e) => setFactorCompraReceta(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Tiempo preparación (min)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={tiempoPrepMinutos}
                    onChange={(e) => setTiempoPrepMinutos(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Ejemplo: Harina se compra por bolsa de 25kg, pero se usa en recetas por gramos. En ese caso unidad compra = bolsa 25kg, unidad receta = g, factor = 25000.
              </p>
            </div>
          </div>

          {/* Stock actual + Stock mínimo — solo para Reventa (Menú/Materia no controlan stock en UX simple) */}
          <div className={showStock ? "" : "hidden"}>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className={labelClass}>Stock actual</label>
                <input
                  type="number"
                  name="stock_actual"
                  value={form.stock_actual}
                  onChange={handleChange}
                  placeholder="Ej: 50"
                  className={inputClass}
                  min={0}
                  required={showStock}
                />
              </div>

              <div>
                <label className={labelClass}>Stock mínimo</label>
                <input
                  type="number"
                  name="stock_minimo"
                  value={form.stock_minimo}
                  onChange={handleChange}
                  placeholder="Ej: 10"
                  className={inputClass}
                  min={0}
                  required={showStock}
                />
              </div>
            </div>
            {parseInt(form.stock_actual) > 0 && (
              <p className="mt-2 text-xs text-gray-400">
                Se generará automáticamente un movimiento de inventario inicial con {form.stock_actual} unidades al guardar.
              </p>
            )}
          </div>

          {/* Método de valuación — oculto en instancia En lo de Mari.
              Se mantiene siempre 'CPP' (default del state form.metodo_valuacion) y se envía al backend tal cual. */}
          <div className="hidden">
            <label className={labelClass}>Método de valuación</label>
            <select
              name="metodo_valuacion"
              value={form.metodo_valuacion}
              onChange={handleChange}
              className={inputClass}
            >
              <option value="CPP">CPP — Costo Promedio Ponderado</option>
              <option value="FIFO">FIFO — Primero en entrar, primero en salir</option>
              <option value="LIFO">LIFO — Último en entrar, primero en salir</option>
            </select>
          </div>

          {/* Acciones */}
          <div className="flex gap-4 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-5 py-3 rounded-lg text-sm font-medium transition-colors shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Guardando..." : "Guardar producto"}
            </button>

            <button
              type="button"
              onClick={() => router.push("/inventario")}
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
