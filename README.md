# ASUNHOME ERP

ERP dedicado de ASUNHOME. Instancia monocliente: **un solo schema Postgres**
(`asunhome`) con catálogo + datos operativos.

Derivado del código de `neura-erp-ferrecolor`, pero es un **proyecto
independiente**: repo propio sin historial compartido, schema propio y deploy
propio. Los cambios acá no impactan en Ferrecolor y viceversa.

- **Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4
- **Base de datos:** Supabase self-hosted (Postgres + PostgREST + Auth)
- **Deploy:** Coolify vía Dockerfile (`output: "standalone"`)

---

## Puesta en marcha

### 1. Base de datos

Ejecutar en el **SQL Editor** de Supabase, como `postgres`:

```
supabase/asunhome/00_setup_schema_asunhome.sql
```

El script crea el schema `asunhome` clonando la **estructura** de `ferrecolor`
(sin datos), agrega las tablas del alcance ASUNHOME y aplica los grants.
Detalle completo en [`supabase/asunhome/README.md`](supabase/asunhome/README.md).

Después hay que exponer el schema en PostgREST (variables del contenedor `rest`):

```
PGRST_DB_SCHEMAS=public,graphql_public,asunhome
PGRST_DB_EXTRA_SEARCH_PATH=public,extensions,asunhome
```

### 2. Variables de entorno

```bash
cp .env.example .env.local
```

Completar al menos `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` y `DATABASE_URL`.

`NEURA_CLIENT_SCHEMA` ya viene en `asunhome` como default del código
(`src/lib/supabase/schema.ts`); solo hace falta declararla si se cambia.

### 3. Desarrollo

```bash
npm install
npm run dev
```

---

## Deploy en Coolify

Tipo de recurso: **Dockerfile** (no Nixpacks).

Las `NEXT_PUBLIC_*` se inlinean durante `next build`, así que en Coolify tienen
que estar cargadas **como build args además de runtime env**:

| Variable | Build | Runtime |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | sí | sí |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | sí | sí |
| `NEXT_PUBLIC_SUPER_ADMIN_EMAILS` | sí | sí |
| `SUPABASE_SERVICE_ROLE_KEY` | no | sí |
| `DATABASE_URL` / `DIRECT_URL` | no | sí |
| `NEURA_CLIENT_SCHEMA` | no | sí |
| `SIFEN_SECRETS_KEY` | no | sí |

- **Puerto expuesto:** `3000`
- **Comando:** el del Dockerfile (`node server.js`) — no sobrescribir

---

## Estructura

```
src/app/          rutas y páginas (App Router)
src/components/   UI
src/lib/          dominio: ventas, compras, inventario, sifen, chat, crm...
supabase/asunhome/    setup del schema de esta instancia   ← empezar acá
supabase/migrations/  histórico heredado de Ferrecolor (referencia)
scripts/          utilidades de mantenimiento y QA
docs/             documentación funcional heredada
```

> `supabase/migrations/` se conserva como **referencia histórica**. Esas
> migraciones apuntan a schemas `public` / `zentra_erp` / `erp_*` y **no**
> alcanzan al schema `asunhome`. Los cambios de base nuevos van como scripts
> propios en `supabase/asunhome/`.
