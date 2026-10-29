import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { borrarRecetasDeReventa, darRecetaDeReventa } from "../setup/receta-de-venta";
import { MENU_DEL_DIA_VISIBLE } from "../../src/core/carta/menu-del-dia";

/**
 * «Menú del día: lo que ya se puede hacer sin rediseño» (docs/diseno-modulo-carta-2026-10-28.md §12; instrucción del dueño del 2026-10-28), de punta a punta y con el interruptor del menú del día
 * APAGADO (`MENU_DEL_DIA_VISIBLE = false`: este recorrido NO lo usa):
 *  (a) el PLATO DEL DÍA es un producto de venta común (con receta y precio propio), disponible en la sucursal y SIN contenido de carta: la administración lo cuenta en «Fuera de carta (POS y menú del
 *      día)», la carta PÚBLICA nunca lo muestra y el mozo lo encuentra en el POS, en la pestaña «Fuera de carta» de la mesa;
 *  «hoy»: se apaga desde Catálogo › Productos y el POS deja de ofrecerlo (la disponibilidad NO vence sola: si nadie lo apaga, al día siguiente sigue; se vuelve a prender desde el mismo botón);
 *  (b) el MENÚ EJECUTIVO es una promo «solo salón» armada con un cupo de sección: el POS la ofrece y la carta pública no.
 * Garantía: si una regresión hiciera salir el plato fuera de carta o la promo «solo salón» en la carta pública, o lo sacara del POS, este spec queda en rojo.
 */
const EMPRESA = "e2e";
const barra = (page: Page) => page.getByRole("group", { name: "Secciones de la carta" });

async function sembrar(sucursalId: string) {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const deposito = await prisma.seccion.findFirstOrThrow({ where: { sucursalId, nombre: "Depósito E2E" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const reventa = { sucursalIds: [sucursalId], stock: { cantidad: 100, seccionIds: [deposito.id], usuarioId: admin.id } };
  // (a) El plato del día: un PV común con receta y precio propio, disponible acá, SIN contenido de carta.
  const plato = await prisma.producto.create({ data: { codigo: `E2E-PDD-${m}`, nombre: `E2E Guiso del día ${m}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 9500 } });
  const platoMp = await darRecetaDeReventa(prisma, plato, reventa);
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: plato.id, disponible: true } });
  // Una bebida en la carta (la sección del cupo del menú) y el menú ejecutivo «solo salón».
  const bebida = await prisma.producto.create({ data: { codigo: `E2E-PDD-BEB-${m}`, nombre: `E2E Agua del menú ${m}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 2000 } });
  const bebidaMp = await darRecetaDeReventa(prisma, bebida, reventa);
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: bebida.id, disponible: true } });
  const bebidas = await prisma.seccionCarta.create({ data: { nombre: `E2E Bebidas PDD ${m}`, orden: 1 } });
  const menus = await prisma.seccionCarta.create({ data: { nombre: `E2E Menús PDD ${m}`, orden: 2 } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: bebida.id, visibleEnCarta: true, seccionCartaId: bebidas.id } });
  const tituloMenu = `E2E Menú ejecutivo ${m}`;
  const promo = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId } }, seccionCartaId: menus.id, titulo: tituloMenu, precio: 12000, soloSalon: true } });
  await prisma.promoCartaCupo.create({ data: { promoCartaId: promo.id, seccionCartaId: bebidas.id, cantidadMinima: 1, cantidadMaxima: 1 } });
  const slug = `e2e-pdd-${m}`;
  await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 994 } });
  await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id } });
  return {
    plato,
    bebidas,
    menus,
    tituloMenu,
    slug,
    mesa,
    limpiar: async () => {
      await prisma.cuenta.deleteMany({ where: { mesaId: mesa.id } });
      await prisma.mesa.deleteMany({ where: { id: mesa.id } });
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
      await prisma.promoCartaCupo.deleteMany({ where: { promoCartaId: promo.id } });
      await prisma.promoCartaSucursal.deleteMany({ where: { promoCartaId: promo.id } });
      await prisma.promoCarta.deleteMany({ where: { id: promo.id } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: { in: [plato.id, bebida.id] } } });
      await prisma.seccionCarta.deleteMany({ where: { id: { in: [bebidas.id, menus.id] } } });
      await borrarRecetasDeReventa(prisma, { pvIds: [plato.id, bebida.id], mpIds: [platoMp.id, bebidaMp.id] });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: [plato.id, bebida.id] } } });
      await prisma.producto.deleteMany({ where: { id: { in: [plato.id, bebida.id] } } });
    },
  };
}

