import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";
import { capturar, expectObjetivosTactiles, expectSinDesborde, fijarCelular } from "./fixtures/movil";

/**
 * MOVIL (pase visual en celular, 375 × 812): «Precio local». Las dos tablas (la de precio por producto, 5 columnas, y la de precio por tamaño, 4 columnas con un campo y botones por fila)
 * no entraban en 375 px: «Guardar» se cortaba en «Guard», las columnas «Habilitado» y «Volver al de la empresa» quedaban invisibles y el encabezado de la tabla vieja salía pegado
 * («ProductoPrecio local…»). En celular cada fila es una tarjeta con el nombre de cada dato arriba; en escritorio, la tabla de siempre.
 *
 * Mide, no mira: nada se sale por la derecha (ni la página ni ninguna fila), «Guardar» y «Volver al de la empresa» se ven enteros (su texto cabe en su caja) y miden >= 44 px, cada dato de
 * una tarjeta queda debajo del anterior (no en columnas), el encabezado visible de escritorio tiene aire entre columnas, y axe 0 en los dos tamaños.
 */
async function sembrar(sucursalId: string) {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const tamano = await sembrarGrupo({ nombre: `E2E Tamaño precio móvil ${m}`, tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Chico", factorEscala: 1 }, { nombre: "Mediano", factorEscala: 1.25 }, { nombre: "Grande", factorEscala: 1.5 }] });
  const nombre = `E2E Café con un nombre bastante largo ${m}`;
  const { productoId } = await sembrarProductoConOpciones({
    nombre,
    codigo: `E2E-PM-${m}`,
    precioVenta: 2500,
    sucursalId,
    grupos: [{ grupo: tamano, modoPrecio: "ABSOLUTO", preciosAbsolutos: { Chico: 2500, Mediano: 2900, Grande: 3100 } }],
  });
  // Una fila de la tabla de precio por producto (habilitada) y una de un tamaño con precio propio ya cargado en esta sucursal.
  await prisma.precioLocalProducto.create({ data: { sucursalId, productoId, precio: "2700.00", habilitado: true } });
  await prisma.precioLocalDeOpcion.create({ data: { sucursalId, productoId, opcionId: tamano.opciones["Grande"]!.opcionId, precio: "3300.00", habilitado: true } });
  return { nombre, productoId };
}

test("precio local en celular (375 px): las dos tablas se leen como tarjetas, «Guardar» entero y todo a 44 px", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrar(sucursalId);
  await fijarCelular(page);
  await page.goto("/movimientos/precio-local");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Precio local");
  await expectSinDesborde(page, "precio local");
  await capturar(page, "precio-local");

  // Tabla por tamaño: cada fila es una tarjeta dentro de la pantalla, con sus datos uno debajo del otro.
  // Solo las filas de MI producto (la base puede traer filas por tamaño de otros specs o de datos compartidos): se identifican por el nombre único que sembró este spec.
  const filas = page.locator(`[data-tamano^="${d.nombre} · "]`);
  await expect(filas).toHaveCount(3);
  for (const fila of await filas.all()) {
    const caja = (await fila.boundingBox())!;
    expect.soft(caja.x + caja.width, "tarjeta de tamaño dentro de la pantalla").toBeLessThanOrEqual(375);
    const celdas = await fila.locator("td").all();
    let yAnterior = -1;
    for (const celda of celdas) {
      const c = (await celda.boundingBox())!;
      expect.soft(c.y, "cada dato debajo del anterior (una columna)").toBeGreaterThan(yAnterior);
      yAnterior = c.y;
    }
  }
  const grande = page.locator(`[data-tamano='${d.nombre} · Grande']`);
  const guardar = grande.getByRole("button", { name: `Guardar el precio de ${d.nombre} · Grande` });
  const volver = grande.getByRole("button", { name: `Volver al de la empresa en ${d.nombre} · Grande` });
  for (const [nombre, boton] of [["«Guardar»", guardar], ["«Volver al de la empresa»", volver]] as const) {
    await expect(boton, `${nombre} visible`).toBeVisible();
    const { scrollWidth, clientWidth } = await boton.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect.soft(scrollWidth, `${nombre}: el texto entero cabe en el botón`).toBeLessThanOrEqual(clientWidth + 1);
    const c = (await boton.boundingBox())!;
    expect.soft(c.x + c.width, `${nombre}: dentro de la pantalla`).toBeLessThanOrEqual(375);
  }
  await expectObjetivosTactiles(page.locator("main").locator("button, select, input:not([type=checkbox]):not([type=hidden])"), "precio local: campos y botones", { ancho: 0 });
  await expectObjetivosTactiles(guardar, "«Guardar»", { alto: 44, ancho: 44 });

  // Guardar sigue funcionando desde la tarjeta.
  await grande.getByLabel(`Precio de ${d.nombre} · Grande en esta sucursal`).fill("3400");
  await guardar.click();
  await expect(grande.getByRole("status").filter({ hasText: "guardado" })).toBeVisible();
  await expectSinDesborde(page, "precio local tras guardar");
  expect((await new AxeBuilder({ page }).analyze()).violations, "precio local en celular").toEqual([]);
});

test("precio local en escritorio (1280 px): sigue siendo una tabla, con aire entre las columnas del encabezado", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrar(sucursalId);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/movimientos/precio-local");
  const tabla = page.getByRole("table").first();
  await expect(tabla.locator("thead")).toBeVisible();
  const padding = await tabla.getByRole("columnheader", { name: "Producto" }).evaluate((th) => parseFloat(getComputedStyle(th).paddingRight));
  expect(padding, "aire a la derecha de «Producto» en el encabezado (antes salía «ProductoPrecio local»)").toBeGreaterThanOrEqual(8);
  const porTamano = page.getByRole("table", { name: "Precios por tamaño en esta sucursal" });
  const fila = porTamano.locator(`[data-tamano='${d.nombre} · Grande']`);
  const celdas = await fila.locator("td").all();
  const ys = await Promise.all(celdas.map(async (c) => Math.round((await c.boundingBox())!.y)));
  expect(new Set(ys).size, "las celdas de una fila quedan en el mismo renglón (tabla)").toBe(1);
  await expect(porTamano.getByRole("columnheader", { name: "Habilitado" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations, "precio local en escritorio").toEqual([]);
});
