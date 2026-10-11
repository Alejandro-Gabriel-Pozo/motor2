import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * Período y Tickets cortan el día en la zona de la empresa (P1, O.251): una venta del POS de las 22:30 argentinas del 31/12 (01:30 UTC del 1/1, cambio de año) tiene que verse en el día
 * 31/12 en «Reporte por período» y en «Tickets emitidos», y NO en el 1/1. El servidor del E2E corre en UTC, así que el desfase se ve: con el corte anterior de Período (UTC) la misma venta
 * aparecía en el 1/1.
 *
 * Se siembra directo con Prisma (producto único, mesa, cuenta cerrada, venta, ejemplar de ticket con el MISMO instante, como `cerrarCuenta`): lo que se ejercita es la PANTALLA, desde la
 * URL con `desde`/`hasta`; el corte contra la base lo cubre test/reportes/periodo-y-tickets-mismo-dia.test.ts. El instante es de un año pasado: no se vuelve falso con el paso del tiempo.
 */
const A_LAS_2230_DEL_31_DIC = new Date("2025-12-31T22:30:00-03:00"); // 2026-01-01T01:30:00Z

test("Período y Tickets: la venta de las 22:30 argentinas del 31/12 está el 31/12 y no el 1/1, en las dos pantallas", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-PTD-${marca}`, nombre: `E2E Periodo Tickets Dia ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 5000 } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 951 } });
  const venta = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: A_LAS_2230_DEL_31_DIC, usuarioId: admin.id, detalleLibre: "Mesa E2E PTD" } });
  await prisma.movimientoStock.create({
    data: { operacionId: venta.id, productoId: producto.id, seccionId, proceso: "VENTA", cantidad: -1, detalle: "Venta", precioTotal: 5000, precioPorUnidadStock: 5000 },
  });
  const cuenta = await prisma.cuenta.create({
    data: {
      mesaId: mesa.id,
      abiertaPorId: admin.id,
      cerradaEn: A_LAS_2230_DEL_31_DIC,
      cerradaPorId: admin.id,
      items: { create: [{ productoId: producto.id, cantidad: 1, precioUnitario: 5000, numeroEnvio: 1, operacionId: venta.id, creadoPorId: admin.id }] },
    },
  });
  const ejemplar = await prisma.ejemplarTicket.create({
    data: { sucursalId, cuentaId: cuenta.id, numero: 200001, emitidoEn: A_LAS_2230_DEL_31_DIC, emitidoPorId: admin.id },
  });
  try {
    // El 31/12: la venta está en Período (la fila de su producto) y en Tickets (el ejemplar).
    await page.goto("/reportes/periodo?desde=2025-12-31&hasta=2025-12-31");
    await expect(page.getByRole("heading", { name: "Reporte por período" })).toBeVisible();
    await expect(page.getByRole("link", { name: producto.nombre })).toBeVisible();
    await page.goto(`/reportes/tickets?mesaId=${mesa.id}&desde=2025-12-31&hasta=2025-12-31`);
    await expect(page.getByRole("heading", { name: "Tickets emitidos" })).toBeVisible();
    await expect(page.locator(`[data-ticket="${ejemplar.id}"]`)).toBeVisible();

    // El 1/1: en ninguna de las dos.
    await page.goto("/reportes/periodo?desde=2026-01-01&hasta=2026-01-01");
    await expect(page.getByRole("heading", { name: "Reporte por período" })).toBeVisible();
    await expect(page.getByRole("link", { name: producto.nombre })).toHaveCount(0);
    await page.goto(`/reportes/tickets?mesaId=${mesa.id}&desde=2026-01-01&hasta=2026-01-01`);
    await expect(page.getByRole("heading", { name: "Tickets emitidos" })).toBeVisible();
    await expect(page.locator(`[data-ticket="${ejemplar.id}"]`)).toHaveCount(0);
  } finally {
    await prisma.cuentaItem.deleteMany({ where: { cuentaId: cuenta.id } });
    await prisma.ejemplarTicket.deleteMany({ where: { cuentaId: cuenta.id } });
    await prisma.cuenta.deleteMany({ where: { id: cuenta.id } });
    await prisma.movimientoStock.deleteMany({ where: { operacionId: venta.id } });
    await prisma.operacion.deleteMany({ where: { id: venta.id } });
    await prisma.mesa.deleteMany({ where: { id: mesa.id } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});
