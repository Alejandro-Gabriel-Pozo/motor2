import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { prismaAdmin } from "../setup/cliente-duenio";
import { capturar, expectObjetivosTactiles, expectSinDesborde, fijarCelular } from "./fixtures/movil";

/**
 * MOVIL — pase de pantalla del 2026-11-13 (defectos 3, 5, 6, 7 y 8 del ensayo general), 375 × 812. Mide, no mira:
 *  - 3: el Historial de traspasos es una lista de tarjetas (cada dato rotulado, nada pegado) y la página no se sale;
 *  - 5: la tarjeta de mesa «Continuar pedido» ocupa todo el ancho si es la única, el texto cabe en un renglón y el ícono no toca el borde;
 *  - 6: las tablas que se desplazan de costado muestran una sombra donde hay más para ver (y no hay sombra de más donde no);
 *  - 7: los enlaces de texto sueltos y las casillas miden 44 px de área táctil (la casilla: su etiqueta, que cubre el cuadradito y lo que lo rodea);
 *  - 8: «Duplicar» dice «Duplicando…» mientras el servidor trabaja.
 */
async function medirAreaDeCasillas(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const chicas: string[] = [];
    for (const c of Array.from(document.querySelectorAll<HTMLInputElement>("input[type=checkbox]"))) {
      const caja = c.getBoundingClientRect();
      if (caja.width === 0 || caja.height === 0) continue;
      const etiqueta = c.labels?.[0]?.getBoundingClientRect();
      const area = etiqueta ? { alto: etiqueta.height, cubre: etiqueta.left <= caja.left + 0.5 && etiqueta.right >= caja.right } : { alto: caja.height, cubre: false };
      if (area.alto + 0.5 < 44 || !area.cubre) chicas.push(`${c.name || c.id}: área ${Math.round(area.alto)} px, cubre el cuadradito: ${area.cubre}`);
    }
    return chicas;
  });
}

test("mesa del salón en celular: la única tarjeta ocupa todo el ancho y «Continuar pedido» cabe en un renglón con el ícono separado del borde", async ({ paginaAutenticada: page, sucursalId }) => {
  const numero = 9000 + Math.floor(Math.random() * 900);
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero } });
  const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id } });
  try {
    await fijarCelular(page);
    await page.goto(`/mesas?q=${numero}`);
    const tarjeta = page.locator(`[data-mesa="${numero}"]`);
    await expect(tarjeta).toBeVisible();
    await capturar(page, "mesa-tarjeta-unica");
    const lista = (await page.getByRole("list", { name: "Mesas" }).boundingBox())!;
    const caja = (await tarjeta.boundingBox())!;
    expect.soft(caja.width, "la única mesa ocupa todo el ancho de la lista").toBeGreaterThanOrEqual(lista.width - 2);
    const boton = tarjeta.getByRole("link", { name: "Continuar pedido" });
    const cajaBoton = (await boton.boundingBox())!;
    expect.soft(cajaBoton.height, "«Continuar pedido» en un solo renglón").toBeLessThan(60);
    const icono = (await boton.locator("svg").first().boundingBox())!;
    expect.soft(icono.x - cajaBoton.x, "el ícono no toca el borde izquierdo del botón").toBeGreaterThanOrEqual(8);
    await expectSinDesborde(page, "mapa de mesas");
  } finally {
    await prismaAdmin.cuenta.deleteMany({ where: { id: cuenta.id } });
    await prismaAdmin.mesa.deleteMany({ where: { id: mesa.id } });
  }
});

