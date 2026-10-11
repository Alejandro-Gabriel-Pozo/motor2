import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";

/**
 * P17 (decisión del dueño, 2026-10-11): una sección de stock dada de baja solo admite SACAR mercadería (consumir, mermar o transferir) hasta vaciarla. El servidor lo controla
 * (`registrarMovimientoCasoDeUso`); acá, lo que ve la persona: las pantallas de Merma, Consumo, Transferencia (solo el ORIGEN) y «Enviar una transferencia directo» ofrecen la sección
 * dada de baja con la etiqueta «(desactivada)» para poder vaciarla, y las pantallas donde entra mercadería (Compra, y el destino de una Transferencia) NO la ofrecen.
 *
 * Nombres con marca (`Date.now()`): varios specs comparten la base E2E en una corrida. Cada caso limpia lo suyo en `finally`.
 */

async function sembrar(sucursalId: string, stock: number) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const [kg, admin] = await Promise.all([prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } }), prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } })]);
  const mp = await prisma.producto.create({ data: { codigo: `E2E-SD-${marca}`, nombre: `E2E SD Harina ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: mp.id, disponible: true } });
  const baja = await prisma.seccion.create({ data: { sucursalId, nombre: `E2E SD Baja ${marca}`, activa: false } });
  if (stock) {
    const operacion = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: admin.id } });
    await prisma.movimientoStock.create({
      data: { operacionId: operacion.id, productoId: mp.id, seccionId: baja.id, proceso: "COMPRA", cantidad: stock, detalle: "Stock inicial del test", precioTotal: 0, precioPorUnidadStock: 0 },
    });
  }
  return {
    mp,
    baja,
    etiqueta: `${baja.nombre} (desactivada)`,
    limpiar: async () => {
      const operaciones = await prisma.movimientoStock.findMany({ where: { productoId: mp.id }, select: { operacionId: true } });
      const ids = [...new Set(operaciones.map((m) => m.operacionId))];
      await prisma.movimientoStock.deleteMany({ where: { productoId: mp.id } });
      await prisma.operacion.deleteMany({ where: { id: { in: ids } } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: mp.id } });
      await prisma.producto.deleteMany({ where: { id: mp.id } });
      await prisma.seccion.deleteMany({ where: { id: baja.id } });
    },
  };
}

async function elegirProducto(page: Page, nombre: string) {
  const combo = page.getByRole("combobox", { name: "Producto" });
  await combo.fill(nombre);
  await page.getByRole("option", { name: new RegExp(nombre) }).click();
}

test("merma: la sección dada de baja se ofrece como «(desactivada)» y se puede vaciar; en Compra no se ofrece", async ({ paginaAutenticada: page, sucursalId }) => {
  const s = await sembrar(sucursalId, 10);
  try {
    await page.goto("/movimientos/merma");
    const seccion = page.getByLabel("Sección", { exact: true });
    await seccion.selectOption({ label: s.etiqueta });
    await elegirProducto(page, s.mp.nombre);
    await page.getByLabel("Cantidad").fill("10");
    await page.getByLabel("Motivo").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();

    await expect(page.getByText(/Se guardaron 1 movimiento/)).toBeVisible();
    expect(await calcularSaldoTotal(s.mp.id, s.baja.id, prisma)).toBe(0);

    // Donde entra mercadería no se ofrece: Compra.
    await page.goto("/movimientos/compra");
    await expect(page.getByLabel("Sección", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Sección", { exact: true }).locator("option", { hasText: s.baja.nombre })).toHaveCount(0);
  } finally {
    await s.limpiar();
  }
});

test("consumo: la sección dada de baja se ofrece como origen con la etiqueta «(desactivada)»", async ({ paginaAutenticada: page, sucursalId }) => {
  const s = await sembrar(sucursalId, 10);
  try {
    await page.goto("/movimientos/consumo");
    await expect(page.getByLabel("Sección", { exact: true }).locator("option", { hasText: s.etiqueta })).toHaveCount(1);
  } finally {
    await s.limpiar();
  }
});

test("transferencia entre secciones: la dada de baja se ofrece como ORIGEN pero no como DESTINO", async ({ paginaAutenticada: page, sucursalId }) => {
  const s = await sembrar(sucursalId, 10);
  try {
    await page.goto("/movimientos/transferencia");
    await expect(page.getByLabel("Sección origen", { exact: true }).locator("option", { hasText: s.etiqueta })).toHaveCount(1);
    await expect(page.getByLabel("Sección destino", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Sección destino", { exact: true }).locator("option", { hasText: s.baja.nombre })).toHaveCount(0);
  } finally {
    await s.limpiar();
  }
});

test("enviar una transferencia directo: la sección dada de baja se ofrece como origen con la etiqueta «(desactivada)»", async ({ paginaAutenticada: page, sucursalId }) => {
  const s = await sembrar(sucursalId, 10);
  try {
    await page.goto("/traspasos/enviar");
    await expect(page.getByLabel(/^Sección propia de la que sale/).locator("option", { hasText: s.etiqueta })).toHaveCount(1);
  } finally {
    await s.limpiar();
  }
});
