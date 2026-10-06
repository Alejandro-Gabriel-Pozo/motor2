import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { prismaAdmin } from "../setup/cliente-duenio";

/**
 * Anular una venta desde «Trazabilidad» (Fase 4 del plan de pureza, tramo A: red de seguridad ANTES de mover la venta; hasta acá ningún e2e anulaba una venta).
 * Se siembra una venta (la fila VENTA y el CONSUMO de su insumo) directo en la base, con un producto propio de cada prueba (marca única). Cada prueba limpia lo que creó.
 */
async function sembrarVenta(sucursalId: string, seccionId: string) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const insumo = await prisma.producto.create({ data: { codigo: `E2E-AV-I-${marca}`, nombre: `E2E Queso Anular Venta ${marca}`, tipo: "MP", unidadStockId: unidad.id } });
  const plato = await prisma.producto.create({ data: { codigo: `E2E-AV-P-${marca}`, nombre: `E2E Pizza Anular Venta ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 5000 } });
  // Stock inicial: 10 kg comprados; la venta consume 2 y deja 8.
  const compra = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date("2026-08-10T12:00:00Z"), usuarioId: admin.id } });
  await prisma.movimientoStock.create({ data: { operacionId: compra.id, productoId: insumo.id, seccionId, proceso: "COMPRA", cantidad: 10, precioTotal: 1000, precioPorUnidadStock: 100, detalle: "Compra" } });
  const venta = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: new Date("2026-08-11T12:00:00Z"), usuarioId: admin.id } });
  await prisma.movimientoStock.create({ data: { operacionId: venta.id, productoId: insumo.id, seccionId, proceso: "CONSUMO", cantidad: -2, precioTotal: 0, precioPorUnidadStock: 0, detalle: "Consumo por venta" } });
  await prisma.movimientoStock.create({ data: { operacionId: venta.id, productoId: plato.id, seccionId, proceso: "VENTA", cantidad: -1, precioTotal: 5000, precioPorUnidadStock: 5000, detalle: "Venta" } });

  const limpiar = async () => {
    const reversiones = await prisma.operacion.findMany({ where: { detalleLibre: { contains: venta.id } }, select: { id: true } });
    const ids = (await prisma.movimientoStock.findMany({ where: { productoId: { in: [insumo.id, plato.id] } }, select: { operacionId: true } })).map((m) => m.operacionId);
    await prisma.movimientoStock.deleteMany({ where: { productoId: { in: [insumo.id, plato.id] } } });
    await prisma.operacion.deleteMany({ where: { id: { in: [...new Set([...ids, ...reversiones.map((r) => r.id)])] } } });
    await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "Operacion", entidadId: venta.id } });
    await prisma.producto.deleteMany({ where: { id: { in: [insumo.id, plato.id] } } });
  };
  const saldoDelInsumo = async () => Number((await prisma.movimientoStock.aggregate({ where: { productoId: insumo.id }, _sum: { cantidad: true } }))._sum.cantidad ?? 0);
  return { venta, insumo, plato, limpiar, saldoDelInsumo };
}

test("se anula una venta desde su trazabilidad, con confirmación: el insumo vuelve al stock y la operación queda marcada", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const v = await sembrarVenta(sucursalId, seccionId);
  try {
    expect(await v.saldoDelInsumo()).toBe(8);
    await page.goto(`/reportes/trazabilidad?idOperacion=${v.venta.id}`);
    await expect(page.getByRole("heading", { name: /^Operación / })).toBeVisible();
    await expect(page.getByText(/Anulada el/)).toHaveCount(0);

    // Volver cancela la confirmación y no anula nada.
    await page.getByRole("button", { name: "Anular venta" }).click();
    await expect(page.getByText("¿Anular esta venta?")).toBeVisible();
    await page.getByRole("button", { name: "Volver" }).click();
    await expect(page.getByText("¿Anular esta venta?")).toHaveCount(0);
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: v.venta.id } })).anuladaEn).toBeNull();

    // Confirmar.
    await page.getByRole("button", { name: "Anular venta" }).click();
    await page.getByRole("button", { name: "Sí, anular" }).click();
    await expect(page.getByText(/Anulada el/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Anular venta" })).toHaveCount(0);

    // En la base: marcada, el insumo vuelve a 10, un solo AJUSTE de reversión y una sola fila de auditoría.
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: v.venta.id } })).anuladaEn).not.toBeNull();
    expect(await v.saldoDelInsumo()).toBe(10);
    expect(await prisma.operacion.count({ where: { proceso: "AJUSTE", detalleLibre: { contains: v.venta.id } } })).toBe(1);
    expect(await prismaAdmin.registroAuditoria.count({ where: { entidad: "Operacion", entidadId: v.venta.id } })).toBe(1);

    // Recargar: sigue marcada como anulada y sin el botón.
    await page.reload();
    await expect(page.getByText(/Anulada el/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Anular venta" })).toHaveCount(0);
  } finally {
    await v.limpiar();
  }
});

test("una venta ya anulada por otra persona: al confirmar se ve el aviso y no se revierte dos veces", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const v = await sembrarVenta(sucursalId, seccionId);
  try {
    await page.goto(`/reportes/trazabilidad?idOperacion=${v.venta.id}`);
    await page.getByRole("button", { name: "Anular venta" }).click();

    // Mientras la confirmación está abierta, otra persona anula la misma venta (se simula con la propia acción, en la base).
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
    await prisma.operacion.update({ where: { id: v.venta.id }, data: { anuladaEn: new Date(), anuladaPorId: admin.id } });

    await page.getByRole("button", { name: "Sí, anular" }).click();
    await expect(page.getByText("Esta venta ya está anulada.")).toBeVisible();
    expect(await prisma.operacion.count({ where: { proceso: "AJUSTE", detalleLibre: { contains: v.venta.id } } })).toBe(0);
    expect(await v.saldoDelInsumo()).toBe(8); // nada se revirtió por esta vía
  } finally {
    await v.limpiar();
  }
});
