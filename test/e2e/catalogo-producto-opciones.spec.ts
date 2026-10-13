import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { abrirComoRol } from "./fixtures/rol-pos";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";

/**
 * GO-2d, «Opciones de venta» de UN producto (`/catalogo/productos/[id]/opciones`, Editar de `producto_opciones_admitidas`) y su sección en la ficha: asignar un tamaño con precio
 * propio y ver los precios EXACTOS que calcula el servidor, el choque de dos pestañas y quién ve qué. Lo sembrado de opciones no se borra (ver `fixtures/opciones.ts`).
 */

const marca = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

async function productoSuelto(m: string, sucursalId: string, precioVenta = 2500) {
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const p = await prisma.producto.create({ data: { codigo: `E2E-PO-${m}`, nombre: `E2E Café de la ficha ${m}`, tipo: "PV", unidadStockId: unidad.id, precioVenta } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
  return p;
}

test("asignar un tamaño con precio propio: la vista previa muestra los precios exactos del servidor, en la pantalla y en la ficha", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const producto = await productoSuelto(m, sucursalId);
  await sembrarGrupo({ nombre: `E2E Tamaño ficha ${m}`, tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Chico", factorEscala: 0.75 }, { nombre: "Mediano", factorEscala: 1 }, { nombre: "Grande", factorEscala: 1.5 }] });

  await page.goto(`/catalogo/productos/${producto.id}/opciones`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Opciones de venta de");
  await expect(page.getByText("todavía no admite opciones")).toBeVisible();
  await page.getByLabel("Grupo", { exact: true }).selectOption({ label: `E2E Tamaño ficha ${m} (Tamaño)` });
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  const grupo = page.locator(`[data-admision-grupo='E2E Tamaño ficha ${m}']`);
  await expect(grupo).toBeVisible();
  // Arranca con «diferencia sobre el precio base» y las tres opciones admitidas: todas al precio base.
  await expect(page.locator("[data-resumen-de-opciones]")).toContainText("Chico $ 2.500 · Mediano $ 2.500 · Grande $ 2.500");

  await grupo.getByRole("radio", { name: "Precio propio por tamaño" }).check();
  await grupo.getByLabel("Precio de Chico en este producto").fill("2500");
  await grupo.getByLabel("Precio de Mediano en este producto").fill("2800");
  await grupo.getByLabel("Precio de Grande en este producto").fill("3100");
  await grupo.getByRole("button", { name: `Guardar «E2E Tamaño ficha ${m}»` }).click();
  await expect(grupo.getByRole("status").filter({ hasText: "como pediste" })).toBeVisible();
  const resumen = page.locator("[data-resumen-de-opciones]");
  await expect(resumen).toContainText("Chico $ 2.500 · Mediano $ 2.800 · Grande $ 3.100");
  await expect(resumen).toContainText("desde $ 2.500");
  expect((await prisma.productoAdmiteGrupo.findFirstOrThrow({ where: { productoId: producto.id } })).modoPrecio).toBe("ABSOLUTO");
  expect((await prisma.productoAdmiteOpcion.findMany({ where: { productoId: producto.id }, orderBy: { precioAbsoluto: "asc" } })).map((o) => Number(o.precioAbsoluto))).toEqual([2500, 2800, 3100]);
  expect((await new AxeBuilder({ page }).analyze()).violations, "pantalla de edición").toEqual([]);

  // La ficha muestra lo mismo, solo para leer, con el enlace para editar (el admin tiene la clave).
  await page.goto(`/catalogo/productos/${producto.id}`);
  const seccion = page.getByRole("region", { name: "Opciones de venta" });
  await expect(seccion).toContainText("Chico $ 2.500 · Mediano $ 2.800 · Grande $ 3.100");
  await expect(seccion.getByRole("link", { name: "Editar opciones" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations, "ficha").toEqual([]);

  // La lista de productos lo marca.
  await page.goto(`/catalogo/productos?q=${encodeURIComponent(producto.nombre)}`);
  await expect(page.locator("tr", { hasText: producto.nombre }).locator("[data-etiqueta-opciones]")).toHaveText("1 grupo de opciones");
});

test("dos pestañas sobre lo que admite el producto: la vieja se rechaza con «Recargar» y no pisa", async ({ paginaAutenticada: pestañaA, sucursalId }) => {
  const m = marca();
  const leche = await sembrarGrupo({ nombre: `E2E Leche ficha ${m}`, tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "De vaca" }, { nombre: "Almendras", monto: 300 }] });
  const { productoId } = await sembrarProductoConOpciones({ nombre: `E2E Cortado ficha ${m}`, codigo: `E2E-POC-${m}`, precioVenta: 2000, sucursalId, grupos: [{ grupo: leche }] });
  const pestañaB = await pestañaA.context().newPage();
  await pestañaA.goto(`/catalogo/productos/${productoId}/opciones`);
  await pestañaB.goto(`/catalogo/productos/${productoId}/opciones`);

  const enA = pestañaA.locator(`[data-admision-grupo='E2E Leche ficha ${m}']`);
  await enA.getByLabel("Cómo se cobra Almendras en este producto").selectOption("MONTO");
  await enA.getByLabel("Diferencia en pesos de Almendras").fill("450");
  await enA.getByRole("button", { name: /^Guardar/ }).click();
  await expect(enA.getByRole("status").filter({ hasText: "como pediste" })).toBeVisible();
  await expect(pestañaA.locator("[data-resumen-de-opciones]")).toContainText("Almendras + $ 450");

  const enB = pestañaB.locator(`[data-admision-grupo='E2E Leche ficha ${m}']`);
  await enB.getByLabel("Máximo en este producto").fill("1");
  await enB.getByLabel("Mínimo en este producto").fill("1");
  await enB.getByRole("button", { name: /^Guardar/ }).click();
  const choque = enB.getByRole("alert").filter({ hasText: "cambió mientras lo editabas" });
  await expect(choque).toBeVisible();
  await expect(choque.getByRole("button", { name: "Recargar" })).toBeVisible();
  expect((await prisma.productoAdmiteGrupo.findFirstOrThrow({ where: { productoId } })).cantidadMinima).toBeNull();
  expect((await new AxeBuilder({ page: pestañaB }).analyze()).violations, "con el choque a la vista").toEqual([]);
});

test("quien solo ve el catálogo: la ficha muestra las opciones sin «Editar opciones» y la página de edición no se abre", async ({ browser, baseURL, sucursalId }) => {
  const m = marca();
  const extras = await sembrarGrupo({ nombre: `E2E Extras ficha ${m}`, tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 2, marca: m, opciones: [{ nombre: "Huevo frito", monto: 600, conAncla: true }] });
  const { productoId } = await sembrarProductoConOpciones({ nombre: `E2E Milanesa ficha ${m}`, codigo: `E2E-POM-${m}`, precioVenta: 9000, sucursalId, grupos: [{ grupo: extras }] });
  const { page, limpiar } = await abrirComoRol(browser, baseURL, sucursalId, { producto_ver_catalogo: "ver" });
  try {
    await page.goto(`/catalogo/productos/${productoId}`);
    const seccion = page.getByRole("region", { name: "Opciones de venta" });
    await expect(seccion).toContainText("Huevo frito + $ 600 c/u");
    await expect(seccion.getByRole("link", { name: "Editar opciones" })).toHaveCount(0);
    await page.goto(`/catalogo/productos/${productoId}/opciones`);
    await expect(page.getByText(/No tenés permiso/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Guardar/ })).toHaveCount(0);
  } finally {
    await limpiar();
  }
});
