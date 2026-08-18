# Integración Sorteos ↔ n8n

El ERP expone un endpoint HTTP propio; **no** se debe usar PostgREST/anon key contra las tablas `sorteos` desde n8n.

## Activación por empresa

1. Aplicar la migración SQL (`supabase/migrations/20250326000003_modulo_sorteos.sql`).
2. En **Admin Empresas** (o directamente en `empresa_modulos`), activar el módulo con slug `sorteos` para la empresa cliente.
3. Opcional: restringir por usuario con `usuario_modulos` si el ERP lo usa para esa empresa.

Sin `empresa_modulos.activo = true` para ese módulo, el menú no aparece y el endpoint rechaza el registro.

## Endpoint

- **Método:** `POST`
- **URL:** `{BASE_URL_ERP}/api/raffles/entries/create`
- **Content-Type:** `application/json`

### Headers (recomendado en producción)

Definir en el servidor (Vercel/hosting):

```env
RAFFLES_N8N_SECRET=tu_secreto_largo_y_aleatorio
```

Si `RAFFLES_N8N_SECRET` está definido, la petición debe incluir **una** de:

- `Authorization: Bearer <RAFFLES_N8N_SECRET>`
- `x-api-key: <RAFFLES_N8N_SECRET>`
- `x-raffles-secret: <RAFFLES_N8N_SECRET>`

Si la variable **no** existe, el endpoint acepta la petición sin esos headers (solo para desarrollo).

### Body (JSON)

| Campo | Tipo | Obligatorio |
|-------|------|-------------|
| `empresa_id` | UUID | Sí |
| `sorteo_id` | UUID | Sí |
| `whatsapp_numero` | string | Sí |
| `nombre_completo` | string | Sí |
| `cedula` | string | Recomendado |
| `celular` | string | Recomendado |
| `ciudad` | string | Opcional |
| `cantidad_boletos` | number (>0) | Sí |
| `fecha_pago` | string ISO | Sí (puede ser vacío si la RPC lo trata como null) |
| `monto_pago` | number | Sí |
| `banco_origen` | string | Recomendado |
| `comprobante_url` | string \| null | Opcional |
| `ultimo_mensaje` | string \| null | Opcional |

La lógica atómica vive en Postgres: función `sorteos_registrar_compra_n8n` (`SECURITY DEFINER`), llamada con **service role** desde la API.

### Respuesta OK (200)

```json
{
  "ok": true,
  "message": "Compra registrada correctamente",
  "cliente": { "id": "uuid", "nombre": "..." },
  "conversacion": { "id": "uuid", "estado": "paid_confirmed" },
  "entrada": {
    "id": "uuid",
    "cantidad_boletos": 3,
    "monto_total": 15000,
    "estado_pago": "confirmado"
  },
  "cupones": [
    { "id": "uuid", "numero_cupon": "0001" },
    { "id": "uuid", "numero_cupon": "0002" }
  ]
}
```

### Errores

- `ok: false` y `message` descriptivo.
- Códigos HTTP típicos: `400` validación, `401` sin secret, `403` módulo no habilitado o sorteo inactivo, `404` sorteo/empresa, `409` sin cupos.

## Ejemplo cURL

```bash
curl -X POST "https://tu-dominio.com/api/raffles/entries/create" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RAFFLES_N8N_SECRET" \
  -d '{
    "empresa_id": "00000000-0000-0000-0000-000000000000",
    "sorteo_id": "00000000-0000-0000-0000-000000000000",
    "whatsapp_numero": "+595981000000",
    "nombre_completo": "Juan Pérez",
    "cedula": "1234567",
    "celular": "0981000000",
    "ciudad": "Asunción",
    "cantidad_boletos": 2,
    "fecha_pago": "2025-03-24T12:00:00.000Z",
    "monto_pago": 20000,
    "banco_origen": "Itaú",
    "comprobante_url": null,
    "ultimo_mensaje": null
  }'
```