test("Historial de traspasos en celular: tarjetas con cada dato rotulado y sin desborde", async ({ paginaAutenticada: page, sucursalId }) => {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const otra = await prisma.sucursal.create({ data: { nombre: `E2E Historial B ${marca}` } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-HT-${marca}`, nombre: `E2E Harina historial ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  const traspaso = await prisma.traspasoSucursal.create({
    data: { origenSucursalId: otra.id, destinoSucursalId: sucursalId, productoId: producto.id, cantidad: 3, creadoPorId: admin.id, iniciadoPor: "DESTINO", estado: "CANCELADA", cerradoPorId: admin.id },
  });
  try {
    await fijarCelular(page);
    await page.goto("/traspasos");
    const historial = page.getByRole("list", { name: "Historial de traspasos" });
    await expect(historial.getByText(producto.nombre)).toBeVisible();
    await capturar(page, "traspasos-historial");
    for (const rotulo of ["Producto", "Cantidad", "Otra sucursal", "Estado", "Detalle"]) await expect(historial.getByText(rotulo, { exact: true }).first()).toBeVisible();
    await expectSinDesborde(page, "traspasos › historial");
    expect((await new AxeBuilder({ page }).analyze()).violations, "axe en traspasos").toEqual([]);
  } finally {
    await prisma.traspasoSucursal.deleteMany({ where: { id: traspaso.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
    await prisma.sucursal.deleteMany({ where: { id: otra.id } });
  }
});

test("tablas que se desplazan de costado muestran sombra donde hay más para ver (usuarios, roles)", async ({ paginaAutenticada: page }) => {
  await fijarCelular(page);
  for (const ruta of ["/administracion/usuarios", "/administracion/roles"]) {
    await page.goto(ruta);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const caja = page.locator("[role=group].overflow-x-auto").first();
    await expect(caja).toBeVisible();
    const m = await caja.evaluate((el) => {
      const c = getComputedStyle(el);
      return { desplaza: el.scrollWidth > el.clientWidth, imagen: c.backgroundImage, adjuntos: c.backgroundAttachment };
    });
    expect(m.desplaza, `${ruta}: la tabla se desplaza de costado a 375 px`).toBe(true);
    expect(m.imagen, `${ruta}: con sombra de aviso`).toContain("linear-gradient");
    expect(m.adjuntos, `${ruta}: tapas que se mueven con el contenido y sombras fijas`).toBe("local, local, scroll, scroll");
    await capturar(page, `tabla-${ruta.split("/").pop()}`);
    await expectSinDesborde(page, ruta);
  }
});

test("controles táctiles: enlaces de texto sueltos y casillas con 44 px de área", async ({ paginaAutenticada: page }) => {
  await fijarCelular(page);
  await page.goto("/catalogo/productos/nuevo");
  await expectObjetivosTactiles(page.getByRole("link", { name: "← Productos" }), "nuevo producto: «← Productos»", { ancho: 44 });
  await page.goto("/carta/parametrizacion/promociones");
  await expect(page.getByRole("heading", { name: "Promos", exact: true })).toBeVisible();
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
  expect(await medirAreaDeCasillas(page), "casillas de promociones: área táctil").toEqual([]);
  await page.goto("/carta");
  await expect(page.getByRole("heading", { name: "Carta", level: 1 })).toBeVisible();
  await expectObjetivosTactiles(page.getByRole("link", { name: "Opciones agotadas" }), "carta › Hoy: «Opciones agotadas»");
});

test("«Duplicar» dice «Duplicando…» mientras el servidor trabaja", async ({ paginaAutenticada: page, sucursalId }) => {
  const marca = `${Date.now()}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const origen = await prisma.producto.create({ data: { codigo: `E2E-DUPL-${marca}`, nombre: `E2E Para duplicar ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 1000 } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: origen.id, disponible: true } });
  const nuevoNombre = `E2E Duplicado ${marca}`;
  try {
    await fijarCelular(page);
    // Se retrasa la respuesta del servidor para poder ver el estado «en curso».
    await page.route("**/catalogo/productos/**", async (ruta) => {
      if (ruta.request().method() === "POST") await new Promise((r) => setTimeout(r, 2500));
      await ruta.continue();
    });
    await page.goto(`/catalogo/productos/${origen.id}`);
    await page.locator("[data-duplicar-producto]").click();
    const dialogo = page.getByRole("dialog", { name: `Duplicar «${origen.nombre}»` });
    await dialogo.getByLabel("Nombre del producto nuevo").fill(nuevoNombre);
    await dialogo.locator("[data-confirmar-duplicar]").click();
    await expect(dialogo.getByRole("button", { name: "Duplicando…" })).toBeVisible();
    await capturar(page, "duplicando");
    await expect(dialogo.getByRole("button", { name: "Duplicando…" })).toHaveCount(0, { timeout: 15000 });
    await expect(dialogo.locator("[data-abrir-duplicado]")).toBeVisible();
  } finally {
    const duplicado = await prisma.producto.findFirst({ where: { nombre: nuevoNombre } });
    const ids = [origen.id, ...(duplicado ? [duplicado.id] : [])];
    await prismaAdmin.registroAuditoria.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: ids } } });
    await prismaAdmin.producto.deleteMany({ where: { id: { in: ids } } });
  }
});
