import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { codigoTotp, pasoDeTotp } from "../../src/core/plataforma/totp";
import { generarTokenOpaco, hashDeToken } from "../../src/core/seguridad/tokens";
import { fijarCodigoDeIngreso, leerDeLaBase, sembrarAdminDePlataforma, type AdminSembrado } from "./fixtures/consola";
import { conOrigenPropio } from "./fixtures/origen";
import { crearUsuarioSinEmpresa } from "./fixtures/invitacion";
import { paginaConSesion } from "./fixtures/multiempresa";
import { azarDelProceso } from "../../src/lib/azar";

/**
 * Alta de una empresa e invitación desde la consola (E5, ADR-020) en un navegador real, y el recorrido cruzado: lo que la consola crea lo acepta la app de
 * empresas. Se omite sin la conexión del rol `motor2_plataforma` (ver `consola-plataforma.spec.ts`). El mail de la invitación solo viaja por mail: el spec
 * reemplaza el hash del token en la base por el de uno que conoce, como `fijarCodigoDeIngreso` hace con el código de ingreso.
 */
const CONSOLA = process.env.MOTOR2_E2E_URL_PLATAFORMA;
test.skip(!CONSOLA, "sin MOTOR2_E2E_PLATAFORMA_DATABASE_URL no hay consola que probar");

const CODIGO_CONOCIDO = "482915";
const marca = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function ingresar(page: Page): Promise<AdminSembrado> {
  const admin = await sembrarAdminDePlataforma(`admin-${marca()}@plataforma.test`);
  await conOrigenPropio(page.context());
  await page.goto(`${CONSOLA}/login`);
  await page.locator("#email").fill(admin.email);
  await page.getByRole("button", { name: "Pedir código" }).click();
  await expect(page.locator("#codigo")).toBeVisible();
  expect(await fijarCodigoDeIngreso(page, admin.id, CODIGO_CONOCIDO)).toBe(1);
  await page.locator("#codigo").fill(CODIGO_CONOCIDO);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.locator("#factor")).toBeVisible();
  await page.locator("#factor").fill(codigoTotp(admin.secretoTotp, pasoDeTotp(Date.now())));
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(`${CONSOLA}/`);
  return admin;
}

async function llenarElAlta(page: Page, datos: { nombre: string; slug: string; email: string; zona?: string }) {
  await page.goto(`${CONSOLA}/instalaciones/e2ea/empresas/nueva`);
  await page.getByLabel("Nombre", { exact: true }).fill(datos.nombre);
  await page.getByLabel("Identificador (slug)").fill(datos.slug);
  await page.getByLabel("Zona horaria").fill(datos.zona ?? "America/Argentina/Buenos_Aires");
  await page.getByLabel("Email del dueño (será el gerente)").fill(datos.email);
}

