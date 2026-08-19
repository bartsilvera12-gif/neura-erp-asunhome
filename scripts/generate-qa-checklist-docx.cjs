/* eslint-disable */
// Generador del Checklist QA en formato Word.
// Uso: node scripts/generate-qa-checklist-docx.cjs
// Salida: docs/QA_CHECKLIST.docx

const fs = require("fs");
const path = require("path");

// docx instalado globalmente
const docxPath = "C:/Users/alan_/AppData/Roaming/npm/node_modules/docx";
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  LevelFormat,
  PageBreak,
  Footer,
  PageNumber,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
} = require(docxPath);

// ── Helpers ──────────────────────────────────────────────────────────────────

const CHECKBOX = "☐"; // ☐ casilla vacía Unicode

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    ...opts,
    children: [new TextRun({ text, ...(opts.run || {}) })],
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 180 },
    pageBreakBefore: false,
    children: [new TextRun({ text, bold: true, size: 32, color: "1F4E79" })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, bold: true, size: 26, color: "2E75B6" })],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 180, after: 90 },
    children: [new TextRun({ text, bold: true, size: 22, color: "4FAEB2" })],
  });
}

// Item con checkbox visual ☐
function check(text) {
  return new Paragraph({
    spacing: { before: 40, after: 40 },
    indent: { left: 360 },
    children: [
      new TextRun({ text: `${CHECKBOX}  `, size: 24, font: "Segoe UI Symbol" }),
      new TextRun({ text, size: 22 }),
    ],
  });
}

// Item con espacio para notas / observaciones del QA
function checkWithNotes(text) {
  return new Paragraph({
    spacing: { before: 40, after: 40 },
    indent: { left: 360 },
    children: [
      new TextRun({ text: `${CHECKBOX}  `, size: 24, font: "Segoe UI Symbol" }),
      new TextRun({ text, size: 22 }),
    ],
  });
}

function note(text) {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    indent: { left: 0 },
    children: [
      new TextRun({ text: "⚠ ", color: "C00000", bold: true, size: 22 }),
      new TextRun({ text, italics: true, size: 22, color: "555555" }),
    ],
  });
}

function divider() {
  return new Paragraph({
    spacing: { before: 120, after: 120 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 1 },
    },
    children: [new TextRun("")],
  });
}

// Tabla informativa para portada / encabezados de sección
function infoTable(rows) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2800, 6560],
    rows: rows.map(
      ([k, v]) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 2800, type: WidthType.DXA },
              shading: { fill: "E7F3F4", type: ShadingType.CLEAR },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              borders: borderAll("CCCCCC"),
              children: [
                new Paragraph({
                  children: [new TextRun({ text: k, bold: true, size: 22 })],
                }),
              ],
            }),
            new TableCell({
              width: { size: 6560, type: WidthType.DXA },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              borders: borderAll("CCCCCC"),
              children: [
                new Paragraph({
                  children: [new TextRun({ text: v, size: 22 })],
                }),
              ],
            }),
          ],
        })
    ),
  });
}

function borderAll(color) {
  const b = { style: BorderStyle.SINGLE, size: 4, color };
  return { top: b, bottom: b, left: b, right: b };
}

// ── Contenido ────────────────────────────────────────────────────────────────

const children = [];

