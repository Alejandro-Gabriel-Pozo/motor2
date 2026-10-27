import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { prismaAdmin } from "../setup/cliente-duenio";
import { borrarRecetasDeReventa, darRecetaDeReventa } from "../setup/receta-de-venta";

/**
 * Interruptor «solo salón» de las promos (docs/diseno-promo-solo-salon-2026-10-26.md, paso 7), de punta a punta: desde Parametrización › Promociones se prende «Solo salón» en una promo y, en el próximo pedido, la carta PÚBLICA deja de mostrarla
 * (y su sección, que solo la tenía) mientras el POS (la pantalla de la mesa) la sigue ofreciendo en su sección; apagarlo la devuelve a la carta. El cambio queda auditado (quién, de qué a qué), la versión sube, y un segundo clic al guardar lo mismo no
 * duplica la auditoría. Sin sesión ni permiso nada de esto se ve en la carta: la carta pública no pide nunca el salón (guardián de arquitectura).
 *
 * Siembra en «Central» una sección «E2E Platos» con una Empanada, una sección «E2E Pactado» que solo tiene la promo «E2E Combo pactado» ($ 4.000, un cupo de «Platos»), la carta pública publicada y una mesa con la cuenta abierta. Limpia lo suyo en `finally`.
 */
const EMPRESA = "e2e";
const barra = (page: Page) => page.getByRole("group", { name: "Secciones de la carta" });

