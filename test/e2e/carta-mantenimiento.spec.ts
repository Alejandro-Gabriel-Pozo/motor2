import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { sembrarGrupo } from "./fixtures/opciones";
import { capturar, expectObjetivosTactiles, expectSinDesborde, fijarCelular } from "./fixtures/movil";

/**
 * CARTA-MANT (prototipo APROBADO «Mantenimiento / Parametrización»; filas O.480 a O.483 de docs/pureza-integracion.md): la carta de la sucursal de punta a punta, a 375 px (celular) y a 1280 px.
 *  - «Hoy»: la pastilla de un producto lo deja sin stock hoy y «Deshacer» (a la vista) lo devuelve; el botón-estado apaga la sección entera y su «Deshacer» deja cada producto como estaba; «Sin
 *    stock hoy» filtra.
 *  - «Visibilidad»: el Sí/No de un producto y su «Deshacer»; al final, «Fuera de carta (POS y menú del día)» plegado, con buscador, sin el ancla del adicional (ni buscándola), con la vista previa
 *    de opciones y «Agregar a la carta», cuyo «Deshacer» lo devuelve a «Fuera de carta».
 *  - las pestañas de la entrada «Carta» (DEC-24: Hoy · Secciones y géneros · Ítems agrupados), que reemplazan el hub de «Parametrización» (su URL redirige).
 * Sin desborde horizontal, objetivos de 44 px en celular y axe 0. Datos propios con una marca única (la base del CI es compartida: no se cuentan elementos globales).
 */