// Portada
children.push(
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 1200, after: 240 },
    children: [
      new TextRun({
        text: "Checklist de QA",
        bold: true,
        size: 56,
        color: "1F4E79",
      }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [
      new TextRun({
        text: "Neura ERP — En lo de Mari",
        bold: true,
        size: 36,
        color: "4FAEB2",
      }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 720 },
    children: [
      new TextRun({
        text: "Funcionalidad Web + Mobile",
        italics: true,
        size: 26,
        color: "555555",
      }),
    ],
  }),
  infoTable([
    ["Versión", "1.0"],
    ["Fecha", new Date().toLocaleDateString("es-PY", { day: "2-digit", month: "long", year: "numeric" })],
    ["QA asignado", "______________________________"],
    ["Entorno probado", "______________________________"],
    ["Build / commit", "______________________________"],
    ["Estado final", "☐ Aprobado     ☐ Aprobado con observaciones     ☐ Rechazado"],
  ]),
  new Paragraph({ spacing: { before: 480 }, children: [new TextRun("")] }),
  new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 360, after: 120 },
    children: [
      new TextRun({ text: "Instrucciones de uso", bold: true, size: 26, color: "1F4E79" }),
    ],
  }),
  p("Marcar la casilla ☐ con una ✓ o cambiar a ☒ cuando el ítem haya sido verificado correctamente. Dejar en blanco si está pendiente. Anotar al lado o al final de cada sección cualquier bug o comportamiento inesperado."),
  p("Probar en cada release o antes de cada merge a main. Cubrir Desktop (Chrome + Firefox), Tablet ~768px, Mobile (iPhone Safari + Android Chrome, ≤ 430px)."),
  new Paragraph({ children: [new PageBreak()] })
);

// ── Sección 0 ────────────────────────────────────────────────────────────────
children.push(
  h1("0. Setup & Smoke Test"),
  check("La app carga en / sin errores en consola."),
  check("Login funciona con email/password de un usuario válido."),
  check("Logout vuelve a /login y limpia sesión (intentar entrar a /ventas sin sesión debe redirigir a login)."),
  check("Refrescar (F5) en cualquier ruta mantiene la sesión."),
  check("Acceder a una ruta sin permisos muestra estado adecuado (no pantalla en blanco)."),
  check("Cambio de empresa (si aplica) recarga datos correctos (no muestra datos de otra empresa)."),
  divider()
);

// ── Sección 1 ────────────────────────────────────────────────────────────────
children.push(
  h1("1. Layout & Navegación"),
  h2("Desktop"),
  check("Sidebar lateral visible con todos los módulos habilitados."),
  check("Botón colapsar/expandir sidebar funciona."),
  check("Búsqueda dentro del menú filtra ítems (con/sin acentos, mayúsculas)."),
  check("Marcar/desmarcar favorito (estrella) persiste tras recargar."),
  check("Submenús (Inventario, Compras, Configuración, Sorteos) expanden/contraen."),
  check("Ítem activo queda resaltado correctamente (incluye rutas hijas)."),
  check("Header muestra nombre, rol y email del usuario; menú desplegable cierra al click fuera."),
  check("Logo Zentra/Neura se ve nítido (no pixelado)."),
  h2("Mobile"),
  check("MobileBottomNav aparece solo ≤ 768px y queda fija abajo."),
  check("Los 5 íconos (Inicio, Ventas, Pedidos, Clientes, Más) son tappeables (≥ 48px) sin solaparse con el contenido."),
  check('Tap en "Más" abre el sidebar drawer; backdrop cierra al tocar fuera.'),
  check("En iPhone con notch, la barra NO queda tapada por la safe-area inferior."),
  check("Scroll vertical en cualquier pantalla no queda tapado por la BottomNav (debe haber padding-bottom)."),
  check("Header móvil muestra botón hamburguesa que abre el sidebar."),
  check("Sidebar desktop NO se ve en mobile."),
  divider()
);