async function sembrar(sucursalId: string) {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const seccionE2E = await prisma.seccion.findFirstOrThrow({ where: { sucursalId, nombre: "Depósito E2E" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const empanada = await prisma.producto.create({ data: { codigo: `E2E-SS-EMPA-${m}`, nombre: `E2E Empanada SS ${m}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 2000 } });
  const reventa = await darRecetaDeReventa(prisma, empanada, { sucursalIds: [sucursalId], stock: { cantidad: 100, seccionIds: [seccionE2E.id], usuarioId: admin.id } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: empanada.id, disponible: true } });
  const platos = await prisma.seccionCarta.create({ data: { nombre: `E2E Platos SS ${m}`, orden: 1 } });
  const pactado = await prisma.seccionCarta.create({ data: { nombre: `E2E Pactado SS ${m}`, orden: 2 } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: empanada.id, visibleEnCarta: true, seccionCartaId: platos.id } });
  const titulo = `E2E Combo pactado ${m}`;
  const promo = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId } }, seccionCartaId: pactado.id, titulo, precio: 4000 } });
  await prisma.promoCartaCupo.create({ data: { promoCartaId: promo.id, seccionCartaId: platos.id, cantidadMinima: 1, cantidadMaxima: 1 } });
  const slug = `e2e-solo-salon-${m}`;
  await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 993 } });
  await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id } });
  return {
    titulo,
    promo,
    platos,
    pactado,
    slug,
    mesa,
    limpiar: async () => {
      await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "PromoCarta", entidadId: promo.id } });
      await prisma.cuenta.deleteMany({ where: { mesaId: mesa.id } });
      await prisma.mesa.deleteMany({ where: { id: mesa.id } });
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
      await prisma.promoCartaCupo.deleteMany({ where: { promoCartaId: promo.id } });
      await prisma.promoCartaSucursal.deleteMany({ where: { promoCartaId: promo.id } });
      await prisma.promoCarta.deleteMany({ where: { id: promo.id } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: empanada.id } });
      await prisma.seccionCarta.deleteMany({ where: { id: { in: [platos.id, pactado.id] } } });
      await borrarRecetasDeReventa(prisma, { pvIds: [empanada.id], mpIds: [reventa.id] });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: empanada.id } });
      await prisma.producto.deleteMany({ where: { id: empanada.id } });
    },
  };
}

test("«solo salón»: la carta pública deja de mostrar la promo y su sección, el POS la sigue ofreciendo; apagarlo la devuelve; queda auditado", async ({ page, paginaAutenticada, sucursalId }) => {
  const d = await sembrar(sucursalId);
  const enLaCartaPublica = async () => {
    await page.goto(`/carta-publica/${EMPRESA}/${d.slug}`);
    return page.getByRole("button", { name: new RegExp(d.pactado.nombre) });
  };
  try {
    // Antes: la carta pública muestra la sección y la promo.
    await (await enLaCartaPublica()).click();
    await expect(page.getByText(d.titulo)).toBeVisible();

    // El admin prende «Solo salón» (la casilla y su botón) y guarda.
    await paginaAutenticada.goto("/carta/parametrizacion/promociones");
    const promo = paginaAutenticada.locator(`[data-promo-carta="${d.titulo}"]`);
    await promo.locator("summary").first().click();
    await expect(promo.locator("summary").first()).not.toContainText("solo salón");
    const casilla = promo.getByRole("checkbox", { name: /Solo salón: se vende desde el POS/ });
    await expect(casilla).not.toBeChecked();
    await casilla.check();
    await promo.getByRole("button", { name: "Guardar dónde se ve" }).click();
    await expect(promo.locator("[data-donde-se-ve]").getByRole("status").first()).toBeVisible();
    await expect.poll(async () => (await prisma.promoCarta.findUniqueOrThrow({ where: { id: d.promo.id } })).soloSalon).toBe(true);
    expect((await prisma.promoCarta.findUniqueOrThrow({ where: { id: d.promo.id } })).version).toBe(2);

    // Después: la carta pública ya no muestra ni la promo ni la sección que solo la tenía.
    await expect(await enLaCartaPublica()).toHaveCount(0);
    await expect(page.getByText(d.titulo)).toHaveCount(0);

    // El POS sí: la sección y la promo siguen en la pantalla de la mesa.
    await paginaAutenticada.goto(`/mesas/${d.mesa.id}`);
    await barra(paginaAutenticada).getByRole("button", { name: d.pactado.nombre }).click();
    await expect(paginaAutenticada.getByRole("region", { name: d.pactado.nombre }).getByRole("button", { name: d.titulo })).toBeVisible();

    // Auditoría: una fila (quién, de qué a qué), y guardar lo mismo otra vez no la duplica.
    await paginaAutenticada.goto("/carta/parametrizacion/promociones");
    const otraVez = paginaAutenticada.locator(`[data-promo-carta="${d.titulo}"]`);
    await expect(otraVez.locator("summary").first()).toContainText("solo salón");
    await otraVez.locator("summary").first().click();
    await expect(otraVez.getByRole("checkbox", { name: /Solo salón: se vende desde el POS/ })).toBeChecked();
    await otraVez.getByRole("button", { name: "Guardar dónde se ve" }).dblclick();
    await expect(otraVez.locator("[data-donde-se-ve]").getByRole("status").first()).toBeVisible();
    const filas = await prismaAdmin.registroAuditoria.findMany({ where: { entidad: "PromoCarta", entidadId: d.promo.id, campo: "soloSalon" } });
    expect(filas.map((f) => [f.valorAnterior, f.valorNuevo])).toEqual([["false", "true"]]);
    expect((await prisma.promoCarta.findUniqueOrThrow({ where: { id: d.promo.id } })).version).toBe(2);

    // Apagarlo devuelve la promo a la carta pública.
    await otraVez.getByRole("checkbox", { name: /Solo salón: se vende desde el POS/ }).uncheck();
    await otraVez.getByRole("button", { name: "Guardar dónde se ve" }).click();
    await expect.poll(async () => (await prisma.promoCarta.findUniqueOrThrow({ where: { id: d.promo.id } })).soloSalon).toBe(false);
    await (await enLaCartaPublica()).click();
    await expect(page.getByText(d.titulo)).toBeVisible();
  } finally {
    await d.limpiar();
  }
});
