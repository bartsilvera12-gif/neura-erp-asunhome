# Propuesta técnica: Marketing Ops basado en planes

## 1. Inspección actual

### Planes (`planes`)
- Campos: id, empresa_id, codigo_plan, nombre, descripcion, precio, moneda, periodicidad, limite_*, estado
- **No tiene** concepto de "plan de marketing" ni plantilla operativa

### Suscripciones (`suscripciones`)
- Relaciona: cliente_id, plan_id, fecha_inicio, duracion_meses, estado (activa/pausada/cancelada)
- No hay lógica que vincule plan → tipo_servicio_cliente del cliente

### Clientes (`clientes`)
- `tipo_servicio_cliente`: marketing | saas | branding | web | otro
- Hoy se marca manualmente

### marketing_tasks
- id, empresa_id, cliente_id, titulo, tipo_contenido, estado, fecha_entrega, responsable_user_id, prioridad
- **No tiene** suscripcion_id ni plan_id (origen de la tarea)
- Creación 100% manual

### Rutas
- `/marketing`: lista tareas por fecha/cliente, sin calendario
- `/clientes/[id]`: tab Marketing con crear tarea manual

---

## 2. Cambios en base de datos

### 2.1 Planes: nueva configuración de marketing

```sql
-- Planes: marcar como plan de marketing y plantilla operativa
ALTER TABLE public.planes
  ADD COLUMN IF NOT EXISTS es_plan_marketing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS plantilla_operativa jsonb;
```

**Estructura plantilla_operativa (MVP):**
```json
{
  "items": [
    {
      "tipo_contenido": "post",
      "cantidad_semanal": 3,
      "dias_semana": [1, 3, 5]
    },
    {
      "tipo_contenido": "historia",
      "cantidad_semanal": 2,
      "dias_semana": [2, 4]
    },
    {
      "tipo_contenido": "reel",
      "cantidad_mensual": 1,
      "dia_mes": 15
    }
  ]
}
```

- `dias_semana`: 0=domingo, 1=lunes … 6=sábado
- `cantidad_semanal` + `dias_semana`: genera N tareas en esos días cada semana
- `cantidad_mensual` + `dia_mes`: genera 1 tarea el día X de cada mes (o día hábil cercano)

**Alternativa más simple para MVP:** solo items con `cantidad_semanal` y `dias_semana`. Lo mensual se puede omitir en v1.

### 2.2 marketing_tasks: trazabilidad y deduplicación

```sql
ALTER TABLE public.marketing_tasks
  ADD COLUMN IF NOT EXISTS suscripcion_id uuid REFERENCES public.suscripciones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.planes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS generada_automaticamente boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS plantilla_item_idx integer;

CREATE INDEX IF NOT EXISTS idx_marketing_tasks_suscripcion ON public.marketing_tasks(suscripcion_id);
CREATE INDEX IF NOT EXISTS idx_marketing_tasks_plan ON public.marketing_tasks(plan_id);

-- Evitar duplicados: mismo cliente, fecha, tipo, origen plan
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_tasks_uniq_gen
  ON public.marketing_tasks(cliente_id, fecha_entrega, tipo_contenido, plan_id)
  WHERE plan_id IS NOT NULL AND generada_automaticamente = true;
```

---

## 3. Cambios en planes (UI + storage)

### 3.1 Tipos

```ts
// lib/planes/types.ts
export interface PlanMarketingItem {
  tipo_contenido: "post" | "reel" | "historia" | "anuncio" | "otro";
  cantidad_semanal?: number;
  dias_semana?: number[];  // 0-6
  cantidad_mensual?: number;
  dia_mes?: number;  // 1-28
}

export interface PlanMarketingPlantilla {
  items: PlanMarketingItem[];
}

export interface Plan {
  // ... existentes ...
  es_plan_marketing?: boolean;
  plantilla_operativa?: PlanMarketingPlantilla | null;
}
```

### 3.2 UI en /planes/[id]

- Checkbox: "Es plan de marketing"
- Si es plan de marketing → sección "Plantilla operativa" con:
  - Lista de items (tipo_contenido, cantidad_semanal, días semana)
  - Agregar / quitar items
  - MVP: sin cantidad_mensual/día_mes

---

## 4. Integración plan → cliente (suscripciones)

### 4.1 Al crear/activar suscripción

En `saveSuscripcion` (o en un hook post-insert):

1. Si `plan_id` no es null:
   - Obtener plan → `es_plan_marketing`
2. Si `es_plan_marketing === true`:
   - Actualizar cliente: `tipo_servicio_cliente = 'marketing'`
3. Opcional: disparar generación de tareas para las próximas 4 semanas

### 4.2 Al cancelar suscripción

- No cambiar `tipo_servicio_cliente` (puede tener otras suscripciones marketing)
- Las tareas ya generadas siguen existiendo; el cliente puede seguir apareciendo si tiene otra suscripción activa

---

## 5. Motor de generación de tareas

### 5.1 Función principal

