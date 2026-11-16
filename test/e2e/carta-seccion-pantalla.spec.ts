import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * Secciones de la carta como lista simple, igual que Pedernal (Frente 6; pedido del dueño 2026-11-16, «Lista simple como Pedernal (Recomendada)»), en un navegador real:
 *  - la lista (`/carta/parametrizacion/secciones`) ya no apila los datos de todas las secciones ni la ficha de cada producto: solo el orden, «Nueva sección de carta» y los productos fuera de las secciones;
 *  - tocar una sección abre su pantalla (`/carta/parametrizacion/secciones/[id]`) con sus datos de siempre y SUS productos, cada uno con el enlace a su ficha de carta;
 *  - guardar (también con doble clic), apagar y prender usan las acciones de siempre (nada se pierde ni se duplica);
 *  - un id que no existe da «no encontrada», a 375 px y a escritorio sin desborde horizontal ni violaciones de axe.
 */
test("la sección se abre desde la lista, se edita, se apaga y se prende; sus productos llevan a su ficha de carta", async ({ paginaAutenticada: page, sucursalId }) => {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Sección ${marca}`, titulo: `Título ${marca}`, descripcion: `Descripción ${marca}`, orden: 60 } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E_SEC_${marca}`, nombre: `E2E Plato ${marca}`, tipo: "PV", precioVenta: 1000, unidadStockId: unidad.id } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: producto.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 0 } });

  try {
    for (const [ancho, alto] of [[375, 812], [1366, 768]] as const) {
      await page.setViewportSize({ width: ancho, height: alto });
      // La lista: sin los datos de cada sección ni la ficha de cada producto.
      await page.goto("/carta/parametrizacion/secciones");
      const main = page.locator("main");
      await expect(main.locator(`[data-seccion-orden="${seccion.nombre}"]`)).toBeVisible();
      await expect(main.getByRole("heading", { name: "Datos de cada sección" })).toHaveCount(0);
      await expect(main.getByRole("heading", { name: "Productos de cada sección" })).toHaveCount(0);
      await expect(main.locator(`[data-contenido-carta="${producto.nombre}"]`)).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${ancho} px: sin desborde horizontal en la lista`).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations, `${ancho} px: la lista de secciones`).toEqual([]);

      // Tocar la sección abre su pantalla.
      await main.locator(`[data-seccion-orden="${seccion.nombre}"]`).getByRole("link", { name: seccion.nombre }).click();
      await expect(page).toHaveURL(new RegExp(`/carta/parametrizacion/secciones/${seccion.id}$`));
      await expect(main.getByLabel("Título", { exact: false }).first()).toHaveValue(`Título ${marca}`);
      const delaSeccion = main.locator(`[data-producto-de-la-seccion="${producto.nombre}"]`);
      await expect(delaSeccion.getByRole("link", { name: producto.nombre })).toHaveAttribute("href", `/catalogo/productos/${producto.id}/en-la-carta`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${ancho} px: sin desborde horizontal en la sección`).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations, `${ancho} px: una sección`).toEqual([]);
    }

    // Editar: el título nuevo se guarda con la acción de siempre; un doble clic no duplica ni rompe nada (la misma acción con los mismos datos).
    await page.goto(`/carta/parametrizacion/secciones/${seccion.id}`);
    const main = page.locator("main");
    await main.getByLabel("Título", { exact: false }).first().fill(`Título nuevo ${marca}`);
    await main.getByRole("button", { name: "Guardar sección" }).dblclick();
    await expect.poll(async () => (await prisma.seccionCarta.findUniqueOrThrow({ where: { id: seccion.id } })).titulo).toBe(`Título nuevo ${marca}`);
    expect(await prisma.seccionCarta.count({ where: { id: seccion.id } })).toBe(1);

    // Apagar y prender.
    await main.getByRole("button", { name: `Apagar «${seccion.nombre}»` }).click();
    await expect.poll(async () => (await prisma.seccionCarta.findUniqueOrThrow({ where: { id: seccion.id } })).activa).toBe(false);
    await expect(main.getByRole("button", { name: `Prender «${seccion.nombre}»` })).toBeVisible();
    await page.goto("/carta/parametrizacion/secciones");
    await expect(page.locator("main").locator(`[data-seccion-orden="${seccion.nombre}"]`)).toContainText("Oculta");
    await page.goto(`/carta/parametrizacion/secciones/${seccion.id}`);
    await page.locator("main").getByRole("button", { name: `Prender «${seccion.nombre}»` }).click();
    await expect.poll(async () => (await prisma.seccionCarta.findUniqueOrThrow({ where: { id: seccion.id } })).activa).toBe(true);

    // Un id que no existe: «no encontrada», no una pantalla vacía.
    const respuesta = await page.goto("/carta/parametrizacion/secciones/no-existe-" + marca);
    expect(respuesta?.status()).toBe(404);
  } finally {
    await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
    await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
  }
});
