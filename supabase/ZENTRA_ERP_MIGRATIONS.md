# Migraciones Neura ERP → esquema `zentra_erp`

## Objetivo

- **Runtime** (Next.js, PostgREST): ya usa `zentra_erp` vía `src/lib/supabase/schema.ts`.
- **DDL versionado**: todas las migraciones bajo `supabase/migrations/` crean y alteran objetos en **`zentra_erp`**, no en `public`.
- Un **`supabase db reset`** (o base nueva) debe dejar el ERP **solo** en `zentra_erp`.

## Estrategia

1. **Bootstrap** (`20250308000000_zentra_erp_bootstrap.sql`)  
   Crea el esquema, grants y default privileges para `anon`, `authenticated`, `service_role` y `postgres`. Corre **antes** del resto (timestamp menor que `20250309000001_…`).

2. **Histórico reescrito (una sola vez)**  
   Las migraciones que decían `public.` fueron normalizadas a `zentra_erp.` con el script:
   `npx tsx scripts/rewrite-migrations-public-to-zentra.ts`  
   **No volver a ejecutarlo** salvo revertir desde git y repetir el proceso a propósito.

3. **Migración legacy sin efecto**  
   `20260411120000_zentra_erp_mirror_sorteos_rpc_from_public.sql` quedó como no-op documentado: las RPC ya se definen en `zentra_erp` en migraciones anteriores. Se conserva el **nombre de archivo** para no romper el registro de versiones en proyectos que ya lo aplicaron.

4. **Nuevas migraciones**  
   - Crear tablas, funciones, triggers y políticas **siempre** calificadas con `zentra_erp.` (o `SET search_path = zentra_erp` en `SECURITY DEFINER` cuando aplique).
   - No crear tablas de negocio en `public`.
   - Referencias a **`auth.users`** siguen siendo `auth.users` (no tocar).

5. **Scripts que aplican SQL suelto**  
   `scripts/erp-db.ts` → `rewriteErpSqlFromPublicToZentra()` sigue útil para SQL antiguo copiado desde docs; en archivos ya migrados es idempotente.

## Realtime

La migración `20250329140000_chat_realtime_publication.sql` añade a `supabase_realtime` las tablas **`zentra_erp.chat_messages`** y **`zentra_erp.chat_conversations`**.

## Validación

Tras levantar una base limpia (local o remoto):

```bash
npx tsx scripts/verify-zentra-erp-db-install.ts
```

Comprueba: `zentra_erp.empresas`, ausencia de `public.empresas`, funciones RLS base y tablas de chat en la publicación realtime.

## Self-host / Cloud

- `supabase/config.toml`: `schemas` y `extra_search_path` deben incluir `zentra_erp` (ya en el repo).
- En Supabase Cloud: **Settings → API → Exposed schemas** debe incluir `zentra_erp`.

## Bases ya existentes (datos en `public`)

**Importante:** si un proyecto **ya aplicó** las migraciones cuando apuntaban a `public`, el historial en `supabase_migrations` coincide con los **nombres** de archivo pero el **contenido** ahora es distinto (checksum). No mezcles ese remoto con `supabase db pull` / repair sin criterio: para entornos viejos conviene **clonar** a `zentra_erp` o recrear la base; para entornos **nuevos**, aplica esta versión del repo tal cual.

No re-ejecutan migraciones antiguas automáticamente. Opciones:

- Clonar datos `public` → `zentra_erp` con `supabase/scripts/zentra_erp_clone_from_public.sql`, o
- Dump/restore planificado, según tu operación.

El código de aplicación ya no depende de tablas ERP en `public`.

## Multi-cliente (siguiente paso)

Para un esquema por cliente, el patrón natural es parametrizar el nombre de esquema en migraciones (plantillas) o usar un job que sustituya `zentra_erp` por `cliente_x`; este repo fija `zentra_erp` como esquema único del producto.

## Micro-correcciones por tenant (excepción acotada)

Algunos tenants (`erp_*`) reciben **repunte puntual de FK** hacia tablas en **su mismo schema** (p. ej. `sorteos`, `sorteo_entradas`) cuando los UUID solo existen ahí y no en `zentra_erp`. Ejemplo versionado: `20260531120001_fix_triple7_sorteos_fk_micro_correction.sql` (**solo** `erp_triple_7_82f8a15a`).

- Es un esquema de **micro-migración gradual**, no una migración masiva multi-schema.
- **No extrapolar** a otros tenants sin diagnóstico equivalente (FKs y datos por schema).

## Micro-correcciones Triple 7 — flujo sorteo, sesiones, comprobantes y ticket PNG

Migración versionada: **`20260607120000_fix_triple7_flow_session_and_ticket_fk_micro_corrections.sql`** (exclusivamente el schema **`erp_triple_7_82f8a15a`**).

Fueron **correcciones acotadas por tenant** aplicadas en producción para alinear FKs con tablas del mismo schema (evitar referencias residuales a `zentra_erp` donde los datos viven en el tenant) y fijar el modo de entrega de ticket del sorteo TRIPLE 7. **No** es una migración masiva multi-schema ni un patrón genérico para todos los `erp_*`.

**Contenido reflejado (micro-pasos 3–8):**

| Paso | Tabla(s) | Cambio |
|------|----------|--------|
| 3 | `sorteo_entradas` | FKs hacia `clientes`, `chat_conversations`, `chat_comprobante_validaciones` con `ON DELETE SET NULL` según corresponda |
| 4 | `sorteo_ticket_deliveries` | FKs hacia `sorteos` y `sorteo_entradas` con `ON DELETE CASCADE` |
| 5 | `chat_conversations` | `active_flow_session_id` → `chat_flow_sessions` con `ON DELETE SET NULL` |
| 6 | `chat_flow_events`, `chat_flow_data` | `flow_session_id` → `chat_flow_sessions` (`SET NULL` / `CASCADE` según tabla) |
| 7 | `chat_comprobante_validaciones` | `flow_session_id` → `chat_flow_sessions` con `ON DELETE CASCADE` |
| 8 | `sorteos` | Para el sorteo id `d891810e-114c-4276-a2f3-65aab8732fc8` (nombre TRIPLE 7): `ticket_delivery_mode` de `text_only` → `text_and_image` solo si aún estaba en `text_only`; si ya es `text_and_image`, no-op; otros valores → error explícito (no pisar en silencio) |

La migración es **idempotente**: solo **repunta** una FK si sigue apuntando a `zentra_erp`; si ya es local, emite `RAISE NOTICE` y no altera. Usa `NOT VALID` + comprobación de huérfanos + `VALIDATE CONSTRAINT`.

**Operación manual de QA (no repetible en migración):** durante pruebas se alineó una conversación concreta (`conversation_id = 915f0cfd-b371-41c0-8561-539420bb5f50`, `active_flow_session_id = e901af61-a595-4666-ac1a-7dd976819cc5`). Eso fue **reparación operativa puntual**, no parte del DDL versionado obligatorio para nuevas bases.

**Advertencia:** no extrapolar estos cambios a otros tenants sin revisar `pg_get_constraintdef`, huérfanos y datos en cada schema.