async function sinViolaciones(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

test("sin sesión, ni la lista ni el alta ni el detalle se abren: mandan al login", async ({ page }) => {
  for (const ruta of ["/instalaciones/e2ea/empresas", "/instalaciones/e2ea/empresas/nueva", "/instalaciones/e2ea/empresas/cualquiera", "/instalaciones/noexiste/empresas"]) {
    await page.goto(`${CONSOLA}${ruta}`);
    await expect(page, ruta).toHaveURL(`${CONSOLA}/login`);
  }
});

test("alta completa: valida, da de alta, queda auditada con el administrador como autor, y reenviar, revocar e invitar de nuevo andan", async ({ page }) => {
  const admin = await ingresar(page);
  const m = marca();
  const datos = { nombre: `E2E Alta ${m}`, slug: `e2e-alta-${m}`, email: `duenio-${m}@local.test` };

  // Los errores se explican y no crean nada.
  await llenarElAlta(page, { ...datos, zona: "America/Narnia" });
  await sinViolaciones(page);
  await page.getByRole("button", { name: "Dar de alta" }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText(/zona horaria/i);
  expect(await leerDeLaBase((db) => db.empresa.count({ where: { slug: datos.slug } }))).toBe(0);

  // El email de un administrador de plataforma no puede ser gerente.
  await llenarElAlta(page, { ...datos, email: admin.email });
  await page.getByRole("button", { name: "Dar de alta" }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText(/administrador de la plataforma/i);
  expect(await leerDeLaBase((db) => db.empresa.count({ where: { slug: datos.slug } }))).toBe(0);

  // Alta correcta: va al detalle.
  await llenarElAlta(page, datos);
  await page.getByRole("button", { name: "Dar de alta" }).click();
  await expect(page).toHaveURL(new RegExp(`${CONSOLA}/instalaciones/e2ea/empresas/(?!nueva)[^/]+$`));
  await expect(page.getByRole("heading", { level: 1, name: datos.nombre })).toBeVisible();
  await expect(page.getByText(`Pendiente · ${datos.email}`)).toBeVisible();
  await sinViolaciones(page);

  const empresa = await leerDeLaBase((db) => db.empresa.findUniqueOrThrow({ where: { slug: datos.slug } }));
  expect(empresa).toMatchObject({ estado: "PROVISIONING", cuit: null });
  const auditoria = await leerDeLaBase((db) => db.auditoriaPlataforma.findMany({ where: { adminId: admin.id, empresaAfectadaId: empresa.id } }));
  expect(auditoria.map((a) => a.accion)).toEqual(["alta-de-empresa"]);
  expect(auditoria[0].adminEmail).toBe(admin.email);

  // Reenviar cambia el hash del token (el enlace anterior deja de servir) y queda auditado.
  const antes = await leerDeLaBase((db) => db.invitacion.findFirstOrThrow({ where: { empresaId: empresa.id } }));
  await page.getByRole("button", { name: "Reenviar la invitación" }).click();
  await expect(page.getByText(/Invitación reenviada a/)).toBeVisible();
  const despues = await leerDeLaBase((db) => db.invitacion.findFirstOrThrow({ where: { empresaId: empresa.id } }));
  expect(despues.hashToken).not.toBe(antes.hashToken);
  expect(despues.id).toBe(antes.id);

  // Revocar pide confirmación y deja REVOCADA.
  await page.getByRole("button", { name: "Revocar la invitación" }).click();
  await expect(page.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await sinViolaciones(page);
  await page.getByRole("button", { name: "Sí: revocar la invitación" }).click();
  await expect(page.getByText("Invitación revocada: el enlace ya no sirve.")).toBeVisible();
  expect((await leerDeLaBase((db) => db.invitacion.findFirstOrThrow({ where: { empresaId: empresa.id } }))).estado).toBe("REVOCADA");

  // Invitar de nuevo a otro email crea una pendiente nueva.
  await page.reload();
  await page.getByLabel("Invitar a otro email").fill(`otro-${m}@local.test`);
  await page.getByRole("button", { name: "Invitar de nuevo" }).click();
  await expect(page.getByText(`Invitación enviada a otro-${m}@local.test.`)).toBeVisible();
  const todas = await leerDeLaBase((db) => db.invitacion.findMany({ where: { empresaId: empresa.id }, orderBy: { creadaEn: "asc" } }));
  expect(todas.map((i) => [i.email, i.estado])).toEqual([
    [datos.email, "REVOCADA"],
    [`otro-${m}@local.test`, "PENDIENTE"],
  ]);
  const acciones = await leerDeLaBase((db) => db.auditoriaPlataforma.findMany({ where: { empresaAfectadaId: empresa.id }, orderBy: { creadoEn: "asc" } }));
  expect(acciones.map((a) => a.accion)).toEqual(["alta-de-empresa", "invitacion-reenviada", "invitacion-revocada", "invitacion-creada"]);

  // La lista la muestra.
  await page.goto(`${CONSOLA}/instalaciones/e2ea/empresas`);
  await expect(page.getByRole("link", { name: `Ver ${datos.nombre}` })).toBeVisible();
  await sinViolaciones(page);
});

test("recorrido cruzado: lo que la consola da de alta lo acepta el gerente en la app, y la consola lo ve aceptado con el CUIT declarado", async ({ page, browser, baseURL }) => {
  await ingresar(page);
  const m = marca();
  const datos = { nombre: `E2E Cruzado ${m}`, slug: `e2e-cruzado-${m}`, email: `gerente-${m}@local.test` };
  await llenarElAlta(page, datos);
  await page.getByRole("button", { name: "Dar de alta" }).click();
  await expect(page).toHaveURL(new RegExp(`${CONSOLA}/instalaciones/e2ea/empresas/(?!nueva)[^/]+$`));
  const detalle = page.url();

  // El token real viaja por mail: se lo reemplaza por uno conocido.
  const token = generarTokenOpaco(azarDelProceso);
  expect((await leerDeLaBase((db) => db.invitacion.updateMany({ where: { empresa: { slug: datos.slug } }, data: { hashToken: hashDeToken(token) } }))).count).toBe(1);

  // El invitado (que ya tiene su sesión de Google) abre el enlace y acepta.
  const invitado = await crearUsuarioSinEmpresa(datos.email);
  const app = await paginaConSesion(browser, baseURL, invitado.sessionToken);
  await app.goto(`/invitacion#t=${token}`);
  await app.getByLabel("CUIT de la empresa").fill("30-71234567-1");
  await app.getByRole("button", { name: "Revisar el CUIT" }).click();
  await app.getByLabel("Verifiqué que el CUIT y los datos de la empresa son correctos.").check();
  await app.getByRole("button", { name: "Confirmar y aceptar" }).click();
  await expect(app.getByText(`La empresa «${datos.nombre}» está en alta.`)).toBeVisible();

  // La consola la ve aceptada, con el CUIT declarado, y ya no ofrece reenviar.
  await page.goto(detalle);
  await expect(page.getByText(`Aceptada · ${datos.email}`)).toBeVisible();
  await expect(page.getByText(/30-71234567-1/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Reenviar la invitación" })).toHaveCount(0);
  await sinViolaciones(page);
});
