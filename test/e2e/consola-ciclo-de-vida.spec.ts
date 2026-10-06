import { expect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { generarTokenOpaco, hashDeToken } from "../../src/core/seguridad/tokens";
import { ingresarALaConsola, leerDeLaBase } from "./fixtures/consola";
import { crearUsuarioSinEmpresa, sembrarInvitacion } from "./fixtures/invitacion";
import { paginaConSesion } from "./fixtures/multiempresa";

/**
 * Confirmar el alta, corregir el CUIT, suspender y reactivar (E6, ADR-021) en un navegador real, de punta a punta: la consola da de alta, el gerente acepta en la app,
 * la consola confirma, y el cambio de estado se ve del lado del gerente. Se omite sin la conexión del rol `motor2_plataforma` (ver `consola-plataforma.spec.ts`).
 *
 * Cada empresa que se confirma queda ACTIVE; la suite supone UNA sola empresa activa, así que `afterAll` suspende con la conexión del dueño todo lo que este spec activó.
 */
const CONSOLA = process.env.MOTOR2_E2E_URL_PLATAFORMA;
test.skip(!CONSOLA, "sin MOTOR2_E2E_PLATAFORMA_DATABASE_URL no hay consola que probar");
test.describe.configure({ mode: "serial" });

// Un CUIT PROPIO de este spec: las empresas que confirma quedan ACTIVE con él (aunque después se suspendan) y otro spec que declare el mismo CUIT sería rechazado.
const CUIT = "30-70308853-4";
const CUIT_CORREGIDO = "20-12345678-6";
const marca = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const empresasActivadas: string[] = [];

test.afterAll(async () => {
  if (empresasActivadas.length === 0) return;
  await leerDeLaBase((db) => db.empresa.updateMany({ where: { id: { in: empresasActivadas }, estado: "ACTIVE" }, data: { estado: "SUSPENDED" } }));
});

async function sinViolaciones(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

/** El gerente abre el enlace en la app con su sesión, revisa el CUIT y acepta. */
async function aceptarComoGerente(browser: Browser, baseURL: string | undefined, inv: { email: string; token: string }, cuit: string) {
  const invitado = await crearUsuarioSinEmpresa(inv.email);
  const app = await paginaConSesion(browser, baseURL, invitado.sessionToken);
  await app.goto(`/invitacion#t=${inv.token}`);
  await app.getByLabel("CUIT de la empresa").fill(cuit);
  await app.getByRole("button", { name: "Revisar el CUIT" }).click();
  await app.getByLabel("Verifiqué que el CUIT y los datos de la empresa son correctos.").check();
  await app.getByRole("button", { name: "Confirmar y aceptar" }).click();
  await expect(app.getByText("está en alta.")).toBeVisible();
  return app;
}

async function confirmarEnLaConsola(page: Page, empresaId: string) {
  await page.goto(`${CONSOLA}/instalaciones/e2ea/empresas/${empresaId}`);
  await page.getByLabel("Revisé el CUIT contra la constancia de ARCA").check();
  await page.getByRole("button", { name: "Confirmar el alta" }).click();
  await page.getByRole("button", { name: /^Sí: confirmar el alta/ }).click();
}

test("recorrido completo: alta, aceptación, confirmación, corrección del CUIT, suspensión y reactivación", async ({ page, browser, baseURL }) => {
  const admin = await ingresarALaConsola(page, CONSOLA!);
  const m = marca();
  const datos = { nombre: `E2E Ciclo ${m}`, slug: `e2e-ciclo-${m}`, email: `gerente-ciclo-${m}@local.test` };

  // Alta desde la consola (formulario de E5).
  await page.goto(`${CONSOLA}/instalaciones/e2ea/empresas/nueva`);
  await page.getByLabel("Nombre", { exact: true }).fill(datos.nombre);
  await page.getByLabel("Identificador (slug)").fill(datos.slug);
  await page.getByLabel("Email del dueño (será el gerente)").fill(datos.email);
  await page.getByRole("button", { name: "Dar de alta" }).click();
  await expect(page).toHaveURL(new RegExp(`${CONSOLA}/instalaciones/e2ea/empresas/(?!nueva)[^/]+$`));
  const empresaId = page.url().split("/").at(-1)!;
  empresasActivadas.push(empresaId);

  // El token real viaja por mail: se lo reemplaza por uno conocido y el gerente acepta en la app.
  const token = generarTokenOpaco();
  expect((await leerDeLaBase((db) => db.invitacion.updateMany({ where: { empresaId }, data: { hashToken: hashDeToken(token) } }))).count, "el detalle de una empresa recién dada de alta").toBe(1);
  const app = await aceptarComoGerente(browser, baseURL, { email: datos.email, token }, CUIT);

  // La consola la ve en «CUIT pendiente» y en el inicio.
  await page.goto(`${CONSOLA}/`);
  await expect(page.getByText(/espera[n]? que confirmes su CUIT/)).toBeVisible();
  await page.goto(`${CONSOLA}/instalaciones/e2ea/empresas?filtro=cuit-pendiente`);
  await expect(page.getByRole("link", { name: "CUIT pendiente" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: `Ver ${datos.nombre}` })).toBeVisible();
  await sinViolaciones(page);

  // Detalle: no se puede confirmar sin tildar la revisión; con el aviso de confirmación abierto, también sin violaciones de axe.
  await page.goto(`${CONSOLA}/instalaciones/e2ea/empresas/${empresaId}`);
  await expect(page.getByRole("button", { name: "Confirmar el alta" })).toBeDisabled();
  await sinViolaciones(page);
  await page.getByLabel("Revisé el CUIT contra la constancia de ARCA").check();
  await page.getByRole("button", { name: "Confirmar el alta" }).click();
  await expect(page.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await sinViolaciones(page);
  await page.getByRole("button", { name: /^Sí: confirmar el alta/ }).click();
  await expect(page.getByText(/quedó activa con el CUIT 30-70308853-4/)).toBeVisible();

  const activa = await leerDeLaBase((db) => db.empresa.findUniqueOrThrow({ where: { id: empresaId } }));
  expect(activa).toMatchObject({ estado: "ACTIVE", cuit: "30703088534" });
  const acciones = await leerDeLaBase((db) => db.auditoriaPlataforma.findMany({ where: { empresaAfectadaId: empresaId, adminId: admin.id }, orderBy: { creadoEn: "asc" } }));
  expect(acciones.map((a) => a.accion)).toEqual(["alta-de-empresa", "empresa-confirmada", "aviso-de-activacion"]);

  // Del lado del gerente: ya no está «en alta».
  await app.goto("/login");
  await expect(app.getByText("está en alta.")).toHaveCount(0);

  // Corregir el CUIT: pide motivo y confirmación, y queda en el historial.
  await page.goto(`${CONSOLA}/instalaciones/e2ea/empresas/${empresaId}`);
  await sinViolaciones(page);
  await page.getByLabel("CUIT nuevo").fill(CUIT_CORREGIDO);
  await page.locator("#motivo-cuit").fill("Constancia de ARCA");
  await page.getByRole("button", { name: "Guardar el CUIT" }).click();
  await page.getByRole("button", { name: /^Sí: guardar el CUIT/ }).click();
  await expect(page.getByText(/CUIT corregido: 20-12345678-6/)).toBeVisible();
  expect((await leerDeLaBase((db) => db.empresa.findUniqueOrThrow({ where: { id: empresaId } }))).cuit).toBe("20123456786");

  // Suspender: el gerente ve que su empresa está suspendida y a quién escribir.
  await page.goto(`${CONSOLA}/instalaciones/e2ea/empresas/${empresaId}`);
  await page.locator("#motivo-suspender").fill("Prueba de suspensión");
  await page.getByRole("button", { name: "Suspender la empresa" }).click();
  await page.getByRole("button", { name: /^Sí: suspender la empresa/ }).click();
  await expect(page.getByText(/quedó suspendida/)).toBeVisible();
  await app.goto("/login");
  await expect(app.getByText(`La empresa «${datos.nombre}» está suspendida.`)).toBeVisible();
  await expect(app.getByRole("link", { name: "plataforma@local.test" })).toBeVisible();
  expect((await new AxeBuilder({ page: app }).analyze()).violations).toEqual([]);

  // Reactivar: el gerente vuelve a entrar.
  await page.goto(`${CONSOLA}/instalaciones/e2ea/empresas/${empresaId}`);
  await page.getByRole("button", { name: "Reactivar la empresa" }).click();
  await page.getByRole("button", { name: /^Sí: reactivar la empresa/ }).click();
  await expect(page.getByText(/quedó activa de nuevo/)).toBeVisible();
  await app.goto("/login");
  await expect(app.getByText("está suspendida.")).toHaveCount(0);

  // El historial lo cuenta todo.
  await page.goto(`${CONSOLA}/instalaciones/e2ea/empresas/${empresaId}`);
  for (const texto of ["Alta confirmada", "CUIT corregido", "Empresa suspendida", "Empresa reactivada"]) await expect(page.getByText(texto).first()).toBeVisible();
});

test("dos empresas que declararon el mismo CUIT: la primera que se confirma lo conserva y a la segunda se le explica de cuál es", async ({ page, browser, baseURL }) => {
  await ingresarALaConsola(page, CONSOLA!);
  const a = await sembrarInvitacion();
  const b = await sembrarInvitacion();
  empresasActivadas.push(a.empresaId, b.empresaId);
  await aceptarComoGerente(browser, baseURL, a, CUIT);
  await aceptarComoGerente(browser, baseURL, b, CUIT);

  // Las dos se ven marcadas como repetidas antes de confirmar ninguna.
  await page.goto(`${CONSOLA}/instalaciones/e2ea/empresas/${b.empresaId}`);
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)').filter({ hasText: "CUIT repetido" })).toContainText(a.nombre);

  await confirmarEnLaConsola(page, a.empresaId);
  await expect(page.getByText(/quedó activa con el CUIT/)).toBeVisible();

  await confirmarEnLaConsola(page, b.empresaId);
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)').filter({ hasText: a.nombre }).first()).toBeVisible();
  const segunda = await leerDeLaBase((db) => db.empresa.findUniqueOrThrow({ where: { id: b.empresaId } }));
  expect(segunda).toMatchObject({ estado: "PROVISIONING", cuit: null });
});
