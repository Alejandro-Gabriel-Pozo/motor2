import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { capturar, expectObjetivosTactiles, expectSinDesborde, fijarCelular } from "./fixtures/movil";

/**
 * CARTA-MANT F4 «Precios» (prototipo aprobado; decisiones del dueño 2026-10-14; filas O.484 y O.485 de docs/pureza-integracion.md), a 375 px y a 1280 px:
 *  - «Ajustar sección»: subir un 10 % con la vista previa de cada producto (sin selector de redondeo, al centavo) cambia el precio LOCAL de esta sucursal; el de lista de la empresa no cambia.
 *  - «Cambiar precio» de un producto, «En toda la empresa»: el cartel «ESTE PRECIO SE MODIFICARÁ EN:» con la sucursal activa, y «Guardar precio» deshabilitado hasta tildar la confirmación; cambia
 *    el precio de lista.
 * Sin desborde, 44 px en celular y axe 0. Datos propios con una marca única; se limpian al final (precios locales incluidos).
 */
async function sembrar(sucursalId: string) {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Precios ${m}`, orden: 901 } });
  const pv = async (nombre: string, precioVenta: number, orden: number) => {
    const p = await prisma.producto.create({ data: { codigo: `E2E-PREC-${nombre.replace(/\W/g, "")}-${m}`, nombre: `${nombre} ${m}`, tipo: "PV", unidadStockId: unidad.id, precioVenta } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: p.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden } });
    return p;
  };
  const bife = await pv("E2E Precios Bife", 21500, 1);
  const flan = await pv("E2E Precios Flan", 6200, 2);
  const ids = [bife.id, flan.id];
  return {
    seccion,
    bife,
    flan,
    limpiar: async () => {
      await prisma.precioLocalProducto.deleteMany({ where: { productoId: { in: ids } } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: { in: ids } } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: ids } } });
      await prisma.producto.deleteMany({ where: { id: { in: ids } } });
      await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
    },
  };
}

async function recorrer(page: Page, d: Awaited<ReturnType<typeof sembrar>>, ancho: "375" | "1280", sucursalId: string) {
  const local = async (productoId: string) => (await prisma.precioLocalProducto.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } } }))?.precio.toFixed(2) ?? null;
  const deLista = async (id: string) => (await prisma.producto.findUniqueOrThrow({ where: { id } })).precioVenta.toFixed(2);
  const aviso = page.locator("[data-aviso-carta]");
  const celular = ancho === "375";

  await page.goto("/carta?nivel=precios");
  await expect(page.getByRole("button", { name: "Precios", exact: true })).toHaveAttribute("aria-pressed", "true");
  const tarjeta = page.locator(`[data-seccion-precios="${d.seccion.nombre}"]`);
  await expectSinDesborde(page, `Precios ${ancho} px`);
  await capturar(page, `carta-mant-precios-${ancho}`);

  // ---------- «Ajustar sección»: el precio local de esta sucursal ----------
  await tarjeta.getByRole("button", { name: `${d.seccion.nombre}: Ajustar sección` }).click();
  const hoja = page.getByRole("dialog", { name: `Ajustar precios · ${d.seccion.nombre}` });
  await expect(hoja.getByRole("button", { name: "Subir" })).toHaveAttribute("aria-pressed", "true");
  await expect(hoja.getByText("Redondear a")).toHaveCount(0);
  await hoja.getByLabel("Cuánto").fill("10");
  await expect(hoja.locator(`[data-vista-precio="${d.bife.nombre}"]`)).toContainText("$ 21.500 → $ 23.650");
  await expect(hoja.locator(`[data-vista-precio="${d.flan.nombre}"]`)).toContainText("$ 6.200 → $ 6.820");
  await expect(hoja.getByRole("button", { name: "Solo en esta sucursal" })).toHaveAttribute("aria-pressed", "true");
  if (celular) await expectObjetivosTactiles(hoja.getByRole("button"), "botones de la hoja de precios");
  await expectSinDesborde(page, `hoja de precios ${ancho} px`);
  await capturar(page, `carta-mant-precios-ajustar-${ancho}`);
  expect((await new AxeBuilder({ page }).analyze()).violations, `hoja de «Ajustar sección» a ${ancho} px`).toEqual([]);
  await hoja.getByRole("button", { name: "Aplicar a 2 productos" }).click();
  await expect(aviso.locator("> span")).toHaveText(/^2 precios nuevos en «/);
  expect([await local(d.bife.id), await local(d.flan.id)]).toEqual(["23650.00", "6820.00"]);
  expect([await deLista(d.bife.id), await deLista(d.flan.id)]).toEqual(["21500.00", "6200.00"]);

  // ---------- «Cambiar precio», en toda la empresa ----------
  await tarjeta.getByRole("button", { name: new RegExp(`^${d.seccion.nombre} \\d`) }).click();
  await tarjeta.getByRole("button", { name: `Cambiar precio de ${d.bife.nombre} (hoy $ 23.650)` }).click();
  const uno = page.getByRole("dialog", { name: d.bife.nombre });
  await uno.getByRole("button", { name: "En toda la empresa" }).click();
  const cartel = uno.locator("[data-aviso-de-empresa]");
  await expect(cartel).toContainText("ESTE PRECIO SE MODIFICARÁ EN:");
  await expect(cartel).toContainText("tiene precio local propio: no ve el cambio");
  await expect(uno.getByText("Hoy: $ 21.500")).toBeVisible();
  await uno.getByLabel("Precio nuevo (IVA incluido)").fill("24000");
  const guardar = uno.getByRole("button", { name: "Guardar precio" });
  await expect(guardar).toBeDisabled();
  await uno.getByLabel("Confirmo que quiero cambiar el precio en todas estas sucursales").check();
  await expect(guardar).toBeEnabled();
  await expectSinDesborde(page, `hoja de precio de la empresa ${ancho} px`);
  await capturar(page, `carta-mant-precios-empresa-${ancho}`);
  expect((await new AxeBuilder({ page }).analyze()).violations, `hoja de «toda la empresa» a ${ancho} px`).toEqual([]);
  await guardar.click();
  await expect(aviso.locator("> span")).toHaveText(`«${d.bife.nombre}»: precio nuevo en toda la empresa.`);
  expect([await deLista(d.bife.id), await local(d.bife.id)]).toEqual(["24000.00", "23650.00"]);
}

test("«Precios» en celular (375 px): ajustar sección (precio local) y cambiar el precio de la empresa con confirmación, sin desborde, 44 px y axe 0", async ({ paginaAutenticada: page, sucursalId }) => {
  test.setTimeout(120_000);
  const d = await sembrar(sucursalId);
  try {
    await fijarCelular(page);
    await recorrer(page, d, "375", sucursalId);
  } finally {
    await d.limpiar();
  }
});

test("«Precios» en escritorio (1280 px): lo mismo, sin desborde y axe 0", async ({ paginaAutenticada: page, sucursalId }) => {
  test.setTimeout(120_000);
  const d = await sembrar(sucursalId);
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await recorrer(page, d, "1280", sucursalId);
  } finally {
    await d.limpiar();
  }
});
