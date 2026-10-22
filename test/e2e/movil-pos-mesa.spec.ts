import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { prismaAdmin } from "../setup/cliente-duenio";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";
import { borrarRecetasDeReventa, darRecetaDeReventa } from "../setup/receta-de-venta";
import { capturar, expectObjetivosTactiles, expectSinDesborde, expectSinDesbordeEn, fijarCelular } from "./fixtures/movil";

/**
 * MOVIL (pase visual en celular, 375 × 812): la pantalla de la mesa del salón no se sale por la derecha en ninguna de sus etapas y sus botones de línea se tocan con el
 * dedo. El defecto que se midió con capturas reales: con una línea con opciones («Café · Grande · Con leche» y un adicional) en «Por agregar», la página medía 437 px en
 * un celular de 375 (380 con un producto sin opciones): el `<fieldset>` del formulario tiene por defecto `min-width: min-content`, y la fila de controles (−, cantidad, +,
 * importe, «Otro igual», «Quitar») no se partía, así que ensanchaba todo. Además «Otro igual» y «Anular» medían 29–32 px de alto.
 *
 * Mide, no mira: `scrollWidth <= clientWidth` de la página en cada etapa (mesa vacía, «Por agregar» con y sin opciones, «Sin enviar», envío en cocina, los diálogos de
 * «Elegir opciones», «Anular» y «Cerrar cuenta») y el alto/ancho de los botones de cada línea (>= 44 px). La mesa vive en el marco del salón: no tiene menú lateral.
 */

