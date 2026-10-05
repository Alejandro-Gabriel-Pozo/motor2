import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { INSTALACION_A, INSTALACION_B, ingresarALaConsola, leerDeLaBase, leerDeLaBaseB } from "./fixtures/consola";

/**
 * UNA consola, DOS instalaciones (ADR-025), en un navegador real: el inicio con una tarjeta por instalación (una «caída» no rompe a las demás), el selector, el alta en la segunda base, y el caso
 * peligroso: dos empresas con el MISMO id en las dos bases, operadas desde dos pestañas, sin mezclarse. Se omite sin segunda base (en CI corre).
 */
const CONSOLA = process.env.MOTOR2_E2E_URL_PLATAFORMA;
test.skip(!CONSOLA || !process.env.MOTOR2_E2E_INSTALACION_B, "sin MOTOR2_E2E_B_DATABASE_URL (segunda base) no hay dos instalaciones que probar");
test.describe.configure({ mode: "serial" });

const GEMELA = "gemela-e2e";
const rutaA = (resto = "") => `${CONSOLA}/instalaciones/${INSTALACION_A}${resto}`;
const rutaB = (resto = "") => `${CONSOLA}/instalaciones/${INSTALACION_B}${resto}`;

async function sinViolaciones(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

const datosDeLaEmpresa = (nombre: string) => ({ id: GEMELA, nombre, slug: GEMELA, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" as const });

test.beforeAll(async () => {
  // La MISMA empresa (mismo id) en las dos bases, con nombres distintos: lo que haría peligroso confiar en un estado «ambiental».
  // Idempotente: con `retries` de CI el `beforeAll` corre otra vez y la empresa ya existe.
  await leerDeLaBase(async (db) => {
    await db.empresa.deleteMany({ where: { id: GEMELA } });
    await db.empresa.create({ data: datosDeLaEmpresa("Gemela de A") });
  });
  await leerDeLaBaseB(async (db) => {
    await db.empresa.deleteMany({ where: { id: GEMELA } });
    await db.empresa.create({ data: datosDeLaEmpresa("Gemela de B") });
  });
});

test("el inicio muestra una tarjeta por instalación y la caída solo rompe la suya", async ({ page }) => {
  await ingresarALaConsola(page, CONSOLA!);
  await expect(page.getByRole("link", { name: "Empresas de E2E A" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Empresas de E2E B" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Empresas de E2E caída" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "No pudimos leer E2E caída" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "No pudimos leer E2E A" })).toHaveCount(0);
  await sinViolaciones(page);
});

test("el selector marca la instalación actual y lleva a la otra con SUS empresas", async ({ page }) => {
  await ingresarALaConsola(page, CONSOLA!);
  await page.goto(rutaA("/empresas"));
  const selector = page.getByRole("navigation", { name: "Instalaciones" });
  await expect(selector.getByRole("link", { name: "E2E A" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Ver Gemela de A" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver Gemela de B" })).toHaveCount(0);
  await sinViolaciones(page);

  await selector.getByRole("link", { name: "E2E B" }).click();
  await expect(page).toHaveURL(rutaB("/empresas"));
  await expect(page.getByRole("heading", { name: /Empresas · E2E B/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver Gemela de B" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver Gemela de A" })).toHaveCount(0);
  await sinViolaciones(page);
});

test("dar de alta una empresa en B la crea SOLO en B, con su auditoría en B (con la instalación) y el ingreso solo en A", async ({ page }) => {
  const admin = await ingresarALaConsola(page, CONSOLA!);
  const marca = `${Date.now()}`;
  const slug = `alta-en-b-${marca}`;
  await page.goto(rutaB("/empresas/nueva"));
  await page.getByLabel("Nombre", { exact: true }).fill(`Alta en B ${marca}`);
  await page.getByLabel("Identificador (slug)").fill(slug);
  await page.getByLabel("Email del dueño (será el gerente)").fill(`dueno-b-${marca}@local.test`);
  await page.getByRole("button", { name: "Dar de alta" }).click();
  await expect(page).toHaveURL(new RegExp(`${CONSOLA}/instalaciones/${INSTALACION_B}/empresas/(?!nueva)[^/]+$`));

  const enB = await leerDeLaBaseB((db) => db.empresa.findUnique({ where: { slug }, select: { id: true } }));
  expect(enB, "la empresa en B").not.toBeNull();
  expect(await leerDeLaBase((db) => db.empresa.findUnique({ where: { slug } })), "la empresa NO existe en A").toBeNull();

  const auditoriaB = await leerDeLaBaseB((db) => db.auditoriaPlataforma.findMany({ where: { empresaAfectadaId: enB!.id }, select: { accion: true, adminEmail: true, detalle: true } }));
  expect(auditoriaB).toMatchObject([{ accion: "alta-de-empresa", adminEmail: admin.email, detalle: { instalacion: INSTALACION_B } }]);
  expect(await leerDeLaBase((db) => db.auditoriaPlataforma.count({ where: { empresaAfectadaId: enB!.id } }))).toBe(0);
  // La identidad (el ingreso) vive en la principal: en B no hay ninguna fila de ingreso.
  expect(await leerDeLaBaseB((db) => db.auditoriaPlataforma.count({ where: { accion: "ingreso" } }))).toBe(0);
  expect(await leerDeLaBase((db) => db.auditoriaPlataforma.count({ where: { accion: "ingreso", adminEmail: admin.email } }))).toBeGreaterThan(0);
});

test("dos empresas con el MISMO id en las dos bases: cada ruta muestra y opera la suya, aunque la otra pestaña siga abierta", async ({ browser }) => {
  // Mutación: que `contextoDeAccion` ignore el id de la instalación y use la principal pone este test en rojo.
  const contexto = await browser.newContext();
  const pestanaA = await contexto.newPage();
  await ingresarALaConsola(pestanaA, CONSOLA!);
  const pestanaB = await contexto.newPage();

  await pestanaA.goto(rutaA(`/empresas/${GEMELA}`));
  await pestanaB.goto(rutaB(`/empresas/${GEMELA}`));
  await expect(pestanaA.getByRole("heading", { name: "Gemela de A" })).toBeVisible();
  await expect(pestanaB.getByRole("heading", { name: "Gemela de B" })).toBeVisible();

  // Se suspende desde la pestaña A (la pestaña B sigue abierta y desactualizada): cambia solo la de A.
  await pestanaA.locator("#motivo-suspender").fill("Prueba de dos instalaciones");
  await pestanaA.getByRole("button", { name: "Suspender la empresa" }).click();
  await pestanaA.getByRole("button", { name: /^Sí: suspender la empresa/ }).click();
  await expect(pestanaA.getByText(/quedó suspendida/)).toBeVisible();
  expect((await leerDeLaBase((db) => db.empresa.findUniqueOrThrow({ where: { id: GEMELA } }))).estado).toBe("SUSPENDED");
  expect((await leerDeLaBaseB((db) => db.empresa.findUniqueOrThrow({ where: { id: GEMELA } }))).estado, "la de B no se toca").toBe("ACTIVE");

  // Y ahora desde la pestaña B: cambia solo la de B, que la de A ya estaba suspendida.
  await pestanaB.reload();
  await pestanaB.locator("#motivo-suspender").fill("Prueba de dos instalaciones");
  await pestanaB.getByRole("button", { name: "Suspender la empresa" }).click();
  await pestanaB.getByRole("button", { name: /^Sí: suspender la empresa/ }).click();
  await expect(pestanaB.getByText(/quedó suspendida/)).toBeVisible();
  expect((await leerDeLaBaseB((db) => db.empresa.findUniqueOrThrow({ where: { id: GEMELA } }))).estado).toBe("SUSPENDED");

  const auditoriaA = await leerDeLaBase((db) => db.auditoriaPlataforma.findMany({ where: { empresaAfectadaId: GEMELA }, select: { detalle: true } }));
  const auditoriaB = await leerDeLaBaseB((db) => db.auditoriaPlataforma.findMany({ where: { empresaAfectadaId: GEMELA }, select: { detalle: true } }));
  expect(auditoriaA).toMatchObject([{ detalle: { instalacion: INSTALACION_A } }]);
  expect(auditoriaB).toMatchObject([{ detalle: { instalacion: INSTALACION_B } }]);
  await contexto.close();
});

test("una instalación desconocida es un 404 (nunca cae en la principal) y sin sesión se pide el ingreso", async ({ page, browser }) => {
  await ingresarALaConsola(page, CONSOLA!);
  const respuesta = await page.goto(`${CONSOLA}/instalaciones/noexiste/empresas`);
  expect(respuesta?.status()).toBe(404);
  expect((await page.goto(`${CONSOLA}/instalaciones/noexiste/empresas/${GEMELA}`))?.status()).toBe(404);

  const anonimo = await (await browser.newContext()).newPage();
  await anonimo.goto(rutaB("/empresas"));
  await expect(anonimo).toHaveURL(`${CONSOLA}/login`);
  await anonimo.goto(`${CONSOLA}/instalaciones/noexiste/empresas`);
  await expect(anonimo, "ni siquiera revela si existe").toHaveURL(`${CONSOLA}/login`);
  await anonimo.context().close();
});

test("una instalación caída muestra su pantalla de error con «Reintentar», sin tumbar la consola", async ({ page }) => {
  await ingresarALaConsola(page, CONSOLA!);
  await page.goto(`${CONSOLA}/instalaciones/caida/empresas`);
  await expect(page.getByRole("heading", { name: "No pudimos conectar con esta instalación" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Volver al inicio" })).toBeVisible();
  await expect(page.getByText(/ECONNREFUSED|127\.0\.0\.1/)).toHaveCount(0);
  await sinViolaciones(page);

  await page.goto(rutaA("/empresas"));
  await expect(page.getByRole("heading", { name: /Empresas · E2E A/ })).toBeVisible();
});
