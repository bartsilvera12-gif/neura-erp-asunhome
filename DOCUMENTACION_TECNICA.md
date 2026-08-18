# Documentación Técnica — Neura ERP

**Versión:** 1.0  
**Última actualización:** Marzo 2026

---

## 1. Visión del Proyecto

### ¿Qué es Neura ERP?

**Neura ERP** es un **SaaS ERP multiempresa** orientado a la gestión empresarial integral. Permite que múltiples empresas utilicen la misma plataforma de forma aislada, cada una con sus propios datos, usuarios y módulos habilitados.

### Características principales

- **Multiempresa:** Cada empresa tiene su propio espacio de datos, separado por `empresa_id` y Row Level Security (RLS).
- **Módulos configurables:** Las empresas pueden habilitar o deshabilitar módulos según su plan (Dashboard, Ventas, Inventario, Compras, Clientes, CRM, Planes, etc.).
- **Flujo de negocio integrado:** Desde el CRM (prospectos) hasta la facturación y gestión de clientes.
- **Diseño SaaS moderno:** Estética inspirada en Stripe, Linear y Vercel.

### Módulos principales

| Módulo | Descripción |
|--------|-------------|
| **Dashboard** | Vista global del sistema con métricas comerciales, financieras, inventario y ventas |
| **CRM Funnel** | Pipeline de prospectos (Lead → Contactado → Negociación → Ganado/Perdido) |
| **Ventas** | Registro de órdenes de venta con múltiples productos |
| **Inventario** | Productos, stock, movimientos (entradas, salidas, ajustes) |
| **Compras** | Órdenes de compra a proveedores |
| **Clientes** | Base de clientes con datos comerciales |
| **Gestión Clientes** | Facturas, tipificaciones, estado de cuenta |
| **Gastos** | Registro de gastos operativos (fijos/variables, recurrentes) |
| **Pagos** | Registro de pagos contra facturas pendientes |
| **Planes** | Catálogo de planes de suscripción |
| **Usuarios** | Gestión de personal y accesos |
| **Configuración** | Parámetros globales del sistema |
| **Admin Empresas** | Administración de empresas (super_admin) |

---

## 2. Stack Tecnológico

### Frontend

| Tecnología | Versión | Uso |
|------------|---------|-----|
| **Next.js** | 16.x | Framework React con App Router |
| **React** | 19.x | Biblioteca UI |
| **TailwindCSS** | 4.x | Estilos utilitarios |
| **Framer Motion** | 12.x | Animaciones (sidebar, tabs) |
| **Lucide React** | 0.577 | Iconografía |

### Backend

| Tecnología | Uso |
|------------|-----|
| **Supabase** | BaaS: Auth, base de datos, API REST |
| **PostgreSQL** | Base de datos relacional |
| **Row Level Security (RLS)** | Seguridad por fila según `empresa_id` |
| **Supabase Auth** | Autenticación (email/password) |

### Infraestructura

| Servicio | Uso |
|----------|-----|
| **GitHub** | Repositorio y control de versiones |
| **Vercel** | Hosting y despliegue automático |
| **Supabase Cloud** | Base de datos y autenticación en la nube |

---

## 3. Arquitectura Multiempresa

### Modelo de datos

Todas las tablas operativas incluyen `empresa_id` (UUID) que vincula cada registro a una empresa. Las políticas RLS garantizan que un usuario solo acceda a datos de su empresa.

### Tablas base

| Tabla | Descripción |
|-------|-------------|
| **empresas** | Empresas del SaaS (id, nombre_empresa, plan, ruc, estado, created_at) |
| **usuarios** | Usuarios del sistema (empresa_id, email, nombre, rol) — vinculados a `auth.users` por email |
| **empresa_modulos** | Módulos habilitados por empresa (empresa_id, modulo_id, activo) |
| **modulos** | Catálogo global de módulos (id, nombre, slug) — sin empresa_id |

> Las tablas `empresas`, `usuarios`, `empresa_modulos` y `modulos` se crean en Supabase (dashboard o migración inicial). Las migraciones en `supabase/migrations/` asumen que ya existen.

### Funciones RLS

