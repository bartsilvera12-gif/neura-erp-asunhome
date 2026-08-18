/**
 * Prueba E2E: "Emitir factura inicial" al crear cliente CONTADO
 *
 * Flujo:
 * 1. Login
 * 2. Ir a /clientes/nuevo
 * 3. Llenar formulario: Condición CONTADO, marcar "Emitir factura inicial", monto
 * 4. Enviar formulario
 * 5. Verificar redirect a /clientes/[id]
 * 6. Verificar factura en DB (Supabase)
 * 7. Verificar factura visible en página del cliente (Estado de cuenta)
 *
 * Ejecutar: npx tsx scripts/test-emitir-factura-inicial.ts
 * Requiere: npm run dev + .env.local con credenciales
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import { config } from "dotenv";

config({ path: path.join(process.cwd(), ".env.local") });

const EMAIL = process.env.TEST_EMAIL ?? "kevin.gomez@ferreteria.com";
const PASSWORD = process.env.TEST_PASSWORD ?? "123456";
const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";

const CLIENTE_NOMBRE = `Test Factura ${Date.now()}`;
const MONTO_FACTURA = 150000;

async function verificarFacturaEnDb(clienteId: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data } = await supabase
    .from("facturas")
    .select("id")
    .eq("cliente_id", clienteId)
    .eq("monto", MONTO_FACTURA)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function main() {
  console.log("=== Prueba: Emitir factura inicial al crear cliente CONTADO ===\n");
  console.log(`URL: ${BASE_URL}`);
  console.log(`Email: ${EMAIL}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 1. Login
    console.log("1. Iniciando sesión...");
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(?!login)/, { timeout: 15000 });
    await page.waitForTimeout(2000);
    console.log("   ✓ Sesión iniciada\n");

    // 2. Ir a nuevo cliente
    console.log("2. Navegando a /clientes/nuevo...");
    await page.goto(`${BASE_URL}/clientes/nuevo`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    console.log("   ✓ Página cargada\n");

    // 3. Llenar formulario
    console.log("3. Llenando formulario...");
    await page.selectOption('select[name="condicion_pago"]', "CONTADO");
    await page.waitForTimeout(300);

    await page.check('input#emitir_contado');
    await page.waitForTimeout(200);

    await page.fill('input[name="nombre_contacto"]', CLIENTE_NOMBRE);
    await page.fill('input[name="empresa"]', "Empresa Test Factura");
    const montoInput = page.locator('input[placeholder="Monto de la factura"]');
    await montoInput.fill(String(MONTO_FACTURA));
    console.log("   ✓ Formulario llenado (CONTADO, emitir factura, monto)\n");

    // 4. Enviar
    console.log("4. Enviando formulario...");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/clientes\/[a-f0-9-]+/, { timeout: 15000 });
    const url = page.url();
    const clienteId = url.match(/\/clientes\/([a-f0-9-]+)/)?.[1];
    if (!clienteId) {
      throw new Error("No se redirigió a la página del cliente");
    }
    console.log(`   ✓ Cliente creado: ${clienteId}\n`);

    // 5. Verificar factura en DB
    console.log("5. Verificando factura en base de datos...");
    await page.waitForTimeout(1500);
    const existeEnDb = await verificarFacturaEnDb(clienteId);
    if (existeEnDb) {
      console.log("   ✓ Factura creada en tabla facturas\n");
    } else {
      throw new Error("La factura NO se creó en la base de datos. Revisar flujo apiCreateFactura + factura_items.");
    }

    // 6. Verificar en página del cliente (Estado de cuenta)
    console.log("6. Verificando factura en Estado de cuenta del cliente...");
    await page.goto(`${BASE_URL}/clientes/${clienteId}`, { waitUntil: "networkidle" });
    await page.click('button:has-text("Estado de cuenta")');
    await page.waitForTimeout(800);

    const montoFormateado = MONTO_FACTURA.toLocaleString("es-PY");
    const facturaEnCliente = await page.locator("table tbody").filter({ hasText: montoFormateado }).count() > 0;
    if (facturaEnCliente) {
      console.log("   ✓ Factura visible en Estado de cuenta\n");
    } else {
      throw new Error("La factura no aparece en Estado de cuenta. Los módulos que consumen facturas podrían no estar mostrándola.");
    }

    console.log("=== ✓ Prueba exitosa ===\n");
    console.log("El botón 'Emitir factura inicial' funciona correctamente.");
    console.log("La factura se crea y aparece en los módulos que consumen facturas.");
  } catch (err) {
    console.error("\n✗ Error:", err instanceof Error ? err.message : err);
    const screenshot = path.join(process.cwd(), "test-emitir-factura-error.png");
    await page.screenshot({ path: screenshot }).catch(() => null);
    console.log(`Screenshot: ${screenshot}`);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
