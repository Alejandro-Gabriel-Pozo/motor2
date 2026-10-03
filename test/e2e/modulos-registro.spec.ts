import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { activarEmpresaB, crearUsuarioEn, paginaConSesion, suspenderEmpresaB, type EmpresasDeLaPrueba } from "./fixtures/multiempresa";
import { fijarModulosActivos } from "../setup/modulos";

/**
 * P8 (bloque 5A): el shell avisa cuando la empresa no tiene ningún módulo vendible disponible. La empresa B se queda sin filas del registro (el estado
 * en que nace una empresa que la plataforma todavía no activó) y después con solo Consignación. Se suspende al terminar.
 */
const AVISO = /no tiene ningún módulo activo/;
let e: EmpresasDeLaPrueba;
let sesion: string;

test.beforeAll(async () => {
  e = await activarEmpresaB();
  ({ sessionToken: sesion } = await crearUsuarioEn(`modulos-${e.marca}@local.test`, [{ sucursalId: e.b.sucursalId, rolId: e.b.rolAdminId }]));
});

test.afterAll(async () => {
  await suspenderEmpresaB(e.b.empresaId);
});

test("sin ninguna fila en el registro: aviso visible y Administración sigue abriendo", async ({ browser, baseURL }) => {
  await fijarModulosActivos(e.b.empresaId, []);
  const page = await paginaConSesion(browser, baseURL, sesion);
  await page.goto("/administracion/permisos");
  await expect(page.getByRole("status").filter({ hasText: AVISO })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Permisos" }).first()).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations).toEqual([]);
  await page.context().close();
});

test("con solo Consignación hay un módulo vendible: no hay aviso", async ({ browser, baseURL }) => {
  await fijarModulosActivos(e.b.empresaId, ["consignacion"]);
  const page = await paginaConSesion(browser, baseURL, sesion);
  await page.goto("/administracion/permisos");
  await expect(page.getByRole("heading", { name: "Permisos" }).first()).toBeVisible();
  await expect(page.getByText(AVISO)).toHaveCount(0);
  await page.context().close();
});