```ts
// lib/marketing/generador.ts

/** Genera tareas de marketing para suscripciones activas con planes marketing */
export async function generarTareasMarketing(opts: {
  empresa_id: string;
  fecha_inicio: string;  // YYYY-MM-DD
  fecha_fin: string;
}): Promise<{ generadas: number; errores: string[] }>
```

Flujo:

1. Listar suscripciones activas con `plan_id` no null
2. Filtrar planes donde `es_plan_marketing = true`
3. Filtrar clientes activos y no eliminados
4. Para cada (suscripcion, plan) con plantilla válida:
   - Iterar desde fecha_inicio hasta fecha_fin (día a día o por semana)
   - Por cada item de plantilla: si ese día aplica → crear tarea
   - Usar INSERT … ON CONFLICT DO NOTHING o verificar existencia antes
5. Actualizar cliente: `tipo_servicio_cliente = 'marketing'` si no lo está
6. Devolver contador de tareas generadas

### 5.2 Lógica por item (MVP semanal)

- Si tiene `cantidad_semanal` y `dias_semana`:
  - Para cada semana en [fecha_inicio, fecha_fin]:
    - Para cada día en dias_semana: calcular fecha concreta
    - Si fecha está en rango → insertar tarea con título ej. "Post - [cliente] - [fecha]"
    - Evitar duplicados con el unique index

---

## 6. Sincronización retroactiva

### 6.1 API route

```
POST /api/marketing/sync
```

- Requiere admin o rol adecuado
- Llama a `generarTareasMarketing` con:
  - `fecha_inicio`: hoy
  - `fecha_fin`: hoy + 4 semanas (configurable)
- Recorre clientes con suscripciones activas a planes marketing:
  - Actualiza `tipo_servicio_cliente = 'marketing'` donde aplique
- Devuelve: { clientes_actualizados, tareas_generadas, errores }

### 6.2 UI administrativa

- En `/marketing`: botón "Sincronizar" para admins
- O en Configuración / Módulos: "Sincronizar Marketing Ops"

---

## 7. Nueva UX de Marketing Ops

### 7.1 Mini dashboard (header)

| Métrica        | Descripción                          |
|----------------|--------------------------------------|
| Tareas atrasadas | fecha < hoy y estado no finalizado  |
| Tareas de hoy  | fecha_entrega = hoy                  |
| Tareas semana  | fecha en los próximos 7 días         |
| Clientes marketing | count clientes activos con tipo marketing |

### 7.2 Vista principal: calendario

- Selector de mes (anterior / actual / siguiente)
- Vista semana o mes:
  - **Semana (MVP):** grilla 7 columnas (días) × N filas (agrupadas por cliente o por slot)
  - Cada celda: lista de tareas del día con estado, cliente, tipo
- Click en tarea → modal o navegación a detalle/edición
- Filtros: cliente, responsable (si hay)

### 7.3 Tab en cliente

- Mantener tab Marketing
- Origen de tareas: **plan** (generadas) o **manual** (creadas a mano)
- Sigue permitiendo "Nueva tarea" manual para casos puntuales
- Mostrar de dónde viene cada tarea (plan X o manual)

---

## 8. Resumen de archivos a tocar

| Área           | Archivos                                                |
|----------------|---------------------------------------------------------|
| Migración      | `supabase/migrations/YYYYMMDD_marketing_planes.sql`     |
| Planes types   | `src/lib/planes/types.ts`                              |
| Planes storage | `src/lib/planes/storage.ts`                            |
| Planes UI      | `src/app/planes/[id]/page.tsx`, `nuevo/page.tsx`       |
| Marketing gen  | `src/lib/marketing/generador.ts` (nuevo)                |
| Marketing storage | `src/lib/marketing/storage.ts` (ajustes)             |
| Suscripciones  | `src/lib/facturacion/storage.ts` (sync cliente)        |
| API sync       | `src/app/api/marketing/sync/route.ts`                  |
| Vista /marketing | `src/app/marketing/page.tsx` (rediseño)              |
| Cliente tab    | `src/app/clientes/[id]/page.tsx`                       |

---

## 9. Orden de implementación sugerido

1. Migración: planes (es_plan_marketing, plantilla_operativa) + marketing_tasks (suscripcion_id, plan_id, etc.)
2. Planes: tipos, storage, UI para marcar plan marketing y configurar plantilla
3. Marketing: `generador.ts` con lógica semanal
4. Suscripciones: al guardar, sync cliente si plan es marketing
5. API `/api/marketing/sync`
6. Vista /marketing: dashboard + calendario semanal
7. Cliente tab: mostrar origen plan/manual, mantener creación manual

---

## 10. Consideraciones

- **No eliminar** creación manual de tareas: útil para entregas puntuales fuera del plan
- **Idempotencia**: la generación debe poder ejecutarse varias veces sin duplicar (unique index)
- **Rendimiento**: generar en bloques (por ejemplo 4–8 semanas) para no saturar
- **Extensión futura**: agregar cantidad_mensual/día_mes cuando el MVP esté estable
