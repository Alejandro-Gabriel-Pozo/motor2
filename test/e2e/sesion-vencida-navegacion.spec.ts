import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * Pureza 0.8 (hallazgo H9 de la auditoría): con la sesión vencida, navegar con un ENLACE (navegación del lado del cliente) lleva al login y no
 * deja la pantalla en blanco. En una navegación así el layout no se vuelve a dibujar (guía «Layouts and auth checks» de Next): la que decide es
 * la página, que antes devolvía `null` (blanco, sin explicación) y ahora manda al login recordando la pantalla (`irAlLogin`).
 * Complementa a `volver-tras-login.spec.ts` (que cubre el envío de un formulario) y a `lecturas-sesion-vencida.spec.ts` (las lecturas).
 */
test("con la sesión vencida, un enlace del menú lleva al login recordando la pantalla (no queda en blanco)", async ({ paginaAutenticada: page }) => {
  await page.goto("/inicio");
  const enlace = page.locator('main a[href^="/"]').first();
  await expect(enlace).toBeVisible();
  const destino = await enlace.getAttribute("href");
  expect(destino, "la pantalla de inicio tiene que ofrecer algún enlace interno").toBeTruthy();

  // La sesión vence con la pestaña abierta: se borran las sesiones del usuario de prueba. El navegador conserva la cookie.
  await prisma.session.deleteMany({ where: { user: { email: "e2e-admin@local.test" } } });
  await enlace.click();

  await page.waitForURL(/\/login\?volver=/);
  expect(new URL(page.url()).searchParams.get("volver")).toBe(destino);
  await expect(page.getByRole("button", { name: "Ingresar con Google" })).toBeVisible();
});
