# Automatización: WhatsApp Business → Lead en CRM

Cuando un cliente escribe a tu número de WhatsApp Business, se crea automáticamente un lead en el CRM de Neura ERP.

## Arquitectura

```
Cliente escribe WhatsApp → Meta Cloud API → n8n (webhook) → Neura ERP API → Lead en CRM
```

## Requisitos

1. **WhatsApp Business API** (Meta Cloud API) configurado
2. **n8n** (cloud o self-hosted) para recibir el webhook de Meta y reenviar a Neura
3. **Neura ERP** desplegado en Vercel con las variables de entorno configuradas

## 1. Configurar variables en Vercel

En **Vercel → Settings → Environment Variables** agregá:

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `WEBHOOK_SECRET` | Clave secreta para autenticar webhooks (elegí una aleatoria) | `mi-clave-super-secreta-123` |
| `CRM_WEBHOOK_EMPRESA_ID` | UUID de la empresa que recibe los leads (opcional si n8n envía empresa_id) | `uuid-de-tu-empresa` |

Para obtener el `empresa_id`:
- Entrá al ERP, abrí la consola del navegador en cualquier página
- O consultá la tabla `empresas` en Supabase

## 2. Configurar n8n

### Paso 1: Workflow con Webhook de WhatsApp

1. Creá un workflow en n8n
2. Agregá el nodo **Webhook** (trigger)
3. Configurá:
   - **Path:** `whatsapp-incoming`
   - **HTTP Method:** POST
4. Guardá y **activá** el workflow
5. Copiá la **Production URL** del webhook

### Paso 2: Configurar Meta WhatsApp Cloud API

1. En [Meta for Developers](https://developers.facebook.com/) → tu app → WhatsApp → Configuration
2. En **Webhook**, configurá:
   - **Callback URL:** la URL de n8n (ej: `https://tu-n8n.com/webhook/whatsapp-incoming`)
   - **Verify token:** un token que usarás en n8n para verificación
3. Suscribite a **messages**

### Paso 3: Nodo HTTP Request en n8n

Después del nodo Webhook, agregá un nodo **HTTP Request**:

- **Method:** POST
- **URL:** `https://neura-erp.vercel.app/api/crm/leads`
- **Authentication:** None (usamos header)
- **Headers:**
  - `Content-Type`: `application/json`
  - `X-Webhook-Secret`: `{{ $env.WEBHOOK_SECRET }}` (o el valor directo)
- **Body (JSON):**

```json
{
  "empresa_id": "UUID-DE-TU-EMPRESA",
  "telefono": "{{ $json.from }}",
  "mensaje": "{{ $json.text?.body || $json.body }}",
  "contacto": "Contacto WhatsApp",
  "empresa_nombre": "Sin nombre"
}
```

**Mapeo del payload de WhatsApp Cloud API:**
- `from` → número del remitente (ej: 595981123456)
- `text.body` o `body` → contenido del mensaje

El formato exacto depende de la versión de la API de Meta. Revisá la estructura del webhook en la primera ejecución de n8n.

### Paso 4: Estructura típica del webhook de Meta

Meta envía algo como:

```json
{
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "from": "595981123456",
          "text": { "body": "Hola, quiero información" }
        }]
      }
    }]
  }
}
```

En n8n, probablemente necesites un nodo **Code** o **Set** para extraer:
- `from` del primer mensaje
- `text.body` del primer mensaje

Y luego pasar esos valores al HTTP Request.

## 3. Ejemplo de workflow n8n (simplificado)

```
[Webhook] → [Code: extraer from y mensaje] → [HTTP Request: POST /api/crm/leads]
```

**Nodo Code (JavaScript):**
```javascript
const entry = $input.first().json.entry?.[0];
const change = entry?.changes?.[0];
const value = change?.value;
const message = value?.messages?.[0];

if (!message) return [];

return [{
  json: {
    from: message.from,
    text: message.text?.body || message.body || "",
    timestamp: message.timestamp
  }
}];
```

**Nodo HTTP Request:**
- URL: `https://neura-erp.vercel.app/api/crm/leads`
- Headers: `X-Webhook-Secret: tu-clave`
- Body: 
```json
{
  "empresa_id": "tu-empresa-uuid",
  "telefono": "{{ $json.from }}",
  "mensaje": "{{ $json.text }}"
}
```

## 4. Probar

1. Enviá un mensaje de WhatsApp al número configurado
2. Verificá en n8n que se ejecutó el workflow
3. Entrá al CRM de Neura ERP → deberías ver el nuevo lead en la etapa **Lead** con `origen_creacion: whatsapp`

## 5. Evitar duplicados

Si el mismo número escribe varias veces, se crearán varios leads. Para evitar duplicados podés:

1. **En n8n:** Agregar lógica para buscar si ya existe un prospecto con ese teléfono (requeriría un endpoint GET o una base de datos en n8n)
2. **Futuro en Neura:** Agregar un endpoint que busque por teléfono y actualice/agregue nota en lugar de crear uno nuevo

Por ahora cada mensaje crea un lead nuevo.

## 6. Resumen de endpoints

| Endpoint | Método | Auth | Uso |
|----------|--------|------|-----|
| `/api/crm/leads` | POST | `X-Webhook-Secret` | Crear lead desde webhook |

**Body esperado:**
```json
{
  "empresa_id": "uuid",      // obligatorio (o CRM_WEBHOOK_EMPRESA_ID en env)
  "telefono": "595981123456", // obligatorio
  "mensaje": "Texto...",     // opcional, se guarda como primera nota
  "contacto": "Nombre",      // opcional, default "Contacto WhatsApp"
  "empresa_nombre": "Empresa" // opcional, default "Sin nombre"
}
```
