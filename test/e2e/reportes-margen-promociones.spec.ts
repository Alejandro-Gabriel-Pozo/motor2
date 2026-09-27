import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * `/reportes/margen-promociones` (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 12): contra Postgres real, sembrando
 * directo una `PromoCuenta` ya cerrada con sus componentes (mismo criterio que reportes-costo-de-lo-vendido.spec.ts — no hace
 * falta pasar por el POS entero: el prorrateo en sí ya lo cubre test/pos/promo-combo.test.ts, y el motor de este reporte
 * test/reportes/margen-promociones.test.ts).
 *
 * VENTANA DE FECHAS PROPIA (mayo de 2024, que ningún otro spec toca): la Pizza (carta $12.000) y el Flan (carta $3.000) se
 * cobran prorrateados a $9.600/$2.400 dentro de una promo de $12.000 — $3.000 (20%) de ahorro para el cliente contra pedirlos
 * sueltos (D3).
 */
async function sembrar(sucursalId: string, seccionId: string) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const unidad = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "unidad" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const pizza = await prisma.producto.create({ data: { codigo: `E2E-MP-PIZZA-${marca}`, nombre: `E2E Pizza Margen ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 12000 } });
  const flan = await prisma.producto.create({ data: { codigo: `E2E-MP-FLAN-${marca}`, nombre: `E2E Flan Margen ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 3000 } });

  const seccionCarta = await prisma.seccionCarta.create({ data: { nombre: `E2E Menús Margen ${marca}` } });
  const titulo = `E2E Combo Margen ${marca}`;
  const promo = await prisma.promoCarta.create({ data: { sucursalId, seccionCartaId: seccionCarta.id, titulo, precio: 12000 } });

  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 941 } });
  const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id, cerradaEn: new Date("2024-05-06T12:00:00Z"), cerradaPorId: admin.id } });
  const promoCuenta = await prisma.promoCuenta.create({ data: { cuentaId: cuenta.id, promoCartaId: promo.id, precio: 12000, titulo, creadoPorId: admin.id } });

  const operacionIds: string[] = [];
  async function componente(productoId: string, precioCobrado: number, precioCarta: number) {
    const op = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: new Date("2024-05-06T12:00:00Z"), usuarioId: admin.id, promoCuentaId: promoCuenta.id } });
    operacionIds.push(op.id);
    await prisma.cuentaItem.create({
      data: { cuentaId: cuenta.id, productoId, cantidad: 1, precioUnitario: precioCobrado, numeroEnvio: 1, creadoPorId: admin.id, promoCuentaId: promoCuenta.id, precioCartaUnitario: precioCarta, operacionId: op.id },
    });
    await prisma.movimientoStock.create({
      data: { operacionId: op.id, productoId, seccionId, proceso: "VENTA", cantidad: -1, detalle: "Venta", precioTotal: precioCobrado, precioPorUnidadStock: precioCobrado, costoUnitarioVenta: null },
    });
  }
  await componente(pizza.id, 9600, 12000);
  await componente(flan.id, 2400, 3000);

  return {
    titulo,
    limpiar: async () => {
      await prisma.movimientoStock.deleteMany({ where: { operacionId: { in: operacionIds } } });
      await prisma.cuentaItem.deleteMany({ where: { cuentaId: cuenta.id } });
      await prisma.operacion.deleteMany({ where: { id: { in: operacionIds } } });
      await prisma.promoCuenta.deleteMany({ where: { id: promoCuenta.id } });
      await prisma.cuenta.deleteMany({ where: { id: cuenta.id } });
      await prisma.mesa.deleteMany({ where: { id: mesa.id } });
      await prisma.promoCarta.deleteMany({ where: { id: promo.id } });
      await prisma.seccionCarta.deleteMany({ where: { id: seccionCarta.id } });
      await prisma.producto.deleteMany({ where: { id: { in: [pizza.id, flan.id] } } });
    },
  };
}

const VENTANA = "/reportes/margen-promociones?desde=2024-05-01&hasta=2024-05-31";

test("muestra la promo con su ingreso a lista, lo cobrado y el ahorro del cliente (D3)", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const { titulo, limpiar } = await sembrar(sucursalId, seccionId);
  try {
    await page.goto(VENTANA);
    await expect(page.getByRole("heading", { name: "Margen de promociones" })).toBeVisible();
    await expect(page.getByText("1 promos vendidas")).toBeVisible();
    await expect(page.getByText("$15.000 de carta")).toBeVisible();
    await expect(page.getByText("$12.000 cobrados")).toBeVisible();
    await expect(page.getByText("$3.000 de ahorro para el cliente")).toBeVisible();

    const fila = page.getByRole("row", { name: new RegExp(titulo) });
    await expect(fila).toContainText("1 veces");
    await expect(fila).toContainText("$15.000");
    await expect(fila).toContainText("$12.000");
    await expect(fila).toContainText("$3.000 (20%)");

    // Cruza con el otro reporte de "promociones" (rebajas de precio, sin componentes) — la aclaración evita confundirlos.
    await page.getByRole("link", { name: /Ver también «Promociones»/ }).click();
    await expect(page.getByRole("heading", { name: "Promociones y Combos" })).toBeVisible();
  } finally {
    await limpiar();
  }
});

test("accesibilidad: sin violaciones con datos reales en la tabla", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const { titulo, limpiar } = await sembrar(sucursalId, seccionId);
  try {
    await page.goto(VENTANA);
    await expect(page.getByText(titulo)).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations, "/reportes/margen-promociones con una fila real").toEqual([]);
  } finally {
    await limpiar();
  }
});
