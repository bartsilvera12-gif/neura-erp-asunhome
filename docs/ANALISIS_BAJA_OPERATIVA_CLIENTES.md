# Análisis técnico: Mejora estructural módulo Clientes

## Parte 1: Simplificación (categoria_cliente, industria)
- **Objetivo**: Eliminar de UI/types, mantener columnas en DB
- **Archivos modificados**: types.ts, storage.ts, nuevo/page.tsx, [id]/page.tsx
- **Sin migración**: Las columnas permanecen en la tabla (no rompe datos existentes)

## Parte 2: Baja operativa
- **Nuevos campos cliente**: baja_operativa_at, baja_operativa_by_user_id, baja_operativa_motivo, baja_operativa_anulo_factura
- **Migración**: 20250322000001_clientes_baja_operativa.sql
- **API**: GET/POST /api/clientes/[id]/baja-operativa
- **Lógica**: estado→inactivo; suscripciones activas→cancelada; factura pendiente opcional anulada
- **Validación admin**: rol in (admin, administrador, super_admin)
- **UI**: Botón "Dar de baja cliente" en detalle (solo admin), modal con motivo y opción de anular factura pendiente

## Parte 3: Fix validación
- Nuevo/edición: si estado=inactivo, no exigir plan/suscripción para MENSUAL
- Crear suscripción solo si estado=activo y MENSUAL

## Parte 4: Métricas dashboard
- clientes_baja_mes: count clientes con baja_operativa_at en mes actual
- monto_perdido_bajas_mes: sum(suscripciones.precio) de suscripciones canceladas de esos clientes
- Dashboard financiero: excluir facturas Anulado de facturado, saldo, distribución
