import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { codigoTotp, pasoDeTotp } from "../../src/core/plataforma/totp";
import { fijarCodigoDeIngreso, leerDeLaBase, sembrarAdminDePlataforma, type AdminSembrado } from "./fixtures/consola";

/**
 * La consola de plataforma (E4, ADR-012 §2, ADR-019) en un navegador real, contra su propio servidor (`plataforma/`, otro puerto) y con SU conexión (rol
 * `motor2_plataforma`). Se omite si esa conexión no está configurada (ver `playwright.config.ts`: el rol solo existe en CI o donde el dueño lo creó).
 *
 * El código del mail solo viaja por mail y el spec no puede leerlo desde otro proceso: después de que la consola lo genera, el spec lo reemplaza en la base por
 * uno conocido, firmado igual que lo firma la consola. El segundo factor es real: el spec calcula el TOTP con el secreto que sembró.
 */
const CONSOLA = process.env.MOTOR2_E2E_URL_PLATAFORMA;
test.skip(!CONSOLA, "sin MOTOR2_E2E_PLATAFORMA_DATABASE_URL no hay consola que probar");

const CODIGO_CONOCIDO = "482915";

async function sembrar(): Promise<AdminSembrado> {
  return sembrarAdminDePlataforma(`admin-${Date.now()}-${Math.floor(Math.random() * 1e6)}@plataforma.test`);
}

/** Paso 1: email → pantalla del código, con el código del mail ya reemplazado por el conocido. */
async function pedirElCodigo(page: Page, admin: AdminSembrado) {
  await page.goto(`${CONSOLA}/login`);
  await page.locator("#email").fill(admin.email);
  await page.getByRole("button", { name: "Pedir código" }).click();
  await expect(page.locator("#codigo")).toBeVisible();
  expect(await fijarCodigoDeIngreso(page, admin.id, CODIGO_CONOCIDO)).toBe(1);
}

/** Pasos 1 y 2 hasta la pantalla del segundo factor. */
async function llegarAlSegundoFactor(page: Page, admin: AdminSembrado) {
  await pedirElCodigo(page, admin);
  await page.locator("#codigo").fill(CODIGO_CONOCIDO);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.locator("#factor")).toBeVisible();
}

const totpActual = (admin: AdminSembrado) => codigoTotp(admin.secretoTotp, pasoDeTotp(Date.now()));

test("ingreso completo: email, código del mail y TOTP; entra, queda auditado, cierra sesión y ya no entra sin volver a empezar", async ({ page }) => {
  const admin = await sembrar();
  const avisosDeCsp: string[] = [];
  page.on("console", (m) => {
    if (/content security policy/i.test(m.text())) avisosDeCsp.push(m.text());
  });

  await llegarAlSegundoFactor(page, admin);
  await page.locator("#factor").fill(totpActual(admin));
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page).toHaveURL(`${CONSOLA}/`);
  await expect(page.getByRole("heading", { level: 1, name: "Consola de plataforma" })).toBeVisible();
  await expect(page.getByText(`Sesión de ${admin.email}.`)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // La cookie es la propia de la consola: httpOnly y SameSite=Strict (sin https en el E2E no lleva el prefijo __Host-).
  const cookie = (await page.context().cookies()).find((c) => c.name === "plataforma.sesion");
  expect(cookie, "cookie de sesión de la consola").toBeDefined();
  expect(cookie!.httpOnly).toBe(true);
  expect(cookie!.sameSite).toBe("Strict");

  // En la base: una sesión vigente (con segundo factor) y SOLO el hash del token; el ingreso quedó auditado con el administrador como autor.
  const sesiones = await leerDeLaBase((db) => db.sesionPlataforma.findMany({ where: { adminId: admin.id } }));
  expect(sesiones).toHaveLength(1);
  expect(sesiones[0].segundoFactorEn).not.toBeNull();
  expect(sesiones[0].hashToken).not.toContain(cookie!.value);
  const auditoria = await leerDeLaBase((db) => db.auditoriaPlataforma.findMany({ where: { adminId: admin.id }, orderBy: { creadoEn: "asc" } }));
  expect(auditoria.map((a) => a.accion)).toEqual(["ingreso"]);
  expect(auditoria[0].adminEmail).toBe(admin.email);

  // Recargar mantiene la sesión; cerrarla la cierra de verdad (en la base, no solo en el navegador).
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Consola de plataforma" })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(`${CONSOLA}/login`);
  const despues = await leerDeLaBase((db) => db.sesionPlataforma.findMany({ where: { adminId: admin.id } }));
  expect(despues[0].cerradaEn).not.toBeNull();
  await page.context().addCookies([{ name: "plataforma.sesion", value: cookie!.value, url: CONSOLA!, httpOnly: true, sameSite: "Strict" }]);
  await page.goto(`${CONSOLA}/`);
  await expect(page).toHaveURL(`${CONSOLA}/login`);
  const acciones = await leerDeLaBase((db) => db.auditoriaPlataforma.findMany({ where: { adminId: admin.id }, orderBy: { creadoEn: "asc" } }));
  expect(acciones.map((a) => a.accion)).toEqual(["ingreso", "cierre-de-sesion"]);

  expect(avisosDeCsp, "la CSP de la consola no tiene que bloquear nada de su propio login").toEqual([]);
});

