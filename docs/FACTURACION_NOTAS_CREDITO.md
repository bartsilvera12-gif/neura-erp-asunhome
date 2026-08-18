# Notas de crédito — Fase 1 y Fase 2 (SIFEN)

## Alcance

- Modelo de datos en el schema de datos de la empresa (`zentra_erp` o `erp_*` vía `empresa.data_schema`).
- Creación de NC en estado **borrador** con monto = **saldo pendiente** al momento de crear.
- Registro de fila en **nota_credito_electronica** en estado SIFEN `sin_envio` (sin XML/envío en esta fase).
- **Auditoría** en `nota_credito_evento` (creación, validación, anulación de borrador).
- UI en detalle de factura: bloque **Corrección fiscal**, historial y modal de alta.
- **No** se modifica el saldo de la factura al crear el borrador.

## Fase 2 — Ciclo SIFEN completo (NC)

- Generación de XML (rDE v150, nota de crédito electrónica), firma, envío `recibe-lote`, consulta de lote y transición de estados.
- **`facturas.saldo`** se actualiza **solo** cuando `nota_credito_electronica.estado_sifen` pasa a **`aprobado`** (RPC atómico en `zentra_erp` + schema de datos de la empresa).
- Si SET **rechaza**, no se toca saldo; `nota_credito.estado_erp` → `rechazada`.
- Estados SIFEN: `sin_envio`, `generado`, `firmado`, `enviado`, `en_proceso` (p. ej. lote 0361), `aprobado`, `rechazado`, `error_envio`, `cancelado`.
- Auditoría: `nota_credito_evento` con tipos `xml_generado`, `xml_firmado`, `enviado_set`, `respuesta_set`, `aprobado`, `rechazado`, `impacto_saldo_aplicado`, `error_envio`, etc.

Endpoints: ver `docs/API.md` — sección **Notas de crédito — SIFEN**.

## Módulo operativo global

- Pantalla **`/notas-credito`**: listado con filtros (fechas, cliente, estados ERP/SIFEN, usuario, factura, motivo, CDC, con/sin error).
- Detalle **`/notas-credito/[id]`**: datos generales, DE SIFEN (paths, CDC, respuestas JSON) e **historial de eventos** (`nota_credito_evento`).
- Menú: **Notas de crédito** (entrada principal del sidebar; acceso con módulo `ventas` o `notas_credito` según `empresa_modulos`).
- Pruebas SET con empresa en producción: variable de servidor **`ALLOW_TEST_MODE=true`**; ver `docs/API.md`.

## Reglas de prioridad

Si el DE está **aprobado** y aún **puede cancelarse** dentro del plazo configurado (y sin pagos, etc.), el sistema **rechaza** crear una NC (`409`) y la UI prioriza la cancelación.

## Tablas

| Tabla | Rol |
|-------|-----|
| `nota_credito` | Cabecera comercial + snapshots + estado ERP |
| `nota_credito_electronica` | Ciclo de vida del DE de la NC (preparado para fase SIFEN) |
| `nota_credito_evento` | Auditoría / eventos de negocio |

## API

Ver `docs/API.md` — sección facturas / notas-credito.
