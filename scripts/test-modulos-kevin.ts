/**
 * Script para verificar que kevin.gomez@ferreteria.com ve los módulos correctos.
 * 1. Consulta la DB para obtener los módulos esperados de la empresa
 * 2. Inicia sesión con Playwright y verifica los módulos mostrados en el Sidebar
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import * as path from "path";
import { config } from "dotenv";

// Cargar .env.local
config({ path: path.join(process.cwd(), ".env.local") });

const EMAIL = "kevin.gomez@ferreteria.com";
const PASSWORD = "123456";
const BASE_URL = "http://localhost:3000";

async function getModulosEsperados() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: usuario, error: errU } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("email", EMAIL)
    .single();

  if (errU || !usuario?.empresa_id) {
    return { empresa_id: null, modulos: [], error: "Usuario no encontrado o sin empresa" };
  }

  const { data: emData, error: errEm } = await supabase
    .from("empresa_modulos")
    .select("modulo_id")
    .eq("empresa_id", usuario.empresa_id)
    .eq("activo", true);

  if (errEm) return { empresa_id: usuario.empresa_id, modulos: [], error: errEm.message };

  const moduloIds = (emData ?? []).map((r) => r.modulo_id).filter(Boolean);
  if (moduloIds.length === 0) return { empresa_id: usuario.empresa_id, modulos: [], error: null };

  const { data: modulos, error: errM } = await supabase
    .from("modulos")
    .select("id, nombre, slug")
    .in("id", moduloIds);

  if (errM) return { empresa_id: usuario.empresa_id, modulos: [], error: errM.message };

  return {
    empresa_id: usuario.empresa_id,
    modulos: (modulos ?? []).map((m) => ({ id: m.id, nombre: m.nombre ?? "", slug: m.slug ?? "" })),
    error: null,
  };
}

async function testConPlaywright() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
    // Limpiar localStorage por si había sesión antigua (antes usaba localStorage)
    await page.evaluate(() => localStorage.clear());
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(?!login)/, { timeout: 10000 });
    await page.waitForTimeout(2000); // Dar tiempo a onAuthStateChange y carga de módulos

    await page.waitForSelector('aside nav a[href="/clientes"]', { timeout: 5000 }).catch(() => null);

    const linksModulos = await page.$$eval('aside nav a', (links) =>
      links.map((a) => ({
        href: a.getAttribute("href"),
        text: a.textContent?.trim() ?? "",
      }))
    );

    // Excluir Dashboard (href="/"), Admin Empresas, y quedarnos con los módulos
    const modulosMostrados = linksModulos.filter(
      (l) => l.href !== "/" && !l.text?.includes("Admin Empresas") && l.href && l.href !== "/"
    );

    return modulosMostrados;
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log("=== Verificación de módulos para kevin.gomez@ferreteria.com ===\n");

  const esperados = await getModulosEsperados();
  if (esperados.error) {
    console.log("Error al obtener módulos esperados:", esperados.error);
    process.exit(1);
  }

  console.log("Módulos en DB (empresa_modulos + modulos):");
  if (esperados.modulos.length === 0) {
    console.log("  (ninguno)");
  } else {
    esperados.modulos.forEach((m) => console.log(`  - ${m.nombre} (/${m.slug})`));
  }
  console.log("");

  console.log("Iniciando sesión con Playwright y leyendo Sidebar...");
  const mostrados = await testConPlaywright();
  console.log("Módulos mostrados en el Sidebar:");
  if (mostrados.length === 0) {
    console.log("  (ninguno)");
  } else {
    mostrados.forEach((m) => console.log(`  - ${m.text} (${m.href})`));
  }
  console.log("");

  const nombresEsperados = new Set(esperados.modulos.map((m) => m.nombre));
  const nombresMostrados = new Set(mostrados.map((m) => m.text));

  const faltan = [...nombresEsperados].filter((n) => !nombresMostrados.has(n));
  const sobran = [...nombresMostrados].filter((n) => !nombresEsperados.has(n));

  if (faltan.length === 0 && sobran.length === 0 && esperados.modulos.length === mostrados.length) {
    console.log("✓ COINCIDE: Los módulos mostrados coinciden con los configurados en la empresa.");
  } else {
    if (faltan.length) console.log("✗ Faltan en el Sidebar:", faltan.join(", "));
    if (sobran.length) console.log("✗ Sobran en el Sidebar (no configurados):", sobran.join(", "));
    console.log("\n✗ NO COINCIDE.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