// ── Sección 2 ────────────────────────────────────────────────────────────────
children.push(
  h1("2. Dashboard"),
  h2("Desktop"),
  check("KPIs principales se cargan (facturado, cobrado, pendiente, etc.)."),
  check("Selector de período (Hoy / 7d / 30d / Mes / Año) recalcula valores."),
  check("Tabs (Comercial, Financiero, Ventas, Inventario) cambian sin reload completo."),
  check('Gráfico de "Cobrado por día" se carga sin layout shift al entrar al tab Financiero.'),
  check('Montos se muestran en formato local Gs. 1.234.567 (NO compactos tipo "1,2 M").'),
  check("Click en una venta del listado va al detalle correcto."),
  check("Notas de crédito aprobadas descuentan el facturado correctamente."),
  check("Facturas anuladas NO suman en KPIs."),
  h2("Mobile"),
  check("Se renderiza MobileDashboard (no la versión desktop reducida)."),
  check("KPI principal grande es legible sin scroll horizontal."),
  check("4 acciones rápidas (nueva venta, pedido, compra, cliente) tienen ≥ 48px de alto."),
  check("Alertas (stock crítico, facturas vencidas) solo aparecen si hay datos."),
  check("Últimas ventas se muestran como cards (no tabla)."),
  check("Selector de período en header sticky permanece visible al scrollear."),
  check("Montos NO se muestran compactos: debe verse Gs. 268.000, no 268 K (regresión commit bae0ce8)."),
  divider()
);

// ── Sección 3 ────────────────────────────────────────────────────────────────
children.push(
  h1("3. Ventas"),
  check("Listado de ventas se ve con paginación/scroll fluido."),
  check("Filtros (tipo venta CONTADO/CRÉDITO, IVA, fecha, cliente) funcionan combinados."),
  check("Métricas del día coinciden con la suma del listado filtrado a hoy."),
  check("Nueva venta: agregar múltiples productos, cambiar IVA por línea, calcular subtotal/IVA/total correctamente."),
  check("Cambio de moneda (Gs/USD) aplica tipo de cambio y recalcula totales."),
  check("Venta a crédito requiere plazo de pago."),
  check("Al guardar, descuenta stock del producto vendido."),
  check("Al guardar, aparece en gestión de clientes como factura pendiente (si es crédito)."),
  check("Anular venta restaura stock y cambia estado."),
  check("Imprimir/exportar venta (si aplica) genera documento correcto."),
  check("Mobile: modal/sticky footer en nueva venta no tapa el botón Guardar (regresión commit ecc2094)."),
  check("Mobile: FAB de nueva venta visible y no tapado por BottomNav."),
  divider()
);

// ── Sección 4 ────────────────────────────────────────────────────────────────
children.push(
  h1("4. Pedidos (Proyectos / Kanban gastronómico)"),
  check("Kanban muestra columnas (Nuevo → En preparación → Listo → Entregado, o equivalente)."),
  check("Drag & drop entre columnas actualiza el estado en BD."),
  check("Click en card abre detalle del pedido."),
  check("Crear nuevo pedido carga lista de productos/recetas y clientes."),
  check("Mobile: el kanban scrollea horizontalmente sin romper el layout (regresión commit ecc2094)."),
  check("Cards de pedido en mobile son tappeables sin scroll involuntario."),
  divider()
);

// ── Sección 5 ────────────────────────────────────────────────────────────────
children.push(
  h1("5. Inventario"),
  check("Listado de productos con SKU, stock actual, precio, costo."),
  check("Filtros por categoría y búsqueda funcionan."),
  check("Nuevo producto: valida SKU único, precio > costo (advertencia si no)."),
  check("Editar producto persiste cambios."),
  check("Movimientos: registrar entrada, salida y ajuste; stock se actualiza."),
  check("Movimientos por venta/compra se loguean automáticamente."),
  check("Categorías: crear, editar, eliminar."),
  check("Stock mínimo: producto bajo aparece en alertas del dashboard."),
  check("Importar Excel acepta formato y muestra preview antes de guardar."),
  check("Exportar Excel descarga archivo válido."),
  check('Sub-ruta "Ubicaciones / Depósitos": si está oculta en esta instancia, confirmar que NO aparece en sidebar.'),
  divider()
);

// ── Sección 6 ────────────────────────────────────────────────────────────────
children.push(
  h1("6. Recetas (gastronomía)"),
  check("Listado de recetas se carga."),
  check("Crear nueva receta con ingredientes (producto + cantidad) calcula costo total."),
  check("Editar receta recalcula costo."),
  check("Vincular receta a producto vendible funciona."),
  divider()
);

