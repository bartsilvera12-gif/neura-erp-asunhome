# Guarda → Venta: riesgo de doble descuento y propuesta

_Auditoría de stock (ANAFE DAKO) — 2026-09-09._

## Estado actual (hecho comprobado)

- **No existe una conversión formal Guarda → Venta.** No hay ruta ni acción de
  UI de "facturar guarda" / "convertir a venta". En las pantallas de Reservas
  (`src/app/reservas/**`) las únicas acciones son **registrar pago**, **entrega
  parcial** y **cancelar**. Las columnas `reservas.estado='facturada'` y
  `reservas.venta_id` existen en el schema (`supabase/asunhome/13_reservas_guarda.sql`)
  pero **ningún código las usa hoy**.
- Al **crear** una guarda, la mercadería ya **sale del stock** (SALIDA origen
  `reserva`): `7 → 6` (`src/lib/reservas/server/reservas-pg.ts` → `crearReserva`).

## El riesgo (workflow, no doble ejecución automática)

Como la guarda **ya descontó** el stock, si un usuario "factura" esa guarda
**creando una venta normal** desde `Caja → Nueva venta` por el mismo producto,
la venta **vuelve a descontar** stock (`createVentaTransaccionalPg` siempre
genera una SALIDA `venta`):

```
Guarda:            7 → 6   (SALIDA 'reserva')
Venta manual:      6 → 5   (SALIDA 'venta')   ← doble descuento de la MISMA mercadería
```

No es una doble ejecución del sistema: son dos operaciones distintas sobre la
misma mercadería reservada. Igual conviene cerrarlo para evitar faltantes.

## Propuesta de conversión correcta (a implementar cuando se priorice)

Objetivo: **facturar la guarda sin volver a descontar stock.**

```
Guarda:            7 → 6   (ya descontado al crear)
Facturar guarda:   stock CONTINÚA en 6   (la venta asume el stock ya comprometido)
```

Diseño sugerido (mínimo, reusando lo existente):

1. Acción única **"Facturar guarda"** en el detalle de la reserva (una sola vía;
   no facturar guardas creando ventas sueltas).
2. Server-side, en una transacción:
   - Crear la venta con un **flag `sin_descontar_stock`** (o `origen_reserva_id`)
     para que `createVentaTransaccionalPg` **omita** la SALIDA de stock y el
     decremento de las cantidades que ya salieron por la guarda.
   - Vincular `ventas` ↔ `reservas` (`reservas.venta_id`, `reservas.estado='facturada'`).
   - Idempotente y atómico (mismo patrón que `anular-venta-pg.ts` / `devoluciones-pg.ts`),
     con guard de estado (`activa` → `facturada`) bajo `FOR UPDATE` para que un
     doble click/retry no genere dos ventas ni doble movimiento.
3. Solo se factura lo **no entregado** aún pendiente (respetando
   `reserva_items.cantidad_entregada`).
4. Bloquear/avisar en `Nueva venta` si el producto tiene una guarda activa del
   mismo cliente (guía de UX para no facturar por afuera).

> No implementado en este cambio (fuera del alcance aprobado 1–4). Queda como
> propuesta para revisión y priorización.
