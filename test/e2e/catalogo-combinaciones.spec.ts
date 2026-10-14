import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";

/**
 * GO-3b (ADR-032, F6 pasos U3 y U4): las COMBINACIONES de un producto y las TARIFAS, de punta a punta en la pantalla. Fija: elegir el tamaño como eje; darle al grande un precio propio (queda en la
 * base con su versión), apagar el chico y cargarle al grande su receta propia (versión 1); crear una tarifa y asignarla; que el doble clic guarda una sola vez; y axe en las dos pantallas (son
 * pantallas de administración: su maquetación en escritorio la barre `maquetacion-general`, que ya las incluye). Lo sembrado de opciones no se borra (ver `fixtures/opciones.ts`): cada corrida usa su marca.
 */

async function sembrar(sucursalId: string) {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const grano = await prisma.producto.create({ data: { codigo: `E2E-CB-GRANO-${m}`, nombre: `E2E Grano ${m}`, tipo: "MP", unidadStockId: kg.id } });
  const tamano = await sembrarGrupo({ nombre: `E2E Tamaño CB ${m}`, tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Chico", monto: -300, factorEscala: 0.75 }, { nombre: "Grande", monto: 300, factorEscala: 1.5 }] });
  const nombre = `E2E Café CB ${m}`;
  const { productoId } = await sembrarProductoConOpciones({ nombre, codigo: `E2E-CB-CAFE-${m}`, precioVenta: 2500, sucursalId, grupos: [{ grupo: tamano }] });
  return { m, productoId, nombre, tamano, grano };
}

test("ejes, precio propio del grande, el chico que no se vende y la receta propia: todo queda en la base; axe sin violaciones", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrar(sucursalId);
  await page.goto(`/catalogo/productos/${d.productoId}/combinaciones`);
  await expect(page.getByRole("heading", { level: 1, name: `Combinaciones de «${d.nombre}»` })).toBeVisible();
  await page.locator('select[name="eje1"]').selectOption({ label: `E2E Tamaño CB ${d.m}` });
  await page.getByRole("button", { name: "Guardar ejes" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Ejes de las combinaciones/ })).toBeVisible();
  await expect.poll(async () => (await prisma.productoAdmiteGrupo.findFirstOrThrow({ where: { productoId: d.productoId } })).ejeDeCombinacion).toBe(1);

  // El grande: precio propio de 3 100 (la regla general daría 2 800). Doble clic: una sola combinación.
  const grande = page.locator('[data-combinacion="Grande"]');
  await grande.locator("summary").click();
  await expect(grande).toContainText("2.800");
  await grande.locator('select[name="modo"]').selectOption("PROPIO");
  await grande.locator('input[name="precio"]').fill("3100");
  await grande.getByRole("button", { name: "Guardar combinación" }).dblclick();
  await expect.poll(async () => prisma.combinacionDeProducto.findMany({ where: { productoId: d.productoId }, select: { precio: true, activa: true } })).toEqual([expect.objectContaining({ activa: true })]);
  expect(Number((await prisma.combinacionDeProducto.findFirstOrThrow({ where: { productoId: d.productoId } })).precio)).toBe(3100);

  // El chico deja de venderse.
  const chico = page.locator('[data-combinacion="Chico"]');
  await chico.locator("summary").click();
  await chico.locator('input[name="activa"]').uncheck();
  await chico.getByRole("button", { name: "Guardar combinación" }).click();
  await expect.poll(async () => (await prisma.combinacionDeProducto.findFirst({ where: { productoId: d.productoId, opcionEje1Id: d.tamano.opciones["Chico"]!.opcionId } }))?.activa).toBe(false);

  // La receta propia del grande: 36 g de grano.
  await page.reload();
  const grandeOtraVez = page.locator('[data-combinacion="Grande"]');
  await grandeOtraVez.locator("summary").click();
  const receta = grandeOtraVez.locator('[data-receta-propia="Grande"]');
  await receta.locator('select[name="insumo"]').first().selectOption({ label: `E2E Grano ${d.m} (kg)` });
  await receta.locator('input[name="cantidad"]').first().fill("0,036");
  await receta.getByRole("button", { name: "Guardar receta propia" }).click();
  await expect(receta.getByRole("status")).toContainText("versión 1");
  const combinacion = await prisma.combinacionDeProducto.findFirstOrThrow({ where: { productoId: d.productoId, opcionEje1Id: d.tamano.opciones["Grande"]!.opcionId } });
  const version = await prisma.recetaDeCombinacionVersion.findFirstOrThrow({ where: { combinacionId: combinacion.id }, include: { ingredientes: true } });
  expect(version.ingredientes.map((i) => [i.insumoProductoId, Number(i.cantidad)])).toEqual([[d.grano.id, 0.036]]);

  expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);
});

test("tarifas: crear una, verla en la lista y asignarla a una combinación; axe sin violaciones", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrar(sucursalId);
  await page.goto("/catalogo/tarifas");
  await expect(page.getByRole("heading", { level: 1, name: "Tarifas" })).toBeVisible();
  const nombre = `E2E Tarifa ${d.m}`;
  await page.locator('input[name="nombre"]').first().fill(nombre);
  await page.locator('input[name="precio"]').first().fill("3000");
  await page.getByRole("button", { name: "Crear tarifa" }).click();
  await expect(page.locator(`[data-tarifa="${nombre}"]`)).toBeVisible();
  expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);

  await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: d.productoId }, data: { ejeDeCombinacion: 1 } });
  await page.goto(`/catalogo/productos/${d.productoId}/combinaciones`);
  const grande = page.locator('[data-combinacion="Grande"]');
  await grande.locator("summary").click();
  await grande.locator('select[name="modo"]').selectOption("TARIFA");
  await grande.locator('select[name="tarifa"]').selectOption({ label: `${nombre} ($ 3.000)` });
  await grande.getByRole("button", { name: "Guardar combinación" }).click();
  const tarifa = await prisma.grupoDePrecio.findFirstOrThrow({ where: { nombre } });
  await expect.poll(async () => (await prisma.combinacionDeProducto.findFirst({ where: { productoId: d.productoId } }))?.grupoDePrecioId).toBe(tarifa.id);
});
