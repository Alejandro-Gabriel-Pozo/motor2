import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { sembrarGrupo } from "./fixtures/opciones";
import { capturar, expectObjetivosTactiles, expectSinDesborde, fijarCelular } from "./fixtures/movil";

/**
 * CARTA-MANT F1 (fila O.480 de docs/pureza-integracion.md): la pantalla de la carta con la premisa del dueño. Un PV disponible acá sin contenido de carta NO es un faltante (es el POS o el menú
 * del día): no hay recuadro ámbar, va plegado a «Fuera de carta (POS y menú del día): N», con buscador y «Agregar a la carta» de un toque (elegir la sección). El ancla de un adicional no figura
 * en ninguna lista. A 375 px (celular) y a 1280 px: sin desborde horizontal, objetivos de 44 px en celular y axe 0. Datos propios con una marca única (la base del CI es compartida: nunca se
 * cuentan elementos globales; el contador «N» se compara con lo que lista la misma pantalla).
 */
async function sembrar(sucursalId: string) {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Mant Platos ${m}`, orden: 900 } });
  const pv = (nombre: string, precioVenta: number) => prisma.producto.create({ data: { codigo: `E2E-MANT-${nombre.replace(/\W/g, "")}-${m}`, nombre: `${nombre} ${m}`, tipo: "PV", unidadStockId: unidad.id, precioVenta } });
  const enCarta = await pv("E2E Mant Bife de chorizo", 21500);
  const milanesa = await pv("E2E Mant Milanesa del día", 9800);
  const guiso = await pv("E2E Mant Guiso de lentejas", 8700);
  const productos = [enCarta, milanesa, guiso];
  await prisma.disponibilidadProducto.createMany({ data: productos.map((p) => ({ sucursalId, productoId: p.id, disponible: true })) });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: enCarta.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 1 } });
  // El ancla de un adicional, DISPONIBLE acá (como el «Adicional - papas fritas y huevo frito» que vio el dueño: un dato viejo): igual no tiene que figurar.
  const grupo = await sembrarGrupo({ nombre: `E2E Mant Extras ${m}`, tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 2, marca: m, opciones: [{ nombre: `E2E Mant Adicional papas y huevo ${m}`, monto: 1500, conAncla: true }] });
  const anclaId = Object.values(grupo.opciones)[0]!.anclaId!;
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: anclaId, disponible: true } });
  return {
    m,
    seccion,
    enCarta,
    milanesa,
    guiso,
    limpiar: async () => {
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: { in: [...productos.map((p) => p.id), anclaId] } } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: [...productos.map((p) => p.id), anclaId] } } });
      await prisma.producto.deleteMany({ where: { id: { in: productos.map((p) => p.id) } } });
      await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
    },
  };
}

async function recorrer(page: Page, d: Awaited<ReturnType<typeof sembrar>>, ancho: "375" | "1280", sucursalId: string) {
  await page.goto("/carta");
  await expect(page.getByRole("heading", { name: "Productos en la carta", level: 2 })).toBeVisible();
  // Sin el recuadro ámbar de «PV sin contenido».
  await expect(page.getByText(/PV disponibles acá sin contenido de carta/)).toHaveCount(0);
  await expectSinDesborde(page, `carta ${ancho} px, plegada`);

  // «Fuera de carta» plegado: el contador es lo que lista adentro.
  const fuera = page.locator("[data-fuera-de-carta]");
  const resumen = fuera.locator("> summary");
  await expect(resumen).toHaveText(/^Fuera de carta \(POS y menú del día\): \d+$/);
  await expect(fuera.locator(`[data-fuera-de-carta-producto="${d.milanesa.nombre}"]`)).toBeHidden();
  await resumen.click();
  const n = Number((await resumen.innerText()).match(/(\d+)$/)![1]);
  await expect(fuera.locator("[data-fuera-de-carta-producto]")).toHaveCount(n);

  // El buscador: sin acentos ni mayúsculas. Lo de esta corrida aparece; el ancla del adicional, no (ni buscándola).
  const buscar = fuera.getByLabel("Buscar producto");
  await buscar.fill(`e2e mant ${d.m}`);
  await expect(fuera.locator("[data-fuera-de-carta-producto]")).toHaveCount(2);
  await expect(fuera.locator(`[data-fuera-de-carta-producto="${d.milanesa.nombre}"]`)).toContainText("$9.800");
  await expect(fuera.locator(`[data-fuera-de-carta-producto="${d.enCarta.nombre}"]`)).toHaveCount(0);
  await buscar.fill(`ADICIONAL papas ${d.m}`);
  await expect(fuera.getByRole("status")).toHaveText("No hay productos que coincidan.");
  await buscar.fill(`lentejas ${d.m}`);
  await expect(fuera.locator("[data-fuera-de-carta-producto]")).toHaveCount(1);

  // «Agregar a la carta»: un toque abre las secciones, otro elige.
  const guiso = fuera.locator(`[data-fuera-de-carta-producto="${d.guiso.nombre}"]`);
  await guiso.getByRole("button", { name: `${d.guiso.nombre}: Agregar a la carta` }).click();
  await expect(guiso.getByRole("group", { name: `¿En qué sección de la carta va «${d.guiso.nombre}»?` })).toBeVisible();
  if (ancho === "375") {
    await expectObjetivosTactiles(fuera.getByRole("button"), "botones de «Fuera de carta»");
    await expectObjetivosTactiles(resumen, "resumen de «Fuera de carta»", { ancho: 0 });
    await expectObjetivosTactiles(buscar, "buscador de «Fuera de carta»", { ancho: 0 });
  }
  await expectSinDesborde(page, `carta ${ancho} px, eligiendo la sección`);
  await capturar(page, `carta-mant-f1-fuera-de-carta-${ancho}`);
  expect((await new AxeBuilder({ page }).analyze()).violations, `«Fuera de carta» abierto a ${ancho} px`).toEqual([]);

  await guiso.getByRole("button", { name: d.seccion.nombre, exact: true }).click();
  await expect(fuera.locator("[data-resultado-pegado]")).toHaveText(`«${d.guiso.nombre}» ya sale en la carta, al final de «${d.seccion.nombre}».`);
  await expect(guiso).toHaveCount(0);
  // Pasa a su sección, al final (después del bife), visible.
  const grupoSeccion = page.locator(`[data-grupo-de-la-carta="${d.seccion.nombre}"]`);
  await expect(grupoSeccion.locator("> summary")).toContainText("2 productos");
  await grupoSeccion.locator("> summary").click();
  await expect(grupoSeccion.locator("[data-contenido-carta]")).toHaveText([new RegExp(d.enCarta.nombre), new RegExp(d.guiso.nombre)]);
  await expect(grupoSeccion.locator(`[data-contenido-carta="${d.guiso.nombre}"] > details > summary`)).toContainText("se muestra");
  expect(await prisma.contenidoCartaProducto.findFirstOrThrow({ where: { sucursalId, productoId: d.guiso.id } })).toMatchObject({
    visibleEnCarta: true,
    seccionCartaId: d.seccion.id,
    orden: 2,
  });
  // Y el ancla tampoco está en ningún grupo de la carta.
  await expect(page.locator(`[data-contenido-carta*="Adicional papas y huevo ${d.m}"]`)).toHaveCount(0);
  await expectSinDesborde(page, `carta ${ancho} px, con la sección abierta`);
  await capturar(page, `carta-mant-f1-seccion-${ancho}`);
  expect((await new AxeBuilder({ page }).analyze()).violations, `sección abierta a ${ancho} px`).toEqual([]);
}

test("carta en celular (375 px): «Fuera de carta» plegado con buscador, «Agregar a la carta» de un toque, sin el ancla del adicional, sin desborde y axe 0", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrar(sucursalId);
  try {
    await fijarCelular(page);
    await recorrer(page, d, "375", sucursalId);
  } finally {
    await d.limpiar();
  }
});

test("carta en escritorio (1280 px): la misma premisa, sin desborde y axe 0", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrar(sucursalId);
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await recorrer(page, d, "1280", sucursalId);
  } finally {
    await d.limpiar();
  }
});
