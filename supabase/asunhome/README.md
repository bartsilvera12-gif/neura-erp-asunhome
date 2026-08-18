# Schema `asunhome`

Setup de base de datos de la instancia ASUNHOME sobre Supabase self-hosted.

## Ejecución

SQL Editor de Supabase, como `postgres`, de una sola vez:

```
00_setup_schema_asunhome.sql
```

Antes de correrlo, confirmá el nombre real del schema origen. Si no lo sabés:

```sql
SELECT nspname
FROM pg_namespace
WHERE nspname NOT IN ('pg_catalog','information_schema','pg_toast')
  AND nspname NOT LIKE 'pg\_%'
ORDER BY 1;
```

El origen está fijado en dos lugares del script (`PARTE 0` y `PARTE 2`) como
`'ferrecolor'`. Si el schema real tiene otro nombre, cambialo en ambos.

## Qué hace

| Parte | Contenido |
|---|---|
| 0 | Preflight: extensiones, valida que el origen exista y el destino no |
| 1 | Helpers de clonación (`public.neura_clonar_schema_estructura`) |
| 2 | `CREATE SCHEMA asunhome` + clon estructural **sin datos** |
| 3 | Tablas y columnas nuevas del alcance ASUNHOME |
| 4 | Vistas de reportes |
| 5 | RLS de las tablas nuevas, grants y default privileges |
| 6 | Consultas de verificación |

La clonación copia tablas, PK/UNIQUE/CHECK, índices, FKs, funciones, triggers,
vistas, matviews, RLS y policies, reapuntando toda referencia `ferrecolor.*`
(y `zentra_erp.*` cuando el objeto existe en el origen) hacia `asunhome.*`.
**No copia ninguna fila.**

## Tablas nuevas (10)

Verificadas contra el catálogo real de Ferrecolor: son las que efectivamente
no existen ahí.

| Tabla | Cubre |
|---|---|
| `marcas` | REPORTE MARCA |
| `lineas_producto` | REPORTE LINEA DE PRODUCTOS |
| `producto_series` | venta por serial, carga de obs/nº de serie, trazabilidad a proveedor |
| `productos_averiados` | producto averiado + de qué proveedor vino |
| `servicio_tecnico_ordenes` / `_items` / `_historial` | servicio técnico |
| `ajustes_stock` / `_items` | ajustes de stock |
| `ajuste_stock_autorizados` | usuario único de ajuste |

## Tablas heredadas que se reconcilian (no se duplican)

Ferrecolor tiene 125 tablas; `supabase/migrations/` solo documenta ~47. Estas
ya existían y el script solo les agrega columnas:

| Tabla | Se agrega |
|---|---|
| `productos` | `marca_id`, `linea_id`, `maneja_series`, `garantia_meses` |
| `presupuestos` | `origen`, `orden_servicio_id`, `tipo_cambio`, `vendedor_id`, `vendedor_nombre`, `condiciones`, `created_by`, `updated_by` |
| `presupuesto_items` (singular) | `orden`, `observaciones` |
| `cajas` | `ubicacion_id` |
| `caja_movimientos` | `orden_servicio_id`, `cliente_id` |
| `movimientos_inventario` | `ubicacion_origen_id`, `ubicacion_destino_id`, `serie_id`, `ajuste_id`, `orden_servicio_id`, `observaciones` |

Los CHECK de `movimientos_inventario` se **amplían** conservando los valores
heredados (`produccion`, `devolucion_venta` incluidos); nunca se reemplazan.

Descartado del diseño inicial por existir ya: `caja_sesiones` (se usa `cajas`)
y `presupuestos_items` (se usa `presupuesto_items`).

## Vistas de reporte

`v_reporte_ventas` · `v_reporte_stock` · `v_reporte_stock_ubicacion` ·
`v_reporte_linea_producto` · `v_reporte_marca` · `v_reporte_proveedor` ·
`v_costos_precios` · `v_reporte_caja` · `v_cliente_historial_compras` ·
`v_trazabilidad_series` · `v_servicio_tecnico`

## Cosas a tener en cuenta

1. **Salón y depósito** son filas de `inventario_ubicaciones` (`tipo` =
   `'salon'` / `'deposito'`), no tablas separadas. El bloque de semillas al
   final del script las crea; necesita el `empresa_id` real.

2. **Usuario único de ajuste**: lo garantiza un índice único parcial sobre
   `ajuste_stock_autorizados (empresa_id) WHERE activo`. Para cambiar de
   responsable hay que desactivar el anterior en la misma transacción.

3. **RLS de las tablas nuevas**: si el clon trajo
   `asunhome.puede_acceder_empresa(uuid)`, las policies lo usan. Si no, el
   script emite un WARNING y deja RLS permisiva para `authenticated` — en ese
   caso revisá las policies antes de exponer la instancia.

4. **`supabase/migrations/` no alcanza a este schema**: esas migraciones
   filtran por `public`, `zentra_erp`, `erp_*` y `er_*`. `asunhome` no matchea
   ninguno de esos patrones. Los cambios nuevos van como scripts numerados acá.

5. **Tipos propios**: el script avisa si el origen define enums o dominios
   (el código heredado no usa ninguno). Si aparecieran, las columnas clonadas
   seguirían apuntando al tipo del schema origen y hay que migrarlas a mano.