async function sembrar(sucursalId: string, numero: number) {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const molido = await prisma.producto.create({ data: { codigo: `E2E-MV-MOLIDO-${m}`, nombre: `E2E Molido móvil ${m}`, tipo: "MP", unidadStockId: kg.id } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: molido.id, disponible: true } });
  const tamano = await sembrarGrupo({ nombre: `E2E Tamaño móvil ${m}`, tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Mediano", factorEscala: 1 }, { nombre: "Grande", monto: 300, factorEscala: 1.5 }] });
  const leche = await sembrarGrupo({ nombre: `E2E Leche móvil ${m}`, tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Con leche" }, { nombre: "Sin leche" }] });
  const extras = await sembrarGrupo({ nombre: `E2E Extras móvil ${m}`, tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 2, marca: m, opciones: [{ nombre: "Medialuna extra", monto: 600, conAncla: true }] });
  const nombreCafe = `E2E Café móvil ${m}`;
  const { productoId: cafeId } = await sembrarProductoConOpciones({ nombre: nombreCafe, codigo: `E2E-MV-CAFE-${m}`, precioVenta: 2500, sucursalId, grupos: [{ grupo: tamano }, { grupo: leche }, { grupo: extras }] });
  const anclaId = extras.opciones["Medialuna extra"]!.anclaId!;
  for (const productoId of [cafeId, anclaId]) await prisma.recetaVersion.create({ data: { productoId, version: 1, ingredientes: { create: [{ insumoProductoId: molido.id, cantidad: 0.01, unidadId: kg.id }] } } });
  const nombreFlan = `E2E Flan móvil ${m}`;
  const flan = await prisma.producto.create({ data: { codigo: `E2E-MV-FLAN-${m}`, nombre: nombreFlan, tipo: "PV", unidadStockId: unidad.id, precioVenta: 3500 } });
  const mpFlan = await darRecetaDeReventa(prisma, flan, { sucursalIds: [sucursalId] });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: flan.id, disponible: true } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Cafetería móvil ${m}`, orden: 1 } });
  await prisma.contenidoCartaProducto.createMany({
    data: [
      { sucursalId, productoId: cafeId, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 1 },
      { sucursalId, productoId: flan.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 2 },
    ],
  });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero } });
  const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id } });
  return {
    nombreCafe,
    nombreFlan,
    seccion,
    mesa,
    cuenta,
    limpiar: async () => {
      const items = await prismaAdmin.cuentaItem.findMany({ where: { cuenta: { mesaId: mesa.id } }, select: { operacionId: true } });
      const operacionIds = [...new Set(items.flatMap((i) => (i.operacionId ? [i.operacionId] : [])))];
      const cuentaIds = (await prismaAdmin.cuenta.findMany({ where: { mesaId: mesa.id }, select: { id: true } })).map((c) => c.id);
      await prismaAdmin.opcionElegidaEnLinea.deleteMany({ where: { cuentaItem: { cuentaId: { in: cuentaIds } } } });
      await prismaAdmin.cuentaItem.deleteMany({ where: { cuentaId: { in: cuentaIds }, anulaAItemId: { not: null } } });
      await prismaAdmin.cuentaItem.deleteMany({ where: { cuentaId: { in: cuentaIds }, lineaPadreId: { not: null } } });
      await prismaAdmin.cuentaItem.deleteMany({ where: { cuentaId: { in: cuentaIds } } });
      await prismaAdmin.registroAuditoria.deleteMany({ where: { entidadId: { in: [...operacionIds, ...cuentaIds] } } });
      await prismaAdmin.movimientoStock.deleteMany({ where: { operacionId: { in: operacionIds } } });
      await prismaAdmin.operacion.deleteMany({ where: { id: { in: operacionIds } } });
      await prismaAdmin.ejemplarTicket.deleteMany({ where: { cuentaId: { in: cuentaIds }, corrigeAId: { not: null } } });
      await prismaAdmin.ejemplarTicket.deleteMany({ where: { cuentaId: { in: cuentaIds } } });
      await prismaAdmin.agregadoDeCuenta.deleteMany({ where: { cuentaId: { in: cuentaIds } } });
      await prismaAdmin.cuenta.deleteMany({ where: { id: { in: cuentaIds } } });
      await prismaAdmin.mesa.deleteMany({ where: { id: mesa.id } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { seccionCartaId: seccion.id } });
      await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
      await borrarRecetasDeReventa(prisma, { pvIds: [flan.id], mpIds: [mpFlan.id] });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: flan.id } });
      await prisma.producto.deleteMany({ where: { id: flan.id } });
    },
  };
}

const aviso = (page: Page) => page.locator('[role="status"][aria-live="polite"]');

test("mesa del salón en celular (375 px): sin scroll horizontal en ninguna etapa y botones de línea de 44 px", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrar(sucursalId, 7900 + Math.floor(Math.random() * 90));
  try {
    await fijarCelular(page);
    await page.goto(`/mesas/${d.mesa.id}`);
    await expect(page.getByRole("heading", { name: `Mesa ${d.mesa.numero}` })).toBeVisible();
    await capturar(page, "pos-mesa-vacia");
    await expectSinDesborde(page, "mesa vacía");

    // «Elegir opciones»: el diálogo (hoja inferior en celular) tampoco se corta.
    await page.getByRole("group", { name: "Secciones de la carta" }).getByRole("button", { name: d.seccion.nombre }).click();
    await page.getByRole("region", { name: d.seccion.nombre }).getByRole("button", { name: new RegExp(`^${d.nombreCafe}`) }).click();
    const dialogo = page.getByRole("dialog", { name: d.nombreCafe });
    await dialogo.getByRole("radio", { name: /Grande/ }).check();
    await dialogo.getByRole("radio", { name: /Con leche/ }).check();
    await dialogo.getByRole("button", { name: "Sumar uno de Medialuna extra" }).click();
    await capturar(page, "pos-mesa-elegir-opciones");
    await expectSinDesborde(page, "diálogo «Elegir opciones»");
    await expectSinDesbordeEn(dialogo, "diálogo «Elegir opciones»");
    await dialogo.getByRole("button", { name: /^Agregar/ }).click();
    await expect(dialogo).toBeHidden();

    // Un producto SIN opciones al lado (380 px medía la página con uno solo).
    await page.getByRole("region", { name: d.seccion.nombre }).getByRole("button", { name: new RegExp(`^${d.nombreFlan}`) }).click();

    // «Por agregar» con una línea con opciones y adicional + una sin opciones.
    const porAgregar = page.locator("[data-linea-por-agregar]");
    await expect(porAgregar).toHaveCount(2);
    await capturar(page, "pos-mesa-por-agregar");
    await expectSinDesborde(page, "«Por agregar» con opciones, adicional y un producto sin opciones");
    await expectObjetivosTactiles(porAgregar.locator("button"), "«Por agregar»: botones de línea");
    await expectObjetivosTactiles(porAgregar.locator("input"), "«Por agregar»: cantidad", { alto: 44, ancho: 44 });
    expect((await new AxeBuilder({ page }).analyze()).violations, "«Por agregar» en celular").toEqual([]);

    await page.getByRole("button", { name: "Agregar 2 al pedido" }).click();
    await expect(aviso(page)).toContainText("Se agregaron 2");

    // «Sin enviar».
    await expect(page.getByRole("heading", { name: "Sin enviar · 2" })).toBeVisible();
    await capturar(page, "pos-mesa-sin-enviar");
    await expectSinDesborde(page, "«Sin enviar»");
    await expectObjetivosTactiles(page.locator("[data-item-sin-enviar] button"), "«Sin enviar»: botones de línea («Otro igual», «Quitar»)");

    // Envío en cocina: «Otro igual» y «Anular» por línea.
    await page.getByRole("button", { name: "Enviar a cocina" }).click();
    await expect(page.getByRole("heading", { name: "Envío 1 · en cocina" })).toBeVisible();
    await capturar(page, "pos-mesa-enviado-a-cocina");
    await expectSinDesborde(page, "envío en cocina");
    const enviadas = page.locator("[data-item-enviado]");
    await expect(enviadas.getByRole("button", { name: /^Otro igual a / })).toHaveCount(1);
    await expect(enviadas.getByRole("button", { name: /^Anular / })).toHaveCount(2);
    await expectObjetivosTactiles(enviadas.locator("button"), "envío: «Otro igual» y «Anular» de cada línea");
    expect((await new AxeBuilder({ page }).analyze()).violations, "envío en cocina en celular").toEqual([]);

    // Los diálogos de «Anular» y de «Cerrar cuenta».
    await enviadas.getByRole("button", { name: `Anular ${d.nombreFlan}` }).click();
    const anular = page.getByRole("dialog", { name: /^Anular/ });
    await expect(anular).toBeVisible();
    await capturar(page, "pos-mesa-anular");
    await expectSinDesborde(page, "diálogo «Anular»");
    await expectSinDesbordeEn(anular, "diálogo «Anular»");
    await anular.getByRole("button", { name: "Cancelar" }).click();
    await page.getByRole("button", { name: "Cerrar cuenta" }).click();
    const cierre = page.getByRole("dialog", { name: /^Cerrar cuenta/ });
    await expect(cierre).toBeVisible();
    await capturar(page, "pos-mesa-cerrar-cuenta");
    await expectSinDesborde(page, "diálogo «Cerrar cuenta»");
    await expectSinDesbordeEn(cierre, "diálogo «Cerrar cuenta»");
  } finally {
    await d.limpiar();
  }
});

test("mapa del salón en celular (375 px): «Facturar» y «Ver pedidos» quedan dentro de la tarjeta angosta; a 1280 px van en fila", async ({ paginaAutenticada: page, sucursalId }) => {
  const numero = 7600 + Math.floor(Math.random() * 300);
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-MV-TAC-${Date.now()}`, nombre: `E2E Táctil ${Date.now()}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 4500 } });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero } });
  await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id, items: { create: [{ productoId: producto.id, cantidad: 1, precioUnitario: 4500, numeroEnvio: 1, creadoPorId: admin.id }] } } });
  const tarjeta = page.locator(`li[data-mesa="${numero}"]`);
  try {
    await fijarCelular(page);
    await page.goto("/mesas");
    await expect(tarjeta).toBeVisible();
    await capturar(page, "pos-mapa-facturar");
    await expectSinDesborde(page, "mapa de mesas");
    // «Facturar» y «Ver pedidos» quedan DENTRO de la tarjeta (antes «Facturar» se cortaba por la derecha).
    const caja = (await tarjeta.boundingBox())!;
    for (const nombre of ["Ver pedidos", "Facturar"]) {
      const b = (await tarjeta.getByRole("link", { name: nombre }).boundingBox())!;
      expect.soft(b.x, `«${nombre}» no se sale por la izquierda de la tarjeta`).toBeGreaterThanOrEqual(caja.x - 0.5);
      expect.soft(b.x + b.width, `«${nombre}» no se sale por la derecha de la tarjeta`).toBeLessThanOrEqual(caja.x + caja.width + 0.5);
    }

    // En pantalla ancha los dos botones siguen lado a lado.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/mesas");
    const verPedidos = (await tarjeta.getByRole("link", { name: "Ver pedidos" }).boundingBox())!;
    const facturar = (await tarjeta.getByRole("link", { name: "Facturar" }).boundingBox())!;
    expect(Math.abs(verPedidos.y - facturar.y), "a 1280 px «Ver pedidos» y «Facturar» van en la misma fila").toBeLessThanOrEqual(2);
    expect(verPedidos.x + verPedidos.width, "y no se pisan").toBeLessThanOrEqual(facturar.x);
  } finally {
    const cuentaIds = (await prisma.cuenta.findMany({ where: { mesaId: mesa.id }, select: { id: true } })).map((c) => c.id);
    await prisma.cuentaItem.deleteMany({ where: { cuentaId: { in: cuentaIds } } });
    await prisma.cuenta.deleteMany({ where: { id: { in: cuentaIds } } });
    await prisma.mesa.deleteMany({ where: { id: mesa.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});