- **`empresa_id_actual()`** — Obtiene `empresa_id` del usuario autenticado desde `usuarios` usando `auth.jwt() ->> 'email'`.
- **`es_super_admin()`** — Verifica si el usuario tiene `rol = 'super_admin'`.
- **`puede_acceder_empresa(empresa_uuid)`** — Verifica si el usuario puede acceder a una empresa (pertenece o es super_admin).

### Rol super_admin

- Usuarios con `rol = 'super_admin'` y `empresa_id = NULL` pueden:
  - Ver y gestionar todas las empresas
  - Crear nuevas empresas
  - Gestionar el catálogo de módulos
- Acceso al panel **Admin Empresas**.

---

## 4. Base de Datos

### Diagrama de tablas

```
empresas (id, nombre_empresa, plan, ruc, estado, created_at)
    │
    ├── usuarios (empresa_id, email, nombre, rol, ...)
    ├── empresa_modulos (empresa_id, modulo_id, activo)
    │
    ├── clientes (empresa_id, tipo_cliente, empresa, nombre_contacto, ruc, ...)
    │       └── facturas (cliente_id, numero_factura, fecha, monto, saldo, ...)
    │       └── tipificaciones (cliente_id, tipo_gestion, resultado, ...)
    │
    ├── productos (empresa_id, nombre, sku, costo_promedio, precio_venta, stock_actual, ...)
    │       └── movimientos_inventario (producto_id, tipo, cantidad, origen, ...)
    │
    ├── proveedores (empresa_id, nombre, ruc, telefono, ...)
    │
    ├── ventas (empresa_id, cliente_id, numero_control, total, ...)
    │       └── ventas_items (venta_id, producto_id, cantidad, precio_venta, ...)
    │
    ├── compras (empresa_id, proveedor_id, producto_id, cantidad, total, ...)
    │
    ├── crm_prospectos (empresa_id, empresa, contacto, etapa, valor_estimado, ...)
    │       └── crm_notas (prospecto_id, texto, fecha)
    │
    └── planes (empresa_id, codigo_plan, nombre, precio, periodicidad, ...)
```

### Tablas detalladas

#### clientes

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | uuid | PK |
| empresa_id | uuid | FK → empresas |
| tipo_cliente | text | 'empresa' \| 'persona' |
| empresa | text | Razón social |
| nombre_contacto | text | Contacto principal |
| ruc, documento | text | Identificación fiscal |
| telefono, email | text | Contacto |
| condicion_pago | text | CONTADO, 30 DÍAS, etc. |
| moneda_preferida | text | GS \| USD |
| origen | text | MANUAL, CRM, VENTA |
| estado | text | activo \| inactivo |
| notas | jsonb | Notas internas |

#### productos

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | uuid | PK |
| empresa_id | uuid | FK → empresas |
| nombre, sku | text | Identificación |
| costo_promedio, precio_venta | numeric | Precios |
| stock_actual, stock_minimo | numeric | Stock |
| metodo_valuacion | text | CPP \| FIFO \| LIFO |

#### ventas / ventas_items

- **ventas:** Cabecera (numero_control, moneda, tipo_cambio, subtotal, monto_iva, total, tipo_venta, plazo_dias).
- **ventas_items:** Líneas (producto_id, cantidad, precio_venta, tipo_iva, subtotal, monto_iva, total_linea).

#### compras

| Columna | Tipo | Descripción |
|---------|------|-------------|
| proveedor_id, producto_id | uuid | FK |
| cantidad, costo_unitario | numeric | Datos de compra |
| iva_tipo | text | exenta \| 5 \| 10 |
| precio_venta, margen_venta | numeric | Precio de venta |
| tipo_pago | text | contado \| credito |
| numero_control | text | Número de comprobante |

#### crm_prospectos / crm_notas

- **crm_prospectos:** Etapa (LEAD, CONTACTADO, NEGOCIACION, GANADO, PERDIDO), valor_estimado, proxima_accion, cliente_creado.
- **crm_notas:** Notas asociadas a cada prospecto.

#### facturas

