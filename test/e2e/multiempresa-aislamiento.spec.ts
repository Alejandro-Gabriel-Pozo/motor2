import { test, expect } from "@playwright/test";
import { prismaAdmin } from "../setup/cliente-duenio";
import {
  activarEmpresaB,
  crearSesion,
  crearUsuarioEn,
  paginaConSesion,
  sembrarProveedor,
  suspenderEmpresaB,
  type EmpresasDeLaPrueba,
} from "./fixtures/multiempresa";

/**
 * ADR-007, A7: con DOS empresas activas (la de la base y una creada con `crearEmpresa`), cada usuario ve solo lo suyo — en la app
 * autenticada y en la carta pública por path `/carta-publica/<slug>/…`. La segunda empresa se suspende al terminar.
 */
test.describe.configure({ mode: "serial" });

let e: EmpresasDeLaPrueba;
let sesionA: string;
let sesionB: string;
let proveedorA: string;
let proveedorB: string;

test.beforeAll(async () => {
  e = await activarEmpresaB();
  proveedorA = `Proveedor A ${e.marca}`;
  proveedorB = `Proveedor B ${e.marca}`;
  await sembrarProveedor(e.a.empresaId, proveedorA);
  await sembrarProveedor(e.b.empresaId, proveedorB);
  ({ sessionToken: sesionA } = await crearUsuarioEn(`admin-a-${e.marca}@local.test`, [{ sucursalId: e.a.sucursalId, rolId: e.a.rolAdminId }]));
  // El admin de B es el gerente que dejó `crearEmpresa`: se lo usa tal cual, sin membresías extra.
  sesionB = await crearSesion(e.b.adminUsuarioId);
});

test.afterAll(async () => {
  await suspenderEmpresaB(e.b.empresaId);
});

test.describe("app autenticada", () => {
  test("un usuario de B solo ve datos de B (y no le aparece el selector de empresa)", async ({ browser, baseURL }) => {
    const page = await paginaConSesion(browser, baseURL, sesionB);
    await page.goto("/catalogo/proveedores");
    await expect(page.getByText(proveedorB)).toBeVisible();
    await expect(page.getByText(proveedorA)).toHaveCount(0);
    await expect(page.locator("header").getByText(e.b.sucursalNombre)).toBeVisible();
    await expect(page.getByLabel("Empresa activa")).toHaveCount(0);
    await page.context().close();
  });

  test("un usuario de A solo ve datos de A", async ({ browser, baseURL }) => {
    const page = await paginaConSesion(browser, baseURL, sesionA);
    await page.goto("/catalogo/proveedores");
    await expect(page.getByText(proveedorA)).toBeVisible();
    await expect(page.getByText(proveedorB)).toHaveCount(0);
    await expect(page.getByLabel("Empresa activa")).toHaveCount(0);
    await page.context().close();
  });
});

test.describe("carta pública por path", () => {
  test("la sucursal publicada de A no aparece bajo el slug de B, ni al revés", async ({ page }) => {
    const slugCartaA = `carta-a-${e.marca}`;
    const slugCartaB = `carta-b-${e.marca}`;
    await prismaAdmin.sucursalPublica.create({ data: { empresaId: e.a.empresaId, sucursalId: e.a.sucursalId, slug: slugCartaA, publicada: true, etiqueta: `Carta A ${e.marca}` } });
    await prismaAdmin.sucursalPublica.create({ data: { empresaId: e.b.empresaId, sucursalId: e.b.sucursalId, slug: slugCartaB, publicada: true, etiqueta: `Carta B ${e.marca}` } });
    try {
      expect((await page.goto(`/carta-publica/${e.a.slug}/${slugCartaA}`))?.status()).toBe(200);
      expect((await page.goto(`/carta-publica/${e.b.slug}/${slugCartaA}`))?.status()).toBe(404);
      expect((await page.goto(`/carta-publica/${e.b.slug}/${slugCartaB}`))?.status()).toBe(200);
      expect((await page.goto(`/carta-publica/${e.a.slug}/${slugCartaB}`))?.status()).toBe(404);

      await page.goto(`/carta-publica/${e.b.slug}`);
      await expect(page.getByRole("link", { name: new RegExp(`Carta B ${e.marca}`) })).toBeVisible();
      await expect(page.getByRole("link", { name: new RegExp(`Carta A ${e.marca}`) })).toHaveCount(0);
      await page.goto(`/carta-publica/${e.a.slug}`);
      await expect(page.getByRole("link", { name: new RegExp(`Carta A ${e.marca}`) })).toBeVisible();
      await expect(page.getByRole("link", { name: new RegExp(`Carta B ${e.marca}`) })).toHaveCount(0);
    } finally {
      await prismaAdmin.sucursalPublica.deleteMany({ where: { slug: { in: [slugCartaA, slugCartaB] } } });
    }
  });
});
