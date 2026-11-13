import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";

/**
 * Estilo de planilla (docs/diseno-estilo-de-planilla-2026-11-09.md) EN EL NAVEGADOR REAL, sobre las dos pantallas adoptadas: la lista de Productos (filtros en banda propia + columna de
 * acciones) y la Biblioteca de opciones (apartados con título). A 1366×768: apartado con borde, banda de filtros aparte de la tabla, encabezado de tabla en banda, acciones en la última columna.
 * A 390×844: tarjetas (sin la tabla de 780 px), acción de la fila a la vista y de 44 px, y ninguna de las dos pantallas desborda hacia el costado.
 */
async function sembrar() {
  const marca = Date.now();
  const grupo = await sembrarGrupo({ nombre: `E2E Plan Tamaño ${marca}`, tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: `P${marca}`, opciones: [{ nombre: "Chico", monto: 0, factorEscala: 1 }, { nombre: "Grande", monto: 500, factorEscala: 2 }] });
  const sucursal = await prisma.sucursal.findFirstOrThrow({ where: { nombre: "Central" } });
  const nombre = `E2E Plan Milanesa ${marca}`;
  await sembrarProductoConOpciones({ nombre, codigo: `PV_E2E_PLAN_${marca}`, precioVenta: 1000, sucursalId: sucursal.id, grupos: [{ grupo }] });
  return { nombre, nombreDelGrupo: `E2E Plan Tamaño ${marca}` };
}

const sinDesborde = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test("escritorio 1366×768: Productos en apartado, filtros en banda aparte y la lista con sus acciones en la fila", async ({ paginaAutenticada: page }) => {
  const { nombre } = await sembrar();
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/catalogo/productos?q=${encodeURIComponent(nombre)}`);

  const apartado = page.getByRole("region", { name: "Lista de productos" });
  await expect(apartado).toBeVisible();
  const banda = apartado.locator("[data-barra-de-filtros]");
  const lista = page.getByRole("list", { name: "Productos" });
  await expect(banda).toBeVisible();
  await expect(lista).toBeVisible();
  // Los filtros están ENCIMA de la lista y no la tocan (la lista de Productos ya no es una tabla: es la lista de filas de la maqueta de Pedernal).
  const cajaBanda = (await banda.boundingBox())!;
  const cajaLista = (await lista.boundingBox())!;
  expect(cajaBanda.y + cajaBanda.height).toBeLessThan(cajaLista.y);

  const fila = lista.getByRole("listitem").filter({ hasText: nombre });
  await expect(fila.getByRole("link", { name: "Editar" })).toBeVisible();
  expect(await sinDesborde(page)).toBe(true);
});

test("escritorio 1366×768: Biblioteca de opciones con apartados y la tabla con su banda de encabezado", async ({ paginaAutenticada: page }) => {
  const { nombreDelGrupo } = await sembrar();
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/catalogo/opciones");
  await expect(page.getByRole("heading", { level: 2, name: "Grupos en uso" })).toBeVisible();
  const tabla = page.getByRole("table", { name: "Grupos de opciones" });
  await expect(tabla.getByRole("row").filter({ hasText: nombreDelGrupo })).toBeVisible();
  await expect(tabla.getByRole("columnheader")).toContainText(["Grupo", "Tipo"]);
  expect(await sinDesborde(page)).toBe(true);
});

test("celular 390×844: Productos en tarjetas con la acción a la vista (44 px) y sin desborde horizontal", async ({ paginaAutenticada: page }) => {
  const { nombre } = await sembrar();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/catalogo/productos?q=${encodeURIComponent(nombre)}`);
  await expect(page.getByRole("table", { name: "Productos" })).toHaveCount(0); // la tabla está oculta (display:none) y sale del árbol de accesibilidad
  const tarjeta = page.getByRole("list", { name: "Productos" }).getByRole("listitem").filter({ hasText: nombre });
  await expect(tarjeta).toBeVisible();
  const editar = tarjeta.getByRole("link", { name: "Editar" });
  await expect(editar).toBeVisible();
  expect((await editar.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await sinDesborde(page)).toBe(true);
});

test("celular 390×844: Biblioteca de opciones en tarjetas, sin desborde horizontal", async ({ paginaAutenticada: page }) => {
  const { nombreDelGrupo } = await sembrar();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/catalogo/opciones");
  await expect(page.getByRole("list", { name: "Grupos de opciones" }).getByRole("listitem").filter({ hasText: nombreDelGrupo })).toBeVisible();
  expect(await sinDesborde(page)).toBe(true);
});
