import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { prismaAdmin } from "../setup/cliente-duenio";
import { borrarRecetasDeReventa, darRecetaDeReventa } from "../setup/receta-de-venta";
import { MENU_DEL_DIA_VISIBLE } from "../../src/core/carta/menu-del-dia";
import { diaDeCalendario, fechaDeColumnaDate, ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";

/**
 * GO-3b (ADR-032, F6 paso U5): el MENÚ DEL DÍA en la pantalla de la mesa. La promo se arma con su plato de HOY (el lugar del día), un postre FIJO (lo completa el servidor: «Viene con») y una
 * bebida elegida de una lista; se agrega a «Por agregar» y, al confirmar, sus componentes quedan colgados de la promo con el reparto exacto del precio. Fija también: sin plato cargado no se puede
 * armar (lo dice), el doble clic agrega una sola vez, el celular, el teclado y axe con el diálogo abierto.
 *
 * Siembra en «Central» una sección «E2E Menús» (con la gaseosa visible: la promo vive ahí) y la promo «E2E Menú» de $ 10.000 con tres cupos de entradas; cada caso limpia lo suyo en `finally`.
 */

// Interruptor del menú del día (`MENU_DEL_DIA_VISIBLE`, decisión del dueño 2026-10-20): mientras esté apagado, no se pueden armar lugares «del día» en una promo, así que el POS no tiene menú del día que vender. Encendido, este spec vuelve a correr entero.
test.skip(!MENU_DEL_DIA_VISIBLE, "el menú del día está apagado (MENU_DEL_DIA_VISIBLE = false en src/core/carta/menu-del-dia.ts): no se pueden armar lugares «del día» en una promo, así que el POS no tiene menú del día que vender");

const barra = (page: Page) => page.getByRole("group", { name: "Secciones de la carta" });

async function sembrar(sucursalId: string, conPlato = true) {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const seccionE2E = await prisma.seccion.findFirstOrThrow({ where: { sucursalId, nombre: "Depósito E2E" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const reventas: { pv: string; mp: string }[] = [];
  const crear = async (clave: string, nombre: string, precioVenta: number) => {
    const p = await prisma.producto.create({ data: { codigo: `E2E-MD-${clave}-${m}`, nombre: `E2E ${nombre} ${m}`, tipo: "PV", unidadStockId: unidad.id, precioVenta } });
    reventas.push({ pv: p.id, mp: (await darRecetaDeReventa(prisma, p, { sucursalIds: [sucursalId], stock: { cantidad: 1000, seccionIds: [seccionE2E.id], usuarioId: admin.id } })).id });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
    return p;
  };
  const milanesa = await crear("MILA", "Milanesa", 9000);
  const flan = await crear("FLAN", "Flan", 3000);
  const agua = await crear("AGUA", "Agua", 1000);
  const gaseosa = await crear("GASEOSA", "Gaseosa", 1500);
  const productoIds = [milanesa, flan, agua, gaseosa].map((p) => p.id);
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Menús ${m}`, orden: 1 } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: gaseosa.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 1 } });
  const titulo = `E2E Menú ${m}`;
  const promo = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId } }, seccionCartaId: seccion.id, titulo, precio: 10000 } });
  const cupo = (tipo: "LISTA" | "DEL_DIA", nombre: string, orden: number) => prisma.promoCartaCupo.create({ data: { promoCartaId: promo.id, tipo, nombre, orden, cantidadMinima: 1, cantidadMaxima: 1 } });
  const plato = await cupo("DEL_DIA", "Plato del día", 0);
  const postre = await cupo("LISTA", "Postre", 1);
  const bebida = await cupo("LISTA", "Bebida", 2);
  // La empresa de las pruebas está en la zona de Buenos Aires (la de siempre): «hoy» es el de esa zona.
  if (conPlato) await prisma.entradaDelDiaDeCupo.create({ data: { cupoId: plato.id, sucursalId, fecha: fechaDeColumnaDate(diaDeCalendario(new Date(), ZONA_ARGENTINA)), productoId: milanesa.id, actualizadoPorId: admin.id } });
  await prisma.entradaDeCupo.create({ data: { cupoId: postre.id, productoId: flan.id } });
  await prisma.entradaDeCupo.createMany({ data: [{ cupoId: bebida.id, productoId: agua.id, orden: 0 }, { cupoId: bebida.id, productoId: gaseosa.id, orden: 1 }] });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 6000 + Math.floor(Math.random() * 3000) } });
  const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id } });
  return {
    milanesa,
    flan,
    agua,
    gaseosa,
    seccion,
    titulo,
    promo,
    mesa,
    cuenta,
    limpiar: async () => {
      await prisma.cuentaItem.deleteMany({ where: { cuentaId: cuenta.id } });
      await prisma.promoCuenta.deleteMany({ where: { cuentaId: cuenta.id } });
      await prismaAdmin.agregadoDeCuenta.deleteMany({ where: { cuentaId: cuenta.id } });
      await prisma.cuenta.deleteMany({ where: { id: cuenta.id } });
      await prisma.mesa.deleteMany({ where: { id: mesa.id } });
      // Las entradas y los cupos no se borran desde la app (solo se dan de baja): se limpian como dueño.
      await prismaAdmin.entradaDelDiaDeCupo.deleteMany({ where: { cupoId: plato.id } });
      await prismaAdmin.entradaDeCupo.deleteMany({ where: { cupoId: { in: [postre.id, bebida.id] } } });
      await prismaAdmin.promoCartaCupo.deleteMany({ where: { promoCartaId: promo.id } });
      await prisma.promoCartaSucursal.deleteMany({ where: { promoCartaId: promo.id } });
      await prisma.promoCarta.deleteMany({ where: { id: promo.id } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { seccionCartaId: seccion.id } });
      await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
      await borrarRecetasDeReventa(prisma, { pvIds: reventas.map((r) => r.pv), mpIds: reventas.map((r) => r.mp) });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: productoIds } } });
      await prisma.producto.deleteMany({ where: { id: { in: productoIds } } });
    },
  };
}

async function abrirMenu(page: Page, d: Awaited<ReturnType<typeof sembrar>>) {
  await page.goto(`/mesas/${d.mesa.id}`);
  await barra(page).getByRole("button", { name: d.seccion.nombre }).click();
  await page.getByRole("region", { name: d.seccion.nombre }).getByRole("button", { name: d.titulo }).click();
  return page.getByRole("dialog", { name: `Armar «${d.titulo}»` });
}

test("el menú del día: el plato de hoy, el postre fijo («Viene con») y la bebida; se agrega UNA vez aunque se toque dos, con el reparto exacto", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrar(sucursalId);
  try {
    const dialogo = await abrirMenu(page, d);
    await expect(dialogo.getByText(`Viene con: ${d.flan.nombre}`)).toBeVisible();
    const agregarPromo = dialogo.getByRole("button", { name: "Agregar promo" });
    await expect(agregarPromo).toBeDisabled();
    await dialogo.getByRole("button", { name: `Sumar ${d.milanesa.nombre} a Plato del día` }).click();
    await expect(agregarPromo).toBeDisabled();
    await dialogo.getByRole("button", { name: `Sumar ${d.gaseosa.nombre} a Bebida` }).click();
    await expect(dialogo.getByRole("button", { name: `Sumar ${d.agua.nombre} a Bebida` })).toBeDisabled();
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
    await agregarPromo.click();
    await expect(page.locator(`[data-promo-por-agregar="${d.titulo}"]`)).toBeVisible();

    const confirmar = page.getByRole("button", { name: /^Agregar 1 al pedido$/ });
    await confirmar.dblclick();
    await expect.poll(async () => prisma.promoCuenta.count({ where: { cuentaId: d.cuenta.id } })).toBe(1);
    const lineas = await prisma.cuentaItem.findMany({ where: { cuentaId: d.cuenta.id }, orderBy: { precioUnitario: "desc" } });
    // 10000 repartido sobre 9000 + 3000 + 1500 = 13500: 6666,67 + 2222,22 + 1111,11.
    expect(lineas.map((l) => [l.productoId, Number(l.precioUnitario), Number(l.precioCartaUnitario)])).toEqual([
      [d.milanesa.id, 6666.67, 9000],
      [d.flan.id, 2222.22, 3000],
      [d.gaseosa.id, 1111.11, 1500],
    ]);
    expect(new Set(lineas.map((l) => l.promoCuentaId)).size).toBe(1);
  } finally {
    await d.limpiar();
  }
});

test("sin plato del día cargado: el lugar lo dice y no se puede armar (en el celular, con el teclado)", async ({ paginaAutenticada: page, sucursalId }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const d = await sembrar(sucursalId, false);
  try {
    const dialogo = await abrirMenu(page, d);
    await expect(dialogo.getByText("Todavía no se cargó el plato de hoy.")).toBeVisible();
    await dialogo.getByRole("button", { name: `Sumar ${d.agua.nombre} a Bebida` }).focus();
    await page.keyboard.press("Enter");
    await expect(dialogo.getByRole("button", { name: "Agregar promo" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialogo).toBeHidden();
  } finally {
    await d.limpiar();
  }
});
