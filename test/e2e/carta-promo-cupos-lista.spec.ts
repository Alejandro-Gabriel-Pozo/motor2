import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { SUMAR_LUGAR_DE_LISTA_VISIBLE } from "../../src/core/carta/cupos-de-promo";
import { prismaAdmin } from "../setup/cliente-duenio";
import { borrarRecetasDeReventa, darRecetaDeReventa } from "../setup/receta-de-venta";

/**
 * GO-3b (ADR-032, F6 paso U1): los LUGARES de entradas de una promo en la administración de la carta. Fija: sumar un lugar «lista» con el formulario de cupos, sumarle un producto (queda FIJO:
 * una entrada y mínimo = máximo), que volver a guardar los cupos NO da de baja el lugar (la lista que se guarda es la final, de todos los tipos), destildarlo lo da de baja sin borrar su entrada, la
 * vigencia por días de la semana, el doble clic y axe con la promo abierta.
 */
async function sembrar(sucursalId: string) {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const seccionE2E = await prisma.seccion.findFirstOrThrow({ where: { sucursalId, nombre: "Depósito E2E" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const gaseosa = await prisma.producto.create({ data: { codigo: `E2E-CL-GAS-${m}`, nombre: `E2E Gaseosa CL ${m}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 1500 } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: gaseosa.id, disponible: true } });
  const reventa = await darRecetaDeReventa(prisma, gaseosa, { sucursalIds: [sucursalId], stock: { cantidad: 100, seccionIds: [seccionE2E.id], usuarioId: admin.id } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Menús CL ${m}`, orden: 1 } });
  const titulo = `E2E Combo CL ${m}`;
  const promo = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId, activa: true } }, seccionCartaId: seccion.id, titulo, precio: 5000 } });
  return {
    m,
    gaseosa,
    titulo,
    promo,
    limpiar: async () => {
      await prismaAdmin.registroAuditoria.deleteMany({ where: { entidadId: { startsWith: promo.id } } });
      await prismaAdmin.entradaDeCupo.deleteMany({ where: { cupo: { promoCartaId: promo.id } } });
      await prismaAdmin.promoCartaCupo.deleteMany({ where: { promoCartaId: promo.id } });
      await prisma.promoCartaSucursal.deleteMany({ where: { promoCartaId: promo.id } });
      await prisma.promoCarta.deleteMany({ where: { id: promo.id } });
      await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
      await borrarRecetasDeReventa(prisma, { pvIds: [gaseosa.id], mpIds: [reventa.id] });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: gaseosa.id } });
      await prisma.producto.deleteMany({ where: { id: gaseosa.id } });
    },
  };
}

test("un lugar «lista» con su entrada (queda fijo); volver a guardar los cupos no lo da de baja; destildarlo sí, sin borrar la entrada; la vigencia por días", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrar(sucursalId);
  try {
    // CARTA-MANT: las promos viven en Parametrización › Promociones.
    await page.goto("/carta/parametrizacion/promociones");
    const promo = page.locator(`[data-promo-carta="${d.titulo}"]`);
    await promo.locator("summary").first().click();
    if (SUMAR_LUGAR_DE_LISTA_VISIBLE) {
      await promo.locator('input[name="nuevo_lugar_nombre"]').fill("Bebida");
      await promo.getByRole("button", { name: "Guardar cupos" }).dblclick();
    } else {
      // Decisión del dueño (2026-10-28): «Sumar un lugar» está oculto en la pantalla (`SUMAR_LUGAR_DE_LISTA_VISIBLE`). El lugar se siembra como si ya existiera: lo que sigue (sumarle un producto,
      // volver a guardar, destildarlo) es lo que la pantalla sigue permitiendo con los lugares que ya existían.
      await expect(promo.locator('input[name="nuevo_lugar_nombre"]')).toHaveCount(0);
      await prisma.promoCartaCupo.create({ data: { promoCartaId: d.promo.id, tipo: "LISTA", nombre: "Bebida", cantidadMinima: 1, cantidadMaxima: 1, orden: 1 } });
    }
    await expect.poll(async () => prisma.promoCartaCupo.count({ where: { promoCartaId: d.promo.id, tipo: "LISTA", activo: true } })).toBe(1);

    await page.reload();
    const otraVez = page.locator(`[data-promo-carta="${d.titulo}"]`);
    await otraVez.locator("summary").first().click();
    const agregar = otraVez.locator('[data-agregar-entrada="Bebida"]');
    await agregar.locator("select").first().selectOption({ label: d.gaseosa.nombre });
    await agregar.getByRole("button", { name: "Sumar" }).click();
    await expect(agregar.getByRole("status")).toBeVisible();
    await expect.poll(async () => prisma.entradaDeCupo.count({ where: { cupo: { promoCartaId: d.promo.id } } })).toBe(1);

    await page.reload();
    const conEntrada = page.locator(`[data-promo-carta="${d.titulo}"]`);
    await conEntrada.locator("summary").first().click();
    await expect(conEntrada.locator('[data-lugar-de-combo="Bebida"]')).toContainText("viene fijo");
    expect((await new AxeBuilder({ page }).include(`[data-promo-carta="${d.titulo}"]`).analyze()).violations).toEqual([]);

    // Volver a guardar los cupos (sin tocar nada): el lugar sigue activo.
    await conEntrada.getByRole("button", { name: "Guardar cupos" }).click();
    await expect(conEntrada.getByRole("status").first()).toBeVisible();
    expect(await prisma.promoCartaCupo.count({ where: { promoCartaId: d.promo.id, tipo: "LISTA", activo: true } })).toBe(1);

    // La vigencia: sin el domingo.
    await conEntrada.locator('input[name="dia_6"]').uncheck();
    await conEntrada.getByRole("button", { name: "Guardar vigencia" }).click();
    await expect.poll(async () => (await prisma.promoCarta.findUniqueOrThrow({ where: { id: d.promo.id } })).diasDeSemana).toBe(63);

    // Destildarlo lo da de baja; la entrada queda guardada.
    await page.reload();
    const deNuevo = page.locator(`[data-promo-carta="${d.titulo}"]`);
    await deNuevo.locator("summary").first().click();
    await deNuevo.locator('[data-cupo-lugar="Bebida"] input[type="checkbox"]').uncheck();
    await deNuevo.getByRole("button", { name: "Guardar cupos" }).click();
    await expect.poll(async () => prisma.promoCartaCupo.count({ where: { promoCartaId: d.promo.id, tipo: "LISTA", activo: true } })).toBe(0);
    expect(await prisma.entradaDeCupo.count({ where: { cupo: { promoCartaId: d.promo.id } } })).toBe(1);
  } finally {
    await d.limpiar();
  }
});
