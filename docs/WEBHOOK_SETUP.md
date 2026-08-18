# Configuración de Webhooks para n8n

## 1. Configurar WEBHOOK_URL en Vercel

1. Entrá a [Vercel](https://vercel.com) → tu proyecto **neura-erp**
2. **Settings** → **Environment Variables**
3. Agregá:
   - **Name:** `WEBHOOK_URL`
   - **Value:** La URL del webhook de n8n (ver paso 2)
   - **Environment:** Production (y Preview si querés probar en preview)
4. **Save** y hacé **Redeploy** del proyecto

## 2. Obtener la URL del webhook en n8n

1. En n8n, creá un workflow nuevo
2. Agregá el nodo **Webhook** (trigger)
3. Configurá:
   - **HTTP Method:** POST
   - **Path:** `neura-erp` (o el nombre que prefieras)
4. **Guardá** el workflow y **activálo** (toggle en la esquina superior derecha)
5. Copiá la **Production URL** que muestra el nodo, por ejemplo:
   - n8n Cloud: `https://tu-instancia.app.n8n.cloud/webhook/neura-erp`
   - Self-hosted: `https://tu-dominio.com/webhook/neura-erp`

⚠️ **Importante:** Usá la URL de **Production**, no la de Test. El workflow debe estar **activado**.

## 3. Probar la conexión

### Opción A: Endpoint de prueba (recomendado)

Con la sesión iniciada en el ERP:

1. Abrí en el navegador: `https://neura-erp.vercel.app/api/webhook-test`
2. Deberías ver una respuesta JSON:
   - `ok: true` → El webhook llegó correctamente
   - `ok: false` + `error` → Revisá el mensaje de error

### Opción B: Crear un cliente

1. Creá un cliente nuevo desde **Clientes → Nuevo cliente**
2. En n8n, revisá si se ejecutó el workflow

## 4. Formato del payload

El ERP envía este JSON en cada evento:

```json
{
  "event": "cliente_creado",
  "payload": {
    "cliente_id": "uuid-del-cliente",
    "empresa": "Nombre de la empresa"
  },
  "source": "neura_erp",
  "timestamp": "2025-03-15T19:30:00.000Z"
}
```

En n8n, accedé a los datos con:
- `$json.event` → tipo de evento
- `$json.payload` → datos del evento
- `$json.payload.cliente_id` → ID del cliente

## 5. Eventos disponibles

| Evento | Cuándo se dispara |
|--------|------------------|
| `cliente_creado` | Al crear un cliente |
| `factura_creada` | Al crear una factura |
| `pago_registrado` | Al registrar un pago |
| `suscripcion_creada` | Al crear una suscripción |

## 6. Webhook para crear leads desde WhatsApp

Para crear leads automáticamente cuando llega un mensaje de WhatsApp, usá el endpoint `POST /api/crm/leads`. Ver [WHATSAPP_CRM_AUTOMATION.md](./WHATSAPP_CRM_AUTOMATION.md) para la guía completa.

Variables adicionales en Vercel:
- `WEBHOOK_SECRET` — clave para autenticar el webhook
- `CRM_WEBHOOK_EMPRESA_ID` — (opcional) UUID de la empresa que recibe los leads

## 7. Troubleshooting

| Problema | Solución |
|----------|----------|
| `WEBHOOK_URL no configurada` | Agregá la variable en Vercel y redeploy |
| `ok: false` con error HTTP 404 | La URL de n8n es incorrecta o el workflow no está activo |
| `ok: false` con error de red | Verificá que la URL de n8n sea accesible desde internet |
| n8n no recibe nada | Probá primero con [webhook.site](https://webhook.site) como WEBHOOK_URL para verificar que el ERP envía |

### Probar con webhook.site

1. Entrá a https://webhook.site
2. Copiá la URL única que te dan
3. Usá esa URL como `WEBHOOK_URL` en Vercel
4. Redeploy y creá un cliente (o visitá /api/webhook-test)
5. En webhook.site deberías ver el POST recibido
6. Si llega → el problema está en la URL de n8n
7. Si no llega → el problema está en Vercel o WEBHOOK_URL