// ── Sección 7 ────────────────────────────────────────────────────────────────
children.push(
  h1("7. Clientes & Gestión Clientes"),
  check("Listado de clientes con filtros (estado, condición de pago, búsqueda)."),
  check("Crear cliente (persona/empresa) valida RUC/documento."),
  check("Editar cliente persiste cambios."),
  check("Detalle de cliente muestra facturas, pagos y tipificaciones asociadas."),
  check("Gestión Clientes: lista de facturas con estado (Pagado, Pendiente, Vencido, Anulado)."),
  check("Registrar pago contra factura descuenta saldo y cambia estado a Pagado si llega a 0."),
  check("Tipificación de gestión se guarda con fecha y resultado."),
  divider()
);

// ── Sección 8 ────────────────────────────────────────────────────────────────
children.push(
  h1("8. Compras & Proveedores"),
  check("Listado de órdenes de compra con filtros."),
  check("Nueva compra: seleccionar proveedor, producto, cantidad, costo, IVA, número de control."),
  check("Al guardar, stock del producto aumenta."),
  check("Compra a crédito genera cuenta por pagar."),
  check("Listado de proveedores se carga; crear/editar funciona."),
  check("Categorías de proveedores funcionan."),
  divider()
);

// ── Sección 9 ────────────────────────────────────────────────────────────────
children.push(
  h1("9. Gastos"),
  check("Listado de gastos con filtros."),
  check("Nuevo gasto: fijo/variable, recurrente, monto, categoría."),
  check("Gastos recurrentes se proyectan al período correcto."),
  check("Editar y eliminar gasto funcionan."),
  check("Gastos del período se reflejan en el cálculo de margen del dashboard."),
  divider()
);

// ── Sección 10 ───────────────────────────────────────────────────────────────
children.push(
  h1("10. Comisiones"),
  check("Listado calcula comisiones por vendedor según ventas confirmadas."),
  check("Período seleccionable y exportable."),
  divider()
);

// ── Sección 11 ───────────────────────────────────────────────────────────────
children.push(
  h1("11. Notas de Crédito & Facturación Electrónica (SIFEN)"),
  check("Crear nota de crédito desde una factura existente."),
  check("Validar que descuenta saldo de la factura original."),
  check("Aprobar/rechazar nota de crédito cambia estado."),
  check("Configuración SIFEN: timbrado, fecha inicio, actividad económica."),
  check("Emitir factura electrónica genera XML válido y guarda CDC."),
  check("Cancelación SIFEN funciona."),
  divider()
);

// ── Sección 12 ───────────────────────────────────────────────────────────────
children.push(
  h1("12. Conversaciones / Omnicanal / Chat"),
  check("Listado de conversaciones activas se carga."),
  check("Click en una conversación abre el chat con historial."),
  check("Enviar mensaje desde la UI funciona y aparece en tiempo real."),
  check("Asignar conversación a agente."),
  check('Cerrar conversación con taxonomía (motivo de cierre) la mueve a "Finalizadas".'),
  check("Historial omnicanal lista conversaciones cerradas con búsqueda por teléfono/cliente."),
  check("Monitoreo muestra agentes activos, colas, métricas en vivo."),
  check("Quick replies (respuestas rápidas) por canal se insertan correctamente."),
  check("Flujos / bots: probar trigger, paso a humano, transferencias."),
  divider()
);

// ── Sección 13 ───────────────────────────────────────────────────────────────
children.push(
  h1("13. CRM Funnel"),
  check("Pipeline visible con etapas (LEAD → CONTACTADO → NEGOCIACIÓN → GANADO / PERDIDO)."),
  check("Drag & drop entre etapas guarda cambio."),
  check("Crear nuevo prospecto con valor estimado, próxima acción."),
  check("Convertir prospecto GANADO crea cliente automáticamente."),
  check("Notas del prospecto se guardan y muestran cronológicamente."),
  divider()
);

