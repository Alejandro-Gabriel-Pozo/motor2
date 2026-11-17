import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { expectObjetivosTactiles, expectSinDesborde } from "./fixtures/movil";
import { DIRECTORIO_AL_ESTILO_DE_PEDERNAL } from "../../src/core/catalogo/directorio-de-la-lista";

/**
 * Paso 8 del plan de pantallas (dueño, 2026-11-17: «4a»; interruptor `DIRECTORIO_AL_ESTILO_DE_PEDERNAL`): las listas de Proveedores y de Clientes con descuento con buscador y desactivados ocultos, y el alta de un
 * proveedor con solo el nombre a la vista. A 375 y a 1280 px.
 */
test.skip(!DIRECTORIO_AL_ESTILO_DE_PEDERNAL, "con el interruptor apagado las listas son las de siempre");

const marca = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

for (const ancho of [1280, 375]) {
  test(`a ${ancho} px: Proveedores sin desactivados, con buscador y con «Mostrar desactivados»`, async ({ paginaAutenticada: page }) => {
    await page.setViewportSize({ width: ancho, height: 900 });
    const m = marca();
    const activo = await prisma.proveedor.create({ data: { codigo: `E2E-DIR-A-${m}`, nombre: `E2E Dir Carnicería ${m}`, contacto: "Pedro Gómez" } });
    const apagado = await prisma.proveedor.create({ data: { codigo: `E2E-DIR-B-${m}`, nombre: `E2E Dir Lácteos ${m}`, activo: false } });
    try {
      await page.goto(`/catalogo/proveedores?q=${m}`);
      const filas = page.locator("tbody tr");
      await expect(filas).toHaveCount(1);
      await expect(filas.first()).toContainText(activo.nombre);
      await expect(page.getByText(apagado.nombre)).toHaveCount(0);

      // «Mostrar desactivados»: aparece, y la dirección lo lleva.
      const barra = page.getByRole("search", { name: "Buscar" });
      await barra.getByLabel("Mostrar desactivados").check();
      await barra.getByRole("button", { name: "Buscar" }).click();
      await expect(page).toHaveURL(/desactivados=1/);
      await expect(filas).toHaveCount(2);
      await expect(page.getByText(apagado.nombre)).toBeVisible();

      // Buscar sin acentos ni mayúsculas, por nombre y por contacto.
      await barra.getByLabel(/^Buscar por/).fill(`CARNICERIA ${m}`);
      await barra.getByRole("button", { name: "Buscar" }).click();
      await expect(filas).toHaveCount(1);
      await barra.getByLabel(/^Buscar por/).fill("gomez");
      await barra.getByRole("button", { name: "Buscar" }).click();
      await expect(page.getByText(activo.nombre)).toBeVisible();
      await barra.getByLabel(/^Buscar por/).fill(`zzz-no-existe-${m}`);
      await barra.getByRole("button", { name: "Buscar" }).click();
      await expect(page.getByText("Sin resultados.")).toBeVisible();

      if (ancho === 375) {
        await expectSinDesborde(page, "lista de Proveedores a 375 px");
        await expectObjetivosTactiles(barra.locator("input[type=search], div.isolate, button"), "controles del buscador de Proveedores (el buscador, la fila de la casilla y el botón)");
      }
      expect((await new AxeBuilder({ page }).analyze()).violations, "accesibilidad de la lista de Proveedores").toEqual([]);

      await page.getByRole("link", { name: "Limpiar" }).click();
      await expect(page).toHaveURL(/\/catalogo\/proveedores$/);
    } finally {
      await prisma.proveedor.deleteMany({ where: { id: { in: [activo.id, apagado.id] } } });
    }
  });
}

test("el alta de un proveedor muestra el nombre y plega los demás datos; guardar solo con el nombre funciona", async ({ paginaAutenticada: page }) => {
  const nombre = `E2E Alta Rápida ${marca()}`;
  await page.goto("/catalogo/proveedores/nuevo");
  await expect(page.locator('input[name="nombre"]')).toBeVisible();
  await expect(page.getByText("Más datos, si los tenés")).toBeVisible();
  await expect(page.locator('input[name="contacto"]')).toBeHidden();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByText("Más datos, si los tenés").click();
  await expect(page.locator('input[name="contacto"]')).toBeVisible();
  await page.getByText("Más datos, si los tenés").click();
  await page.locator('input[name="nombre"]').fill(nombre);
  await page.getByRole("button", { name: "Crear proveedor" }).click();
  await page.waitForURL(/\/catalogo\/proveedores\/[^/]+\?guardado=alta$/);
  await expect(page.getByRole("status")).toHaveText("Proveedor creado.");
  // Lo que no se tocó queda como siempre: compra productos.
  const creado = await prisma.proveedor.findFirstOrThrow({ where: { nombre } });
  expect(creado.ofreceProductos).toBe(true);
  expect(creado.ofreceServicios).toBe(false);
  await prisma.proveedor.delete({ where: { id: creado.id } });
});

test("Clientes con descuento: sin desactivados, con buscador y con «Mostrar desactivados»", async ({ paginaAutenticada: page }) => {
  const m = marca();
  const activo = await prisma.cliente.create({ data: { nombre: `E2E Dir Cliente José ${m}`, descuentoPorcentaje: 10 } });
  const apagado = await prisma.cliente.create({ data: { nombre: `E2E Dir Cliente Baja ${m}`, descuentoPorcentaje: 5, activo: false } });
  try {
    await page.goto(`/catalogo/clientes?q=${m}`);
    await expect(page.getByText(activo.nombre)).toBeVisible();
    await expect(page.getByText(apagado.nombre)).toHaveCount(0);
    await page.goto(`/catalogo/clientes?q=jose%20${m}&desactivados=1`);
    await expect(page.getByText(activo.nombre)).toBeVisible();
    await expect(page.getByText(apagado.nombre)).toHaveCount(0);
    await page.goto(`/catalogo/clientes?q=${m}&desactivados=1`);
    await expect(page.getByText(apagado.nombre)).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await prisma.cliente.deleteMany({ where: { id: { in: [activo.id, apagado.id] } } });
  }
});