| Columna | Tipo | Descripción |
|---------|------|-------------|
| cliente_id | uuid | FK → clientes |
| suscripcion_id | uuid | FK → suscripciones (opcional) |
| numero_factura | text | Número de factura |
| fecha, fecha_vencimiento | date | Fechas |
| monto, saldo | numeric | Montos |
| estado | text | Pagado \| Pendiente \| Vencido \| Anulado |
| tipo | text | contado \| credito \| suscripcion |

#### suscripciones

| Columna | Tipo | Descripción |
|---------|------|-------------|
| cliente_id, plan_id | uuid | FK |
| precio, moneda | numeric, text | Precio |
| fecha_inicio | date | Inicio de suscripción |
| duracion_meses | integer | Duración (default 12) |
| dia_facturacion, dia_vencimiento | integer | Días del mes (1-28, 1-31) |
| estado | text | activa \| pausada \| cancelada |

#### factura_items

| Columna | Tipo | Descripción |
|---------|------|-------------|
| factura_id | uuid | FK → facturas |
| descripcion | text | Descripción del ítem |
| cantidad, precio_unitario | numeric | Datos de línea |
| subtotal, iva, total | numeric | Totales de línea |

#### pagos

| Columna | Tipo | Descripción |
|---------|------|-------------|
| factura_id | uuid | FK → facturas |
| monto | numeric | Monto del pago |
| fecha_pago | date | Fecha del pago |
| metodo_pago | text | efectivo \| transferencia \| cheque \| tarjeta \| otro |
| referencia | text | Nº comprobante o referencia |

#### gastos

| Columna | Tipo | Descripción |
|---------|------|-------------|
| categoria, descripcion | text | Clasificación |
| monto | numeric | Monto |
| tipo | text | fijo \| variable |
| recurrente, frecuencia | boolean, text | Si es recurrente |
| fecha | date | Fecha del gasto |

#### tipificaciones

Registros de gestión de clientes (Consulta, Reclamo, Seguimiento, Promesa de pago, Soporte técnico, Cambio plan).

#### movimientos_inventario

| Columna | Tipo | Descripción |
|---------|------|-------------|
| producto_id | uuid | FK |
| tipo | text | ENTRADA \| SALIDA \| AJUSTE |
| origen | text | compra \| venta \| ajuste_manual \| inventario_inicial |
| cantidad, costo_unitario | numeric | Datos del movimiento |

#### planes

| Columna | Tipo | Descripción |
|---------|------|-------------|
| codigo_plan | text | Código único |
| nombre | text | Nombre del plan |
| precio, moneda | numeric, text | Precio |
| periodicidad | text | mensual \| anual \| unico |
| limite_usuarios, limite_clientes, limite_facturas | integer | Límites (null = ilimitado) |

### Relaciones

- **compras** → genera **movimientos_inventario** (ENTRADA) y actualiza **productos** (stock, costo_promedio).
- **ventas** → genera **movimientos_inventario** (SALIDA) y actualiza **productos** (stock).
- **crm_prospectos** (GANADO) → puede crear **clientes** (origen: CRM).
- **clientes** → **facturas**, **tipificaciones**, **suscripciones**.
- **suscripciones** → **facturas** (facturación recurrente).
- **facturas** → **factura_items** (líneas), **pagos** (abonos).
- **pagos** → actualiza **facturas** (saldo, estado).

---

## 5. Módulos del ERP

### Dashboard

- **Vista:** Tabs (Comercial, Financiero, Inventario, Ventas).
- **Comercial:** Pipeline CRM, prospectos por etapa, clientes nuevos, tipificaciones.
- **Financiero:** Facturas, saldos, mora, ganancias.
- **Inventario:** Productos, stock bajo, movimientos.
- **Ventas:** Ventas del día, ticket promedio.
- **Fuente de datos:** `lib/dashboard/data.ts` (queryEmpresa).

### Ventas

- **Listado:** Órdenes de venta con filtros (número, tipo, IVA).
- **Nueva venta:** Combobox de productos, múltiples líneas, moneda GS/USD, tipo contado/crédito.
- **Persistencia:** localStorage (actualmente). Al guardar venta se genera salida de inventario vía `saveMovimiento` (Supabase).

