import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { prismaAdmin } from "../setup/cliente-duenio";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";

/**
 * Ventas con opciones, paso 2 (diseño 2026-10-29), en el POS: una «Gaseosa» que se vende por opción y NO tiene receta propia. Con «Coca» (la opción suma una botella) se agrega a la cuenta (antes daba «no tiene
 * receta»); con «Fanta» (sin consumo cargado) el servidor la rechaza con un mensaje que nombra la opción y dice dónde se arregla, y la lista «Por agregar» queda intacta. Lo sembrado de opciones no se
 * borra (ver `fixtures/opciones.ts`); las cuentas sí.
 */
async function sembrar(sucursalId: string) {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const botella = await prisma.producto.create({ data: { codigo: `E2E-GSR-BOTELLA-${m}`, nombre: `E2E Coca botella ${m}`, tipo: "MP", unidadStockId: unidad.id } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: botella.id, disponible: true } });
  const marca = await sembrarGrupo({
    nombre: `E2E Marca ${m}`,
    tipo: "VARIANTE",
    cantidadMinima: 1,
    cantidadMaxima: 1,
    marca: m,
    opciones: [{ nombre: "Coca", consumos: [{ insumoProductoId: botella.id, cantidad: 1 }] }, { nombre: "Fanta" }],
  });
  const nombre = `E2E Gaseosa 500 cc ${m}`;
  const { productoId } = await sembrarProductoConOpciones({ nombre, codigo: `E2E-GSR-${m}`, precioVenta: 2500, sucursalId, grupos: [{ grupo: marca }] });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Bebidas GSR ${m}`, orden: 1 } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 1 } });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 5000 + Math.floor(Math.random() * 4000) } });
  const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id } });
  return {
    nombre,
    seccion,
    mesa,
    cuenta,
    limpiar: async () => {
      await prismaAdmin.opcionElegidaEnLinea.deleteMany({ where: { cuentaItem: { cuentaId: cuenta.id } } });
      await prismaAdmin.cuentaItem.deleteMany({ where: { cuentaId: cuenta.id } });
      await prismaAdmin.agregadoDeCuenta.deleteMany({ where: { cuentaId: cuenta.id } });
      await prisma.cuenta.deleteMany({ where: { id: cuenta.id } });
      await prisma.mesa.deleteMany({ where: { id: mesa.id } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { seccionCartaId: seccion.id } });
      await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
    },
  };
}

async function elegir(page: Page, d: Awaited<ReturnType<typeof sembrar>>, opcion: string) {
  await page.goto(`/mesas/${d.mesa.id}`);
  await page.getByRole("group", { name: "Secciones de la carta" }).getByRole("button", { name: d.seccion.nombre }).click();
  await page.getByRole("region", { name: d.seccion.nombre }).getByRole("button", { name: new RegExp(`^${d.nombre}`) }).click();
  const dialogo = page.getByRole("dialog", { name: d.nombre });
  await dialogo.getByRole("radio", { name: new RegExp(opcion) }).check();
  await dialogo.getByRole("button", { name: /^Agregar/ }).click();
  await expect(page.locator(`[data-linea-por-agregar="${d.nombre} · ${opcion}"]`)).toBeVisible();
}

test("una base sin receta con «Coca» (suma una botella) se agrega a la cuenta", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrar(sucursalId);
  try {
    await elegir(page, d, "Coca");
    await page.getByRole("button", { name: "Agregar 1 al pedido" }).click();
    await expect(page.locator("[data-linea-por-agregar]")).toHaveCount(0);
    const items = await prisma.cuentaItem.findMany({ where: { cuentaId: d.cuenta.id }, select: { cantidad: true, precioUnitario: true, opcionesElegidas: { select: { nombreOpcion: true } } } });
    expect(items.map((i) => [Number(i.cantidad), Number(i.precioUnitario), i.opcionesElegidas.map((o) => o.nombreOpcion)])).toEqual([[1, 2500, ["Coca"]]]);
  } finally {
    await d.limpiar();
  }
});

test("con «Fanta» (sin consumo cargado) el servidor la rechaza nombrando la opción; no se agrega nada y la lista queda intacta", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrar(sucursalId);
  try {
    await elegir(page, d, "Fanta");
    await page.getByRole("button", { name: "Agregar 1 al pedido" }).click();
    await expect(page.getByRole("alert").filter({ hasText: `“${d.nombre}” con “Fanta” no descuenta ningún insumo` })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Biblioteca de opciones" })).toBeVisible();
    await expect(page.locator(`[data-linea-por-agregar="${d.nombre} · Fanta"]`)).toBeVisible();
    expect(await prisma.cuentaItem.count({ where: { cuentaId: d.cuenta.id } })).toBe(0);
  } finally {
    await d.limpiar();
  }
});
