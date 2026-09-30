import { test, expect } from "@playwright/test";
import {
  activarEmpresaB,
  crearUsuarioEn,
  paginaConSesion,
  sembrarProveedor,
  suspenderEmpresaB,
  type EmpresasDeLaPrueba,
} from "./fixtures/multiempresa";

/**
 * ADR-007, A7: un usuario que pertenece a las DOS empresas ve el selector de empresa y, al elegir la otra, pasa a ver sus datos
 * (y deja de ver los de la anterior). La segunda empresa se suspende al terminar.
 */
let e: EmpresasDeLaPrueba;
let sesion: string;
let proveedorA: string;
let proveedorB: string;

test.beforeAll(async () => {
  e = await activarEmpresaB();
  proveedorA = `Proveedor A ${e.marca}`;
  proveedorB = `Proveedor B ${e.marca}`;
  await sembrarProveedor(e.a.empresaId, proveedorA);
  await sembrarProveedor(e.b.empresaId, proveedorB);
  ({ sessionToken: sesion } = await crearUsuarioEn(`doble-${e.marca}@local.test`, [
    { sucursalId: e.a.sucursalId, rolId: e.a.rolAdminId },
    { sucursalId: e.b.sucursalId, rolId: e.b.rolAdminId },
  ]));
});

test.afterAll(async () => {
  await suspenderEmpresaB(e.b.empresaId);
});

test("un usuario en las dos empresas ve el selector y al cambiar de empresa ve los datos de la otra", async ({ browser, baseURL }) => {
  const page = await paginaConSesion(browser, baseURL, sesion);

  // Entra en la empresa más antigua de sus pertenencias: la A.
  await page.goto("/catalogo/proveedores");
  const selector = page.getByLabel("Empresa activa");
  await expect(selector).toBeVisible();
  await expect(selector.locator("option")).toHaveCount(2);
  await expect(page.getByText(proveedorA)).toBeVisible();
  await expect(page.getByText(proveedorB)).toHaveCount(0);

  await selector.selectOption({ label: e.b.nombre });
  await expect(page).toHaveURL(/\/(inicio)?$/);

  await page.goto("/catalogo/proveedores");
  await expect(page.getByLabel("Empresa activa")).toHaveValue(e.b.empresaId);
  await expect(page.getByText(proveedorB)).toBeVisible();
  await expect(page.getByText(proveedorA)).toHaveCount(0);
  await page.context().close();
});