async function sembrar(sucursalId: string) {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Mant Platos ${m}`, orden: 900 } });
  const pv = async (nombre: string, precioVenta: number, disponible = true) => {
    const p = await prisma.producto.create({ data: { codigo: `E2E-MANT-${nombre.replace(/\W/g, "")}-${m}`, nombre: `${nombre} ${m}`, tipo: "PV", unidadStockId: unidad.id, precioVenta } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible } });
    return p;
  };
  const bife = await pv("E2E Mant Bife", 21500);
  const flan = await pv("E2E Mant Flan", 6200, false);
  const risotto = await pv("E2E Mant Risotto", 15900);
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: bife.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 1 } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: flan.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 2 } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: risotto.id, visibleEnCarta: false, seccionCartaId: seccion.id, orden: 3 } });
  const milanesa = await pv("E2E Mant Milanesa del día", 9800);
  const guiso = await pv("E2E Mant Guiso de lentejas", 8700);
  // El ancla de un adicional, DISPONIBLE acá (como el «Adicional - papas fritas y huevo frito» que vio el dueño: un dato viejo): igual no tiene que figurar.
  const grupo = await sembrarGrupo({ nombre: `E2E Mant Extras ${m}`, tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 2, marca: m, opciones: [{ nombre: `E2E Mant Adicional papas y huevo ${m}`, monto: 1500, conAncla: true }] });
  const anclaId = Object.values(grupo.opciones)[0]!.anclaId!;
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: anclaId, disponible: true } });
  const productos = [bife, flan, risotto, milanesa, guiso];
  return {
    m,
    seccion,
    bife,
    flan,
    risotto,
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
  const disponible = async (productoId: string) => (await prisma.disponibilidadProducto.findUniqueOrThrow({ where: { sucursalId_productoId: { sucursalId, productoId } } })).disponible;
  const contenido = (productoId: string) => prisma.contenidoCartaProducto.findUnique({ where: { sucursalId_productoId: { sucursalId, productoId } } });
  const aviso = page.locator("[data-aviso-carta]");
  const deshacer = aviso.getByRole("button", { name: "Deshacer" });
  const celular = ancho === "375";
  const raiz = page.locator("main");

  // ---------- Hoy ----------
  await page.goto("/carta");
  await expect(page.getByRole("heading", { name: "Carta", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hoy", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/PV disponibles acá sin contenido de carta/)).toHaveCount(0);
  const tarjeta = page.locator(`[data-seccion-hoy="${d.seccion.nombre}"]`);
  const titulo = tarjeta.getByRole("button", { name: new RegExp(`^${d.seccion.nombre} \\d`) });
  await expect(titulo).toContainText("1 de 2 disponibles · 1 oculto");
  await expect(tarjeta.getByRole("button", { name: `${d.seccion.nombre}: Algunos agotados. Tocá para apagar toda la sección` })).toBeVisible();
  await expectSinDesborde(page, `Hoy ${ancho} px`);
  await capturar(page, `carta-mant-hoy-${ancho}`);
  await titulo.click();
  await expect(titulo).toHaveAttribute("aria-expanded", "true");
  await expect(tarjeta.getByText("Oculto · decisión tuya")).toBeVisible();
  if (celular) await expectObjetivosTactiles(raiz.getByRole("button"), "botones de Hoy");
  expect((await new AxeBuilder({ page }).analyze()).violations, `Hoy desplegado a ${ancho} px`).toEqual([]);

  // Un producto: sin stock hoy y «Deshacer», a la vista.
  const pastillaBife = tarjeta.getByRole("button", { name: `${d.bife.nombre}: En carta` });
  await pastillaBife.click();
  await expect(aviso.locator("> span")).toHaveText(new RegExp(`^«${d.bife.nombre}»: sin stock hoy en «`));
  await expect(deshacer, "«Deshacer» dentro de la pantalla").toBeInViewport({ ratio: 1 });
  if (celular) await expectObjetivosTactiles(deshacer, "«Deshacer»");
  await expect(tarjeta.getByRole("button", { name: `${d.bife.nombre}: Sin stock hoy` })).toHaveAttribute("aria-pressed", "false");
  expect(await disponible(d.bife.id)).toBe(false);
  await capturar(page, `carta-mant-hoy-aviso-${ancho}`);
  await deshacer.click();
  await expect(aviso.locator("> span")).toHaveText(new RegExp(`^«${d.bife.nombre}»: de nuevo en carta en «`));
  await expect(pastillaBife).toHaveAttribute("aria-pressed", "true");
  expect(await disponible(d.bife.id)).toBe(true);

  // La sección entera: todo sin stock, y su «Deshacer» deja cada uno como estaba (el flan seguía sin stock).
  await tarjeta.getByRole("button", { name: `${d.seccion.nombre}: Algunos agotados. Tocá para apagar toda la sección` }).click();
  await expect(aviso.locator("> span")).toHaveText(new RegExp(`^2 productos sin stock hoy en «.*» \\(1 ya estaba así\\)\\.$`));
  await expect(tarjeta.getByRole("button", { name: `${d.seccion.nombre}: Todo agotado. Tocá para prender toda la sección` })).toBeVisible();
  expect([await disponible(d.bife.id), await disponible(d.flan.id)]).toEqual([false, false]);
  await deshacer.click();
  await expect(aviso.locator("> span")).toHaveText(new RegExp(`^2 productos vuelven a como estaban en «`));
  await expect(tarjeta.getByRole("button", { name: `${d.seccion.nombre}: Algunos agotados. Tocá para apagar toda la sección` })).toBeVisible();
  expect([await disponible(d.bife.id), await disponible(d.flan.id)]).toEqual([true, false]);

  // «Sin stock hoy» filtra: en mi sección queda solo el flan.
  await page.locator('[data-contador="sin-stock"]').click();
  await expect(page.locator('[data-contador="sin-stock"]')).toHaveAttribute("aria-pressed", "true");
  await expect(tarjeta.locator("[data-producto-hoy]")).toHaveText([new RegExp(d.flan.nombre)]);
  await capturar(page, `carta-mant-hoy-sin-stock-${ancho}`);

  // ---------- Visibilidad ----------
  await page.getByRole("button", { name: "Visibilidad", exact: true }).click();
  await expect(page).toHaveURL(/nivel=visibilidad/);
  const vis = page.locator(`[data-seccion-visibilidad="${d.seccion.nombre}"]`);
  // Con un oculto, la sección arranca desplegada.
  const risotto = vis.locator(`[data-producto-visibilidad="${d.risotto.nombre}"]`);
  await expect(risotto.getByRole("button", { name: "No" })).toHaveAttribute("aria-pressed", "true");
  await risotto.getByRole("button", { name: "Sí" }).click();
  await expect(risotto.getByRole("button", { name: "Sí" })).toHaveAttribute("aria-pressed", "true");
  expect((await contenido(d.risotto.id))?.visibleEnCarta).toBe(true);
  await deshacer.click();
  await expect(risotto.getByRole("button", { name: "No" })).toHaveAttribute("aria-pressed", "true");
  expect((await contenido(d.risotto.id))?.visibleEnCarta).toBe(false);

  // «Fuera de carta», plegado al final.
  const fuera = page.locator("[data-fuera-de-carta]");
  await expect(fuera.locator("> summary")).toContainText(/Fuera de carta \(POS y menú del día\): \d+/);
  await fuera.locator("> summary").click();
  const buscar = fuera.getByRole("searchbox", { name: "Buscar en «Fuera de carta»" });
  await buscar.fill(`e2e mant ${d.m}`);
  await expect(fuera.locator("[data-fuera-de-carta-producto]")).toHaveCount(2);
  await buscar.fill(`ADICIONAL papas ${d.m}`);
  await expect(fuera.getByRole("status")).toHaveText("No hay productos que coincidan.");
  await buscar.fill(`lentejas ${d.m}`);
  const guiso = fuera.locator(`[data-fuera-de-carta-producto="${d.guiso.nombre}"]`);
  await guiso.getByRole("button", { name: `${d.guiso.nombre}: Agregar a la carta` }).click();
  await expect(guiso.locator("[data-vista-previa]")).toHaveText("Sin opciones.");
  if (celular) await expectObjetivosTactiles(fuera.getByRole("button"), "botones de «Fuera de carta»");
  await expectSinDesborde(page, `Visibilidad ${ancho} px, eligiendo la sección`);
  await capturar(page, `carta-mant-visibilidad-${ancho}`);
  expect((await new AxeBuilder({ page }).analyze()).violations, `Visibilidad con «Fuera de carta» abierto a ${ancho} px`).toEqual([]);
  await guiso.getByRole("button", { name: d.seccion.nombre, exact: true }).click();
  await expect(aviso.locator("> span")).toHaveText(`«${d.guiso.nombre}» ya sale en la carta, al final de «${d.seccion.nombre}».`);
  await expect(guiso).toHaveCount(0);
  await expect(vis.locator(`[data-producto-visibilidad="${d.guiso.nombre}"]`)).toBeVisible();
  expect(await contenido(d.guiso.id)).toMatchObject({ visibleEnCarta: true, seccionCartaId: d.seccion.id, orden: 4 });
  // «Deshacer» lo devuelve a «Fuera de carta» (se quita su contenido).
  await deshacer.click();
  await expect(aviso.locator("> span")).toHaveText(`«${d.guiso.nombre}» volvió a «Fuera de carta» (POS y menú del día).`);
  await expect(guiso).toBeVisible();
  expect(await contenido(d.guiso.id)).toBeNull();

  // ---------- Pestañas de la entrada «Carta» (DEC-24: reemplazan las puertas Mantenimiento / Parametrización) ----------
  const pestanas = page.getByRole("navigation", { name: "Carta", exact: true });
  await expect(pestanas.getByRole("link")).toHaveText(["Hoy", "Secciones y géneros", "Ítems agrupados"]);
  await expect(pestanas.getByRole("link", { name: "Hoy" })).toHaveAttribute("aria-current", "page");
  if (celular) await expectObjetivosTactiles(pestanas.getByRole("link"), "pestañas de Carta");
  await pestanas.getByRole("link", { name: "Secciones y géneros" }).click();
  await expect(page).toHaveURL(/\/carta\/parametrizacion\/secciones$/);
  await expect(page.getByRole("navigation", { name: "Carta", exact: true }).getByRole("link", { name: "Secciones y géneros" })).toHaveAttribute("aria-current", "page");
  await expectSinDesborde(page, `Secciones y géneros ${ancho} px`);
  await capturar(page, `carta-mant-secciones-${ancho}`);
  expect((await new AxeBuilder({ page }).analyze()).violations, `Secciones y géneros a ${ancho} px`).toEqual([]);
  // El tablero viejo de «Parametrización» ya no existe como pantalla: su URL manda a Secciones y géneros.
  await page.goto("/carta/parametrizacion");
  await expect(page).toHaveURL(/\/carta\/parametrizacion\/secciones$/);
}

test("carta en celular (375 px): Hoy, Visibilidad con «Fuera de carta» y las pestañas de Carta, con «Deshacer», sin desborde, 44 px y axe 0", async ({ paginaAutenticada: page, sucursalId }) => {
  test.setTimeout(120_000);
  const d = await sembrar(sucursalId);
  try {
    await fijarCelular(page);
    await recorrer(page, d, "375", sucursalId);
  } finally {
    await d.limpiar();
  }
});

test("carta en escritorio (1280 px): lo mismo, sin desborde y axe 0", async ({ paginaAutenticada: page, sucursalId }) => {
  test.setTimeout(120_000);
  const d = await sembrar(sucursalId);
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await recorrer(page, d, "1280", sucursalId);
  } finally {
    await d.limpiar();
  }
});