// ── Sección 14 ───────────────────────────────────────────────────────────────
children.push(
  h1("14. Marketing & Campañas"),
  check("Listado de campañas con estado."),
  check("Crear campaña, configurar plantilla con variables."),
  check("Botones de acción (button actions) en plantilla funcionan."),
  check("Marketing Ops dashboard muestra métricas de envíos."),
  divider()
);

// ── Sección 15 ───────────────────────────────────────────────────────────────
children.push(
  h1("15. Sorteos"),
  check("Listado de sorteos activos/cerrados."),
  check("Crear sorteo, configurar premios, fechas, revendedores."),
  check("Tickets: listado de comprobantes con validación OCR (monto/banco/referencia)."),
  check("Aprobar/rechazar comprobante actualiza estado del cupón."),
  check("Cupones: numeración correlativa correcta, no se repite."),
  check("Entradas: registrar entrada manual."),
  check("Imprimir cupones genera PDF descargable."),
  check("Conversaciones de sorteo: el bot responde con cupón asignado."),
  check("Revendedores: ver KPIs por revendedor."),
  divider()
);

// ── Sección 16 ───────────────────────────────────────────────────────────────
children.push(
  h1("16. Planes & Suscripciones"),
  check("Crear plan (precio, periodicidad, código)."),
  check("Asignar plan a cliente genera suscripción."),
  check("Factura recurrente de suscripción se genera al vencimiento."),
  divider()
);

// ── Sección 17 ───────────────────────────────────────────────────────────────
children.push(
  h1("17. Usuarios & Permisos"),
  check("Listado de usuarios de la empresa."),
  check("Crear usuario nuevo (debe llegar invitación / quedar habilitado)."),
  check("Editar rol cambia accesos al sidebar correctamente."),
  check("Eliminar/desactivar usuario impide login."),
  check("Un usuario NO ve datos de otra empresa (RLS)."),
  divider()
);

// ── Sección 18 ───────────────────────────────────────────────────────────────
children.push(
  h1("18. Configuración"),
  check("Configuración global guarda y persiste."),
  check("Configuración de canales (WhatsApp, etc.) — credenciales válidas."),
  check("Colas y equipos omnicanal: crear, asignar agentes, horarios de trabajo."),
  check("Vistas/tableros del dashboard configurables por empresa."),
  check("Políticas y preferencias persisten al recargar."),
  divider()
);

// ── Sección 19 ───────────────────────────────────────────────────────────────
children.push(
  h1("19. Admin Empresas (super_admin)"),
  check("Solo usuarios con rol super_admin ven la ruta /admin/empresas."),
  check("Crear nueva empresa habilita módulos según plan."),
  check("Activar/desactivar módulos refleja inmediatamente en el sidebar del usuario."),
  check("Un usuario normal que intenta /admin/empresas recibe 403 / redirección."),
  divider()
);

// ── Sección 20 ───────────────────────────────────────────────────────────────
children.push(
  h1("20. Mobile específico (tests obligatorios)"),
  check("iPhone SE / 12 / 14 (375–430px): ningún módulo requiere scroll horizontal en flujo principal."),
  check("Tap targets: todos los botones interactivos ≥ 44–48px."),
  check("Formularios: teclado no tapa el campo activo; auto-scroll funciona."),
  check("Modales: footer sticky con botones Guardar/Cancelar siempre accesible."),
  check('FAB (botón flotante "+") visible y no choca con BottomNav.'),
  check("Pull-to-refresh (si está implementado) no rompe el layout."),
  check("Imágenes/iconos se ven nítidos en pantallas retina."),
  check("Modo landscape (horizontal) no rompe layouts."),
  check("PWA / agregar a pantalla de inicio (si aplica) — confirmar icono y nombre."),
  divider()
);