### Inventario

- **Productos:** Listado con filtros, stock, margen, método de valuación.
- **Nuevo producto:** Nombre, SKU, costo, markup, precio, stock inicial.
- **Movimientos:** Entradas, salidas, ajustes.
- **Persistencia:** Supabase (productos, movimientos_inventario).

### Compras

- **Listado:** Órdenes de compra con filtros.
- **Nueva compra:** Proveedor, producto, cantidad, costo, IVA, precio de venta.
- **Impacto:** Al guardar compra se genera entrada de inventario y se actualiza costo_promedio del producto.
- **Persistencia:** localStorage (actualmente).

### Clientes

- **Listado:** Búsqueda, filtros.
- **Nuevo cliente:** Formulario completo (identificación, contacto, datos comerciales).
- **Detalle:** Tabs (Información, Estado de cuenta, Suscripciones, Proyectos, Actividad, Notas).
- **Persistencia:** Supabase.

### Gestión Clientes

- **Panel:** Columna izquierda (filtros + lista de clientes), columna derecha (información del cliente + facturas).
- **Facturas:** Listado con estado, saldo, días mora.
- **Tipificación:** Crear cliente desde cliente seleccionado.
- **Persistencia:** Supabase (facturas), localStorage (tipificaciones según implementación).

### CRM Funnel

- **Kanban:** Columnas LEAD, CONTACTADO, NEGOCIACION, GANADO, PERDIDO.
- **Drag & drop:** Mover prospectos entre etapas.
- **Nuevo prospecto:** Empresa, contacto, servicio, valor estimado.
- **Ganado:** Crear cliente desde prospecto.
- **Persistencia:** Supabase (crm_prospectos, crm_notas).

### Gastos

- **Listado:** Gastos con filtros por fecha, tipo (fijo/variable).
- **Nuevo/Editar:** Categoría, descripción, monto, tipo, recurrente, frecuencia, fecha.
- **Persistencia:** Supabase (`lib/gastos/actions.ts`).

### Pagos

- **Listado:** Facturas pendientes de cobro con saldo.
- **Registrar pago:** Monto, fecha, método (efectivo, transferencia, cheque, tarjeta), referencia.
- **Impacto:** Al registrar pago se actualiza saldo y estado de la factura vía API `/api/pagos`.
- **Persistencia:** Supabase (API routes + `lib/api/client.ts`).

### Planes

- **Listado:** Planes con filtros.
- **Nuevo/Editar:** Nombre, precio, periodicidad, límites.
- **Persistencia:** Supabase.

### Usuarios

- **Listado:** Usuarios con filtros (nivel, área, estado).
- **Nuevo usuario:** Datos personales, laborales, accesos.
- **Persistencia:** localStorage (actualmente). La tabla `usuarios` en Supabase se usa para auth y RLS.

### Configuración

- **Tabs:** Facturación, Políticas, Preferencias, Métricas.
- **Facturación:** Prefijo factura, numeración, días vencimiento, interés moratorio.
- **Políticas:** Descuento máximo, retención cliente, límites por empresa.
- **Preferencias:** Moneda base, formato fecha, timezone, idioma.
- **Métricas:** Metas comerciales y financieras.
- **Persistencia:** localStorage.

### Admin Empresas

- **Solo super_admin.**
- **Listado:** Empresas con plan, RUC, estado.
- **Nueva empresa:** Crear empresa + usuario administrador + módulos habilitados.
- **API:** `/api/admin/crear-empresa` (Supabase Auth + empresas + usuarios + empresa_modulos).

---

## 6. Seguridad

### Supabase Auth

- **Autenticación:** `signInWithPassword`, `signOut`, `getSession`.
- **Creación de usuarios:** API `/api/create-user` con service role (admin).
- **Sesión:** Persistida en cookies vía `@supabase/ssr`.

### Row Level Security (RLS)

Todas las tablas con `empresa_id` tienen políticas:

- **SELECT:** `puede_acceder_empresa(empresa_id)`
- **INSERT:** `puede_acceder_empresa(empresa_id)`
- **UPDATE:** `puede_acceder_empresa(empresa_id)`
- **DELETE:** `puede_acceder_empresa(empresa_id)` (o solo super_admin para empresas)

