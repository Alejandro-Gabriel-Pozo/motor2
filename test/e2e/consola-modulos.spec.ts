import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ingresarALaConsola, leerDeLaBase } from "./fixtures/consola";
import { activarEmpresaB, crearUsuarioEn, paginaConSesion, suspenderEmpresaB, type EmpresasDeLaPrueba } from "./fixtures/multiempresa";
import { fijarModulosActivos } from "../setup/modulos";

/**
 * Módulos de una empresa desde la consola (E7, ADR-023) en un navegador real: la plataforma activa Salón, Stock queda «incluido por Salón» y no se puede desactivar, y del
 * lado de la empresa desaparece el aviso de «sin módulos» en el próximo pedido; al desactivar vuelve. Se omite sin la conexión del rol `motor2_plataforma`.
 */
const CONSOLA = process.env.MOTOR2_E2E_URL_PLATAFORMA;
test.skip(!CONSOLA, "sin MOTOR2_E2E_PLATAFORMA_DATABASE_URL no hay consola que probar");
test.describe.configure({ mode: "serial" });

const AVISO = /no tiene ningún módulo activo/;
let e: EmpresasDeLaPrueba;
let sesion: string;

test.beforeAll(async () => {
  e = await activarEmpresaB();
  await fijarModulosActivos(e.b.empresaId, []);
  ({ sessionToken: sesion } = await crearUsuarioEn(`modulos-consola-${e.marca}@local.test`, [{ sucursalId: e.b.sucursalId, rolId: e.b.rolAdminId }]));
});

test.afterAll(async () => {
  await suspenderEmpresaB(e.b.empresaId);
});

test("activar Salón trae Stock, bloquea desactivarlo y la empresa lo ve; desactivar lo quita", async ({ page, browser, baseURL }) => {
  await ingresarALaConsola(page, CONSOLA!);
  await page.goto(`${CONSOLA}/instalaciones/e2ea/empresas/${e.b.empresaId}/modulos`);
  await expect(page.getByRole("heading", { name: /^Módulos de / })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  const app = await paginaConSesion(browser, baseURL, sesion);
  await app.goto("/administracion/permisos");
  await expect(app.getByRole("status").filter({ hasText: AVISO })).toBeVisible();

  await page.getByRole("button", { name: "Activar Salón", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancelar" })).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: /^Sí: activar Salón/ }).click();

  await expect(page.getByText("Salón quedó activado.")).toBeVisible();
  const fila = (nombre: string) => page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: nombre, exact: true }) });
  await expect(fila("Stock")).toContainText("Incluido por Salón");
  await expect(page.getByRole("button", { name: "Desactivar Stock" })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await app.goto("/administracion/permisos");
  await expect(app.getByText(AVISO)).toHaveCount(0);

  await page.getByRole("button", { name: "Desactivar Salón", exact: true }).click();
  await page.getByRole("button", { name: /^Sí: desactivar Salón/ }).click();
  await expect(page.getByText("Salón quedó desactivado.")).toBeVisible();

  await app.goto("/administracion/permisos");
  await expect(app.getByRole("status").filter({ hasText: AVISO })).toBeVisible();
  await app.context().close();

  const acciones = await leerDeLaBase((db) => db.auditoriaPlataforma.findMany({ where: { empresaAfectadaId: e.b.empresaId }, orderBy: { creadoEn: "asc" }, select: { accion: true } }));
  expect(acciones.map((a) => a.accion)).toEqual(["modulo-activado", "modulo-desactivado"]);
});

test("un código desconocido en la URL no muestra texto ajeno", async ({ page }) => {
  await ingresarALaConsola(page, CONSOLA!);
  await page.goto(`${CONSOLA}/instalaciones/e2ea/empresas/${e.b.empresaId}/modulos?hecho=modulo-activado&modulo=<b>falso</b>`);
  await expect(page.getByRole("heading", { name: /^Módulos de / })).toBeVisible();
  await expect(page.getByText("falso")).toHaveCount(0);
  await expect(page.getByText("quedó activado")).toHaveCount(0);
});