test("menú del día sin rediseño: el plato del día fuera de carta se vende en el POS y no sale en la carta pública; «hoy» se apaga y se prende a mano; el menú «solo salón» solo en el POS", async ({ page, paginaAutenticada, sucursalId }) => {
  test.setTimeout(120_000);
  expect(MENU_DEL_DIA_VISIBLE, "este recorrido es el de SIN rediseño: con el interruptor apagado").toBe(false);
  const d = await sembrar(sucursalId);
  try {
    // La carta PÚBLICA (sin sesión): ni el plato del día ni el menú «solo salón»; la bebida, sí.
    await page.goto(`/carta-publica/${EMPRESA}/${d.slug}`);
    await expect(page.getByRole("button", { name: new RegExp(d.bebidas.nombre) })).toHaveCount(1);
    await expect(page.getByText(d.plato.nombre)).toHaveCount(0);
    await expect(page.getByText(d.tituloMenu)).toHaveCount(0);
    await expect(page.getByRole("button", { name: new RegExp(d.menus.nombre) })).toHaveCount(0);

    // La administración lo cuenta en «Fuera de carta (POS y menú del día)» (Carta › Hoy › Visibilidad).
    await paginaAutenticada.goto("/carta?nivel=visibilidad");
    await expect(paginaAutenticada.locator("main")).toContainText("Fuera de carta");

    // El mozo: en la mesa, la pestaña «Fuera de carta» tiene el plato del día y la sección del menú tiene el menú ejecutivo.
    await paginaAutenticada.goto(`/mesas/${d.mesa.id}`);
    await barra(paginaAutenticada).getByRole("button", { name: "Fuera de carta" }).click();
    await expect(paginaAutenticada.getByRole("region", { name: "Fuera de carta" }).getByRole("button", { name: new RegExp(d.plato.nombre) })).toBeVisible();
    await barra(paginaAutenticada).getByRole("button", { name: d.menus.nombre }).click();
    await expect(paginaAutenticada.getByRole("region", { name: d.menus.nombre }).getByRole("button", { name: d.tituloMenu })).toBeVisible();

    // «Hoy» se terminó: se apaga desde Catálogo › Productos (no vence solo) y el POS deja de ofrecerlo.
    await paginaAutenticada.goto(`/catalogo/productos/${d.plato.id}`);
    await paginaAutenticada.getByRole("button", { name: "Desactivar", exact: true }).click();
    await paginaAutenticada.getByRole("button", { name: "Sí, desactivar" }).click();
    await expect(paginaAutenticada.getByText(/No disponible en/)).toBeVisible();
    await paginaAutenticada.goto(`/mesas/${d.mesa.id}`);
    await expect(paginaAutenticada.getByRole("button", { name: new RegExp(d.plato.nombre) })).toHaveCount(0);

    // Otro día se vuelve a prender desde el mismo lugar y el mozo lo vuelve a ver.
    await paginaAutenticada.goto(`/catalogo/productos/${d.plato.id}`);
    await paginaAutenticada.getByRole("button", { name: "Activar", exact: true }).click();
    await expect.poll(async () => (await prisma.disponibilidadProducto.findFirst({ where: { sucursalId, productoId: d.plato.id } }))?.disponible).toBe(true);
    await paginaAutenticada.goto(`/mesas/${d.mesa.id}`);
    await barra(paginaAutenticada).getByRole("button", { name: "Fuera de carta" }).click();
    await expect(paginaAutenticada.getByRole("region", { name: "Fuera de carta" }).getByRole("button", { name: new RegExp(d.plato.nombre) })).toBeVisible();

    // Y la carta pública sigue sin mostrarlo.
    await page.goto(`/carta-publica/${EMPRESA}/${d.slug}`);
    await expect(page.getByText(d.plato.nombre)).toHaveCount(0);
  } finally {
    await d.limpiar();
  }
});
