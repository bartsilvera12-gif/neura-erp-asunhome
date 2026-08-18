/**
 * Verifica en el deploy que el super admin ve los módulos en el sidebar.
 *
 * Uso (PowerShell):
 *   $env:E2E_BASE_URL="https://neura-erp.vercel.app"
 *   $env:E2E_SUPER_ADMIN_EMAIL="neurautomations@gmail.com"
 *   $env:E2E_SUPER_ADMIN_PASSWORD="***"
 *   npx tsx scripts/e2e-super-admin-modulos.ts
 */
import { chromium } from "playwright";

const BASE = (process.env.E2E_BASE_URL ?? "https://neura-erp.vercel.app").replace(/\/$/, "");
const EMAIL = process.env.E2E_SUPER_ADMIN_EMAIL ?? "";
const PASSWORD = process.env.E2E_SUPER_ADMIN_PASSWORD ?? "";

const MUST_SEE_IN_SIDEBAR = [
  "Dashboard",
  "Clientes",
  "Ventas",
  "Inventario",
  "Configuración",
  "Admin Empresas",
];

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error("Definí E2E_SUPER_ADMIN_EMAIL y E2E_SUPER_ADMIN_PASSWORD");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60_000 });

    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();

    await page.waitForURL(
      (u) => !u.pathname.includes("/login"),
      { timeout: 45_000 }
    );

    await page.waitForSelector("#neura-sidebar", { timeout: 60_000 });

    await page.getByText("Cargando…").waitFor({ state: "hidden", timeout: 60_000 }).catch(() => {});

    const sidebar = page.locator("#neura-sidebar");
    const missing: string[] = [];

    for (const label of MUST_SEE_IN_SIDEBAR) {
      const link = sidebar.getByRole("link", { name: label, exact: true });
      const count = await link.count();
      if (count === 0) {
        const any = sidebar.getByText(label, { exact: true });
        if ((await any.count()) === 0) missing.push(label);
      }
    }

    if (missing.length > 0) {
      console.error("Faltan en el sidebar:", missing.join(", "));
      const shot = "e2e-super-admin-sidebar-fail.png";
      await page.screenshot({ path: shot, fullPage: true });
      console.error("Screenshot:", shot);
      process.exit(1);
    }

    console.log("OK: super admin ve en sidebar:", MUST_SEE_IN_SIDEBAR.join(", "));
    process.exit(0);
  } catch (e) {
    console.error(e);
    await page.screenshot({ path: "e2e-super-admin-error.png", fullPage: true }).catch(() => {});
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