Tablas especiales:

- **empresas:** INSERT/DELETE solo super_admin.
- **modulos:** Catálogo global, SELECT para cualquier autenticado; INSERT/UPDATE/DELETE solo super_admin.
- **usuarios:** Políticas específicas por rol.

### Permisos por empresa

- El usuario obtiene `empresa_id` desde la tabla `usuarios` (vinculada por email a `auth.users`).
- RLS filtra automáticamente todas las consultas según `empresa_id_actual()`.

### Roles

- **admin:** Administrador de su empresa.
- **supervisor:** Acceso amplio por área.
- **usuario:** Acceso restringido.
- **super_admin:** Acceso global (empresa_id = NULL).

### AuthGuard

- Componente que protege rutas no públicas.
- Rutas públicas: `/login`.
- Redirige a `/login` si no hay sesión.

---

## 7. Flujo de Negocio

```
CRM (Prospectos)
    │
    ├── LEAD
    ├── CONTACTADO
    ├── NEGOCIACION
    │
    └── GANADO ──────────────────┐
                                 │
                                 ▼
                            CLIENTE
                                 │
                                 ├── Facturación (contado / crédito / suscripción)
                                 │
                                 ▼
                         GESTIÓN CLIENTE
                                 │
                                 ├── Facturas
                                 ├── Tipificaciones
                                 ├── Estado de cuenta
                                 └── Cambio de plan
```

### Flujo de inventario

```
COMPRAS
    │
    └── Entrada de stock
    └── Actualización de costo_promedio
    └── Actualización de precio_venta (opcional)

VENTAS
    │
    └── Salida de stock
    └── Actualización de stock_actual

AJUSTE MANUAL
    │
    └── Entrada / Salida / Ajuste
```

### Dependencias entre módulos

| Módulo origen | Depende de | Relación |
|---------------|------------|----------|
| **CRM** | — | Crea prospectos; al ganar → Clientes |
| **Clientes** | CRM (opcional) | Origen puede ser MANUAL, CRM, VENTA |
| **Gestión Clientes** | Clientes | Facturas y tipificaciones por cliente |
| **Pagos** | Gestión Clientes | Registra pagos contra facturas |
| **Facturación proyectada** | Clientes, Suscripciones | Emite facturas desde suscripciones |
| **Ventas** | Clientes, Inventario | Órdenes de venta con productos |
| **Compras** | Proveedores, Inventario | Órdenes de compra |
| **Inventario** | — | Productos y movimientos base |

---

## 8. API REST y flujo de datos

### APIs REST

