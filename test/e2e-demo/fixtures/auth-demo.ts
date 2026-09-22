import { randomUUID } from "node:crypto";
import { test as base, type Page } from "@playwright/test";
import { prisma } from "../../../src/lib/db";

/**
 * Auth para el proyecto Playwright de la demo (§5, docs/planes-demo-y-claridad-reportes-2026-09-21.md, tramo 5: "proyecto
 * Playwright propio con axe sobre todas las pantallas") — a diferencia de `test/e2e/fixtures/auth.ts`, esto NUNCA crea ni
 * modifica catálogo: la sucursal "La Cuadra" y el usuario admin YA existen (los sembró scripts/seed-demo-pizzeria-6-meses.ts).
 * Solo agrega una fila `Session` real (misma mecánica que la fixture de E2E: se manda como cookie `authjs.session-token`) para
 * poder navegar páginas protegidas sin pasar por Google OAuth.
 */
const NOMBRE_SUCURSAL = "La Cuadra";
const EMAIL_ADMIN = "alepogabriel@gmail.com";

async function crearSesionAdminDemo() {
  const sucursal = await prisma.sucursal.findUnique({ where: { nombre: NOMBRE_SUCURSAL } });
  if (!sucursal) {
    throw new Error(`No existe la sucursal "${NOMBRE_SUCURSAL}" — corré scripts/seed-demo-pizzeria-6-meses.ts primero (ver docs/planes-demo-y-claridad-reportes-2026-09-21.md §5).`);
  }
  const user = await prisma.user.findUnique({ where: { email: EMAIL_ADMIN } });
  if (!user) throw new Error(`No existe el usuario admin "${EMAIL_ADMIN}" en esta base.`);

  const sessionToken = randomUUID();
  await prisma.session.create({ data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 1000 * 60 * 60 * 24) } });

  return { sessionToken, sucursalId: sucursal.id };
}

interface Fixtures {
  /** Page ya con la cookie de sesión real del admin de "La Cuadra" — navegar directo a cualquier ruta protegida. */
  paginaDemo: Page;
  sucursalId: string;
}

export const test = base.extend<Fixtures>({
  sucursalId: async ({}, use) => {
    const { sucursalId } = await crearSesionAdminDemo();
    await use(sucursalId);
  },
  paginaDemo: async ({ browser, baseURL }, use) => {
    const { sessionToken } = await crearSesionAdminDemo();
    const context = await browser.newContext();
    const host = new URL(baseURL ?? "http://localhost:3102").hostname;
    await context.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: host, path: "/", httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect } from "@playwright/test";