// ── Sección 21 ───────────────────────────────────────────────────────────────
children.push(
  h1("21. Cross-cutting (transversal)"),
  check("Performance: tiempo de carga del dashboard < 3s en 3G simulado."),
  check("Errores de red: con conexión lenta o caída, la app muestra mensaje y permite reintentar (no queda en blanco)."),
  check("Formato fechas: todas las fechas se muestran en DD/MM/YYYY (zona Paraguay UTC-3), sin saltos por timezone."),
  check("Formato moneda: Gs. 1.234.567 consistente en toda la app."),
  check("Validaciones: campos requeridos muestran error claro antes de enviar."),
  check('Estados vacíos: listados sin datos muestran "empty state" con CTA, no pantalla en blanco.'),
  check("Loaders: spinners/skeletons mientras carga, no flash de contenido vacío."),
  check("Accesibilidad básica: tab order razonable, alt text en imágenes, aria-labels en botones de ícono."),
  check("Consola del navegador: sin errores rojos en flujos principales."),
  check("Importar/Exportar Excel funciona en módulos que lo tienen (productos, clientes, etc.)."),
  check("Multi-tab: abrir dos pestañas con el mismo usuario no rompe la sesión ni los datos."),
  check("Logout en una pestaña refleja sesión cerrada en la otra al refrescar."),
  divider()
);

// ── Sección 22 ───────────────────────────────────────────────────────────────
children.push(
  h1("22. Regresiones recientes a verificar (últimos commits)"),
  check("[bae0ce8] Mobile dashboard muestra montos completos (268.000), no compactos (268 K)."),
  check("[dfc4131] MobileDashboard muestra el total real de ventas (no 0), y el tab inferior aparece como Ventas no Inicio."),
  check("[db1e58e] Secciones Financiero e Inventario visibles en MobileDashboard."),
  check("[91eac83] BottomNav, FAB y dashboard mobile rediseñado funcionan en iOS y Android."),
  check("[ecc2094] Modal de nueva venta tiene footer sticky en mobile; kanban de pedidos scrollea horizontalmente sin romperse."),
  divider()
);

// ── Sección final: Observaciones del QA ──────────────────────────────────────
children.push(
  h1("Observaciones generales del QA"),
  p("Anotar acá cualquier bug, comportamiento inesperado, sugerencia de UX o consideraciones adicionales encontradas durante la sesión de testing:"),
  new Paragraph({ spacing: { before: 120 }, children: [new TextRun("")] }),
  ...Array.from({ length: 20 }, () =>
    new Paragraph({
      spacing: { before: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 1 } },
      children: [new TextRun("")],
    })
  ),
  new Paragraph({ spacing: { before: 360 }, children: [new TextRun("")] }),
  p("Firma QA: ______________________________     Fecha: ____________"),
  new Paragraph({ spacing: { before: 120 }, children: [new TextRun("")] }),
  p("Firma Tech Lead: ______________________________     Fecha: ____________")
);

// ── Documento ────────────────────────────────────────────────────────────────

const doc = new Document({
  creator: "Neura ERP",
  title: "Checklist de QA — Neura ERP",
  description: "Checklist completo de QA Web + Mobile",
  styles: {
    default: { document: { run: { font: "Calibri", size: 22 } } },
    paragraphStyles: [
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 32, bold: true, font: "Calibri", color: "1F4E79" },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 },
      },
      {
        id: "Heading2",
        name: "Heading 2",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 26, bold: true, font: "Calibri", color: "2E75B6" },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 },
      },
      {
        id: "Heading3",
        name: "Heading 3",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 22, bold: true, font: "Calibri", color: "4FAEB2" },
        paragraph: { spacing: { before: 180, after: 90 }, outlineLevel: 2 },
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 }, // US Letter
          margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
        },
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: "Neura ERP — Checklist QA  |  Página ", size: 18, color: "888888" }),
                new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "888888" }),
                new TextRun({ text: " de ", size: 18, color: "888888" }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: "888888" }),
              ],
            }),
          ],
        }),
      },
      children,
    },
  ],
});

const outPath = path.resolve(__dirname, "..", "docs", "QA_CHECKLIST.docx");
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outPath, buffer);
  console.log(`OK -> ${outPath}`);
});