La documentación detallada está en **`docs/API.md`**. Resumen de endpoints:

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/clientes` | GET, POST | Listar y crear clientes |
| `/api/facturas` | GET, POST | Listar y crear facturas |
| `/api/pagos` | GET, POST | Listar y registrar pagos |
| `/api/suscripciones` | GET, POST | Listar y crear suscripciones |
| `/api/dashboard` | GET | Métricas financieras del mes |
| `/api/clientes/:id/facturacion` | GET | Facturación proyectada del cliente |
| `/api/clientes/:id/facturacion/emitir` | POST | Emitir factura desde suscripción |
| `/api/crm/leads` | POST | Crear lead desde webhook (WhatsApp, n8n) |
| `/api/webhook-test` | GET | Probar configuración de webhooks |

### Flujo de datos: Supabase directo vs API

| Acceso | Cuándo se usa | Ejemplo |
|--------|---------------|---------|
| **Supabase directo** | Lectura/escritura desde cliente con RLS | `lib/clientes/storage.ts`, `lib/gastos/actions.ts`, `lib/inventario/storage.ts` |
| **API routes** | Creación con lógica de negocio, webhooks, validaciones | Clientes, facturas, pagos, suscripciones vía `lib/api/client.ts` |
| **API + Supabase** | API usa service role para operaciones que requieren permisos elevados | `/api/admin/crear-empresa`, `/api/pagos` (actualiza factura) |

El cliente `lib/api/client.ts` expone: `apiCreateCliente`, `apiCreateFactura`, `apiCreatePago`, `apiCreateSuscripcion`. Usa la sesión del usuario (cookies) para autenticación.

### Integraciones y webhooks

- **Eventos:** `lib/integrations/events.ts` — `emitEvent(eventName, payload)`.
- **Webhooks:** `lib/integrations/webhooks.ts` — `sendWebhook(event, payload)` envía POST a `WEBHOOK_URL`.
- **Variables de entorno:** `WEBHOOK_URL`, `WEBHOOK_SECRET`, `CRM_WEBHOOK_EMPRESA_ID`.
- **Eventos emitidos:** `cliente_creado`, `factura_creada`, `pago_registrado`, `suscripcion_creada`.
- **Documentación:** `docs/WEBHOOK_SETUP.md`, `docs/WHATSAPP_CRM_AUTOMATION.md`.

---

## 9. Diseño Visual

### Paleta de colores

| Variable | Valor | Uso |
|----------|-------|-----|
| **Primary** | #0EA5E9 | Botones, links, acentos |
| **Primary hover** | #0284C7 | Hover de botones |
| **Background** | #F8FAFC | Fondo general |
| **Sidebar** | #F1F5F9 | Fondo del sidebar |
| **Cards** | #FFFFFF | Fondo de cards |
| **Borders** | #E2E8F0 | Bordes |
| **Texto principal** | #0F172A | Títulos, texto |
| **Texto secundario** | #475569 | Subtítulos |

### Componentes

| Elemento | Clases |
|----------|--------|
| **Botones primarios** | `bg-[#0EA5E9] hover:bg-[#0284C7] text-white rounded-lg font-medium transition-colors shadow-sm active:scale-95` |
| **Cards** | `bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 p-6` |
| **Inputs** | `border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white` |
| **Tablas** | thead: `bg-slate-50 text-slate-600 text-sm font-semibold`; tr: `border-b border-slate-200 hover:bg-slate-50 transition-colors` |

### Sidebar

- `bg-[#F1F5F9]`, `border-r border-slate-200`
- Items activos: `bg-[#0EA5E9] text-white`
- Hover: `hover:bg-[#E2E8F0]`
- Logo grande, sin texto duplicado
- Colapsable (80px / 260px)

### Header

- `h-16`, `bg-white`, `border-b border-slate-200`
- Buscador: `bg-slate-50`, `border-slate-200`
- Avatar con dropdown

### Login

- Fondo: `bg-[#F8FAFC]`
- Card: `bg-white border border-slate-200 rounded-xl shadow-sm`
- Logo: más grande que el cuadro de login
- Icono contraseña: Eye/EyeOff (lucide-react) con onMouseDown/Up/Leave

---

## 10. Estructura del Proyecto

```
neura-erp/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── admin/
│   │   │   │   ├── crear-empresa/route.ts
│   │   │   │   ├── empresas/route.ts
│   │   │   │   ├── modulos/route.ts
│   │   │   │   └── usuarios/[id]/route.ts
│   │   │   ├── clientes/route.ts
│   │   │   │   └── [id]/facturacion/route.ts, emitir/route.ts
│   │   │   ├── crm/leads/route.ts
│   │   │   ├── create-user/route.ts
│   │   │   ├── dashboard/route.ts
│   │   │   ├── empresas/mis-modulos/route.ts
│   │   │   ├── facturas/route.ts
│   │   │   ├── pagos/route.ts
│   │   │   ├── suscripciones/route.ts
│   │   │   └── webhook-test/route.ts
│   │   ├── admin/empresas/
│   │   ├── clientes/
│   │   ├── compras/
│   │   ├── configuracion/
│   │   ├── crm/
│   │   ├── gastos/
│   │   ├── gestion-clientes/
│   │   ├── inventario/
│   │   ├── login/
│   │   ├── pagos/
│   │   ├── planes/
│   │   ├── usuarios/
│   │   ├── ventas/
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx (Dashboard)
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Header.tsx
│   │   │   └── Sidebar.tsx
│   │   ├── empresas/EmpresaForm.tsx
│   │   ├── AppShell.tsx
│   │   ├── AuthGuard.tsx
│   │   └── ThemeProvider.tsx
│   └── lib/
│       ├── api/ (client.ts, response.ts, errors.ts)
│       ├── auth.ts
│       ├── supabase.ts
│       ├── db/empresa.ts
│       ├── clientes/
│       ├── compras/
│       ├── config/
│       ├── crm/
│       ├── dashboard/
│       ├── empresas/
│       ├── gestion-clientes/
│       ├── gastos/
│       ├── inventario/
│       ├── integrations/ (events.ts, webhooks.ts)
│       ├── planes/
│       ├── proveedores/
│       ├── usuarios/
│       ├── ventas/
│       └── favorites.ts
├── docs/
│   ├── API.md
│   ├── WEBHOOK_SETUP.md
│   └── WHATSAPP_CRM_AUTOMATION.md
├── supabase/
│   └── migrations/
│       ├── 20250312000000_rls_multiempresa.sql
│       ├── 20250312000001_clientes_schema.sql
│       ├── 20250312000002_empresas_plan.sql
│       ├── 20250312000003_erp_schema.sql
│       ├── 20250312000005_gastos.sql
│       ├── 20250312000006_modulo_gastos.sql
│       ├── 20250312000009_suscripciones_facturas_pagos.sql
│       └── 20250312000010_modulo_pagos.sql
├── scripts/
│   ├── run-rls-migration.ts
│   ├── verificar-rls.ts
│   └── test-modulos-kevin.ts
├── package.json
├── vercel.json
└── next.config.ts
```

### Descripción de carpetas

| Carpeta | Contenido |
|---------|-----------|
| **app/** | Páginas (App Router) y API routes |
| **components/** | Componentes reutilizables |
| **lib/** | Lógica de negocio, storage, tipos |
| **supabase/migrations/** | Migraciones SQL (RLS, schema) |
| **scripts/** | Scripts de utilidad (RLS, tests) |

---

## 11. Proceso de Despliegue

### Flujo

```
Cursor (desarrollo)
    │
    └── git add .
    └── git commit -m "mensaje"
    └── git push origin main
    │
    ▼
GitHub (repositorio)
    │
    └── Webhook a Vercel
    │
    ▼
Vercel (build)
    │
    └── npm install
    └── next build
    └── Deploy
    │
    ▼
Producción (URL Vercel)
```

### Variables de entorno (Vercel)

| Variable | Descripción |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave anónima (pública) |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio (solo API routes) |
| `WEBHOOK_URL` | URL para enviar eventos (n8n, Zapier, etc.) |
| `WEBHOOK_SECRET` | Clave para autenticar webhooks entrantes (ej. CRM leads) |
| `CRM_WEBHOOK_EMPRESA_ID` | (Opcional) Empresa por defecto para leads vía webhook |

### Comandos útiles

```bash
# Desarrollo
npm run dev

# Build
npm run build

# Producción local
npm run start

# Verificar RLS
npm run db:verificar-rls

# Ejecutar migración RLS
npm run db:push-rls
```

### Supabase

- Las migraciones se ejecutan manualmente o desde el dashboard de Supabase.
- Configurar las variables de entorno en el proyecto Vercel vinculado al proyecto Supabase.

---

## Anexo: Persistencia por módulo

| Módulo | Persistencia |
|--------|--------------|
| Clientes | Supabase |
| Productos | Supabase |
| Movimientos inventario | Supabase |
| CRM (prospectos, notas) | Supabase |
| Planes | Supabase |
| Gastos | Supabase |
| Pagos | Supabase (API) |
| Facturas | Supabase |
| Suscripciones | Supabase |
| Ventas | localStorage |
| Compras | localStorage |
| Proveedores | localStorage |
| Usuarios (gestión) | localStorage |
| Configuración | localStorage |
| Favoritos | localStorage |

> **Nota:** Ventas, compras y proveedores tienen tablas en Supabase (schema) pero la capa de storage actual usa localStorage. La migración a Supabase puede realizarse siguiendo el patrón de clientes/inventario.

---

*Documento generado para Neura ERP. Para consultas técnicas, contactar al equipo de desarrollo.*
