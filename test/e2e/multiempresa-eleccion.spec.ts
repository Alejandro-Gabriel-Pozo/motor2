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
 * E1: con acceso a DOS o más empresas y sin una elegida no hay empresa por defecto — `/login` pide elegir y lleva de vuelta a donde se iba.
 * Una cookie de empresa que no es de las suyas no sirve; quien solo tiene empresas suspendidas ve que lo están, y quien tiene una activa y
 * una suspendida entra a la activa sin elegir. Las empresas B y C se suspenden al terminar: devuelve la base a UNA empresa activa.
 */
test.describe.configure({ mode: "serial" });

let e: EmpresasDeLaPrueba;
let ajena: EmpresasDeLaPrueba;
let sesionDoble: string;
let proveedorA: string;
let proveedorB: string;

test.beforeAll(async () => {
  e = await activarEmpresaB();
  ajena = await activarEmpresaB(e); // una tercera empresa activa, a la que el usuario NO pertenece
  proveedorA = `Proveedor A ${e.marca}`;
  proveedorB = `Proveedor B ${e.marca}`;
  await sembrarProveedor(e.a.empresaId, proveedorA);
  await sembrarProveedor(e.b.empresaId, proveedorB);
  ({ sessionToken: sesionDoble } = await crearUsuarioEn(`eleccion-${e.marca}@local.test`, [
    { sucursalId: e.a.sucursalId, rolId: e.a.rolAdminId },
    { sucursalId: e.b.sucursalId, rolId: e.b.rolAdminId },
  ]));
});

test.afterAll(async () => {
  await suspenderEmpresaB(e.b.empresaId);
  await suspenderEmpresaB(ajena.b.empresaId);
});

async function ponerCookieDeEmpresa(page: import("@playwright/test").Page, baseURL: string | undefined, empresaId: string) {
  const host = new URL(baseURL ?? "http://localhost:3000").hostname;
  await page.context().addCookies([{ name: "empresaActivaId", value: empresaId, domain: host, path: "/", httpOnly: true, sameSite: "Lax" }]);
}

test("sin empresa elegida: la pantalla ofrece las dos empresas y al elegir una vuelve a donde se iba, con los datos de esa empresa", async ({ browser, baseURL }) => {
  const page = await paginaConSesion(browser, baseURL, sesionDoble);
  await page.goto("/catalogo/proveedores");

  await expect(page.getByRole("heading", { name: "¿A qué empresa querés entrar?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Entrar a / })).toHaveCount(2);
  await expect(page.getByRole("button", { name: `Entrar a ${e.a.nombre}` })).toBeVisible();

  await page.getByRole("button", { name: `Entrar a ${e.b.nombre}` }).click();
  await page.waitForURL((url) => url.pathname === "/catalogo/proveedores");
  await expect(page.getByLabel("Empresa activa")).toHaveValue(e.b.empresaId);
  await expect(page.getByText(proveedorB)).toBeVisible();
  await expect(page.getByText(proveedorA)).toHaveCount(0);
  await page.context().close();
});

test("con la cookie de una de sus empresas entra directo, sin pantalla de elección", async ({ browser, baseURL }) => {
  const page = await paginaConSesion(browser, baseURL, sesionDoble);
  await ponerCookieDeEmpresa(page, baseURL, e.a.empresaId);
  await page.goto("/catalogo/proveedores");

  await expect(page.getByRole("heading", { name: "¿A qué empresa querés entrar?" })).toHaveCount(0);
  await expect(page.getByLabel("Empresa activa")).toHaveValue(e.a.empresaId);
  await expect(page.getByText(proveedorA)).toBeVisible();
  await page.context().close();
});

test("con la cookie de una empresa que NO es suya: no entra a esa, y la pantalla ofrece solo las suyas", async ({ browser, baseURL }) => {
  const page = await paginaConSesion(browser, baseURL, sesionDoble);
  await ponerCookieDeEmpresa(page, baseURL, ajena.b.empresaId);
  await page.goto("/catalogo/proveedores");

  await expect(page.getByRole("heading", { name: "¿A qué empresa querés entrar?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Entrar a / })).toHaveCount(2);
  await expect(page.getByRole("button", { name: `Entrar a ${ajena.b.nombre}` })).toHaveCount(0);
  await page.context().close();
});

test.describe("empresa suspendida", () => {
  let suspendida: EmpresasDeLaPrueba;
  let sesionSoloSuspendida: string;
  let sesionActivaYSuspendida: string;
  let proveedorActiva: string;

  test.beforeAll(async () => {
    suspendida = await activarEmpresaB(e);
    proveedorActiva = `Proveedor A ${suspendida.marca}`;
    await sembrarProveedor(suspendida.a.empresaId, proveedorActiva);
    ({ sessionToken: sesionSoloSuspendida } = await crearUsuarioEn(`suspendida-${suspendida.marca}@local.test`, [
      { sucursalId: suspendida.b.sucursalId, rolId: suspendida.b.rolAdminId },
    ]));
    ({ sessionToken: sesionActivaYSuspendida } = await crearUsuarioEn(`mixto-${suspendida.marca}@local.test`, [
      { sucursalId: suspendida.a.sucursalId, rolId: suspendida.a.rolAdminId },
      { sucursalId: suspendida.b.sucursalId, rolId: suspendida.b.rolAdminId },
    ]));
    await suspenderEmpresaB(suspendida.b.empresaId);
  });

  test("quien solo tiene una empresa suspendida ve que está suspendida, con su nombre, y puede cerrar sesión", async ({ browser, baseURL }) => {
    const page = await paginaConSesion(browser, baseURL, sesionSoloSuspendida);
    await page.goto("/");

    await expect(page.getByText(`La empresa «${suspendida.b.nombre}» está suspendida.`)).toBeVisible();
    await expect(page.getByText("Comunicate con quien administra Motor2.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Entrar a / })).toHaveCount(0);
    await page.context().close();
  });

  test("quien tiene una empresa activa y otra suspendida entra a la activa sin elegir, y no ve selector", async ({ browser, baseURL }) => {
    const page = await paginaConSesion(browser, baseURL, sesionActivaYSuspendida);
    await page.goto("/catalogo/proveedores");

    await expect(page.getByRole("heading", { name: "¿A qué empresa querés entrar?" })).toHaveCount(0);
    await expect(page.getByText(proveedorActiva)).toBeVisible();
    await expect(page.getByLabel("Empresa activa")).toHaveCount(0);
    await page.context().close();
  });
});