test("un código del mail equivocado y un TOTP equivocado no entran; un código de recuperación sí, y sirve una sola vez", async ({ page }) => {
  const admin = await sembrar();
  await pedirElCodigo(page, admin);

  await page.locator("#codigo").fill("000000");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveText("El código no es válido o venció. Pedí uno nuevo.");
  await expect(page.locator("#factor")).toHaveCount(0);

  await page.locator("#codigo").fill(CODIGO_CONOCIDO);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.locator("#factor")).toBeVisible();

  const valido = totpActual(admin);
  const equivocado = valido.slice(0, 5) + ((Number(valido[5]) + 1) % 10);
  await page.locator("#factor").fill(equivocado);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveText("El código no es válido.");
  await expect(page).toHaveURL(`${CONSOLA}/login`);

  await page.locator("#factor").fill(admin.codigosDeRecuperacion[0]);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(`${CONSOLA}/`);
  const fallos = await leerDeLaBase((db) => db.auditoriaPlataforma.findMany({ where: { adminId: admin.id, accion: "segundo-factor-fallido" } }));
  expect(fallos).toHaveLength(1);

  // El mismo código de recuperación no vuelve a servir.
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await llegarAlSegundoFactor(page, admin);
  await page.locator("#factor").fill(admin.codigosDeRecuperacion[0]);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveText("El código no es válido.");
});

test("un email que no es de un administrador ve exactamente la misma pantalla, y no puede entrar", async ({ page }) => {
  await page.goto(`${CONSOLA}/login`);
  await page.locator("#email").fill("nadie@plataforma.test");
  await page.getByRole("button", { name: "Pedir código" }).click();
  await expect(page.locator("#codigo")).toBeVisible();
  await expect(page.getByText("Si el email corresponde a un administrador, te mandamos un código de 6 dígitos.")).toBeVisible();
  await page.locator("#codigo").fill(CODIGO_CONOCIDO);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveText("El código no es válido o venció. Pedí uno nuevo.");
  await expect(page.locator("#factor")).toHaveCount(0);
});

test("accesibilidad: cada paso del ingreso no tiene violaciones de axe", async ({ page }) => {
  const admin = await sembrar();
  await page.goto(`${CONSOLA}/login`);
  expect((await new AxeBuilder({ page }).analyze()).violations, "paso del email").toEqual([]);
  await pedirElCodigo(page, admin);
  expect((await new AxeBuilder({ page }).analyze()).violations, "paso del código").toEqual([]);
  await page.locator("#codigo").fill("000000");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations, "paso del código, con el error").toEqual([]);
  await page.locator("#codigo").fill(CODIGO_CONOCIDO);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.locator("#factor")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations, "paso del segundo factor").toEqual([]);
});

test("sin sesión, la página principal manda al ingreso", async ({ page }) => {
  await page.goto(`${CONSOLA}/`);
  await expect(page).toHaveURL(`${CONSOLA}/login`);
  await expect(page.locator("#email")).toBeVisible();
});
