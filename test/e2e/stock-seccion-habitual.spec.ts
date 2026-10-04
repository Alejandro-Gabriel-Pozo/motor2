import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { interceptarImpresion } from "./fixtures/impresion";
import { prismaAdmin } from "../setup/cliente-duenio";

/**
 * Sección habitual de un PV (docs/plan-seccion-habitual-stock-2026-09-25.md): la pantalla Stock › Sección habitual (configurar, editar y
 * quitar) y su efecto en el cierre de cuenta del salón — con la habitual en una sección SIN muzza y la muzza en otra, la cuenta se cierra
 * sin aviso, el consumo sale de la otra y la fila VENTA queda en la habitual.
 *
 * Nombres con marca (`Date.now()`): varios specs comparten la base E2E en una corrida. Cada caso limpia lo suyo en `finally`.
 */

async function sembrar(sucursalId: string) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const [unidad, kg] = await Promise.all([prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } }), prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } })]);
  const crear = async (data: Parameters<typeof prisma.producto.create>[0]["data"]) => {
    const p = await prisma.producto.create({ data });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
    return p;
  };
  const muzzarella = await crear({ codigo: `E2E-SH-MUZZA-${marca}`, nombre: `E2E SH Muzzarella ${marca}`, tipo: "MP", unidadStockId: kg.id });
  const pizza = await crear({ codigo: `E2E-SH-PIZZA-${marca}`, nombre: `E2E SH Pizza ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 12000 });
  await prisma.recetaVersion.create({ data: { productoId: pizza.id, version: 1, ingredientes: { create: [{ insumoProductoId: muzzarella.id, cantidad: 0.25, unidadId: kg.id }] } } });
  const cocina = await prisma.seccion.create({ data: { sucursalId, nombre: `E2E SH Cocina ${marca}` } });
  const deposito = await prisma.seccion.create({ data: { sucursalId, nombre: `E2E SH Depósito ${marca}` } });
  const productoIds = [muzzarella.id, pizza.id];
  return {
    muzzarella,
    pizza,
    cocina,
    deposito,
    limpiar: async (mesaIds: string[] = []) => {
      const items = await prisma.cuentaItem.findMany({ where: { cuenta: { mesaId: { in: mesaIds } } }, select: { operacionId: true } });
      const operacionIds = [...new Set(items.flatMap((i) => (i.operacionId ? [i.operacionId] : [])))];
      const movimientos = await prisma.movimientoStock.findMany({ where: { productoId: { in: productoIds } }, select: { operacionId: true } });
      const todas = [...new Set([...operacionIds, ...movimientos.map((m) => m.operacionId)])];
      await prisma.cuentaItem.deleteMany({ where: { cuenta: { mesaId: { in: mesaIds } } } });
      await prismaAdmin.registroAuditoria.deleteMany({ where: { entidadId: { in: todas } } });
      await prisma.movimientoStock.deleteMany({ where: { operacionId: { in: todas } } });
      await prisma.operacion.deleteMany({ where: { id: { in: todas } } });
      // docs/plan-numeracion-ticket-2026-09-25.md: cerrar la cuenta emite un EjemplarTicket (FK RESTRICT hacia Cuenta) — hay que
      // borrarlo antes (las correcciones, con corrigeAId, antes que el original al que apuntan).
      await prisma.ejemplarTicket.deleteMany({ where: { cuenta: { mesaId: { in: mesaIds } }, corrigeAId: { not: null } } });
      await prisma.ejemplarTicket.deleteMany({ where: { cuenta: { mesaId: { in: mesaIds } } } });
      await prisma.cuenta.deleteMany({ where: { mesaId: { in: mesaIds } } });
      await prisma.mesa.deleteMany({ where: { id: { in: mesaIds } } });
      await prisma.seccionHabitualProducto.deleteMany({ where: { productoId: { in: productoIds } } });
      await prisma.recetaIngrediente.deleteMany({ where: { recetaVersion: { productoId: pizza.id } } });
      await prisma.recetaVersion.deleteMany({ where: { productoId: pizza.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: productoIds } } });
      await prisma.producto.deleteMany({ where: { id: { in: productoIds } } });
      await prisma.seccion.deleteMany({ where: { id: { in: [cocina.id, deposito.id] } } });
    },
  };
}

async function elegirProducto(page: Page, nombre: string) {
  const combo = page.getByRole("combobox", { name: "Producto" });
  await combo.fill(nombre);
  await page.getByRole("option", { name: new RegExp(nombre) }).click();
}

const filaDe = (page: Page, nombre: string) => page.locator("tr", { hasText: nombre });

test("configurar, editar y quitar la sección habitual de un producto", async ({ paginaAutenticada: page, sucursalId }) => {
  const s = await sembrar(sucursalId);
  try {
    await page.goto("/stock/seccion-habitual");
    await expect(page.getByRole("heading", { name: "Sección habitual", exact: true })).toBeVisible();

    // Alta.
    await elegirProducto(page, s.pizza.nombre);
    await page.getByLabel("Sección habitual", { exact: true }).selectOption({ label: s.cocina.nombre });
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText(`Sección habitual de «${s.pizza.nombre}»: «${s.cocina.nombre}».`)).toBeVisible();
    await expect(filaDe(page, s.pizza.nombre)).toContainText(s.cocina.nombre);

    // Editar: el producto viene cargado, se cambia la sección.
    await filaDe(page, s.pizza.nombre).getByRole("link", { name: "Editar" }).click();
    await expect(page.getByRole("heading", { name: "Editar sección habitual" })).toBeVisible();
    await page.getByLabel("Sección habitual", { exact: true }).selectOption({ label: s.deposito.nombre });
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByRole("heading", { name: "Fijar sección habitual" })).toBeVisible();
    await expect(filaDe(page, s.pizza.nombre)).toContainText(s.deposito.nombre);
    expect(await prisma.seccionHabitualProducto.count({ where: { productoId: s.pizza.id } })).toBe(1);

    // La ficha del producto la muestra (solo lectura).
    await page.goto(`/catalogo/productos/${s.pizza.id}`);
    await expect(page.getByText(s.deposito.nombre)).toBeVisible();

    // Quitar (con confirmación).
    await page.goto("/stock/seccion-habitual");
    await filaDe(page, s.pizza.nombre).getByRole("button", { name: `Quitar la sección habitual de ${s.pizza.nombre}` }).click();
    await filaDe(page, s.pizza.nombre).getByRole("button", { name: "Sí, quitar" }).click();
    await expect(filaDe(page, s.pizza.nombre)).toHaveCount(0);
    expect(await prisma.seccionHabitualProducto.count({ where: { productoId: s.pizza.id } })).toBe(0);
  } finally {
    await s.limpiar();
  }
});

test("cierre de cuenta con la habitual en una sección sin muzza y la muzza en otra: sin aviso, CONSUMO en la de respaldo, VENTA en la habitual", async ({ paginaAutenticada: page, sucursalId }) => {
  const s = await sembrar(sucursalId);
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const compra = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: admin.id } });
  await prisma.movimientoStock.create({
    data: { operacionId: compra.id, productoId: s.muzzarella.id, seccionId: s.deposito.id, proceso: "COMPRA", cantidad: 1, detalle: "Compra", precioTotal: 0, precioPorUnidadStock: 0 },
  });
  await prisma.seccionHabitualProducto.create({ data: { sucursalId, productoId: s.pizza.id, seccionId: s.cocina.id } });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 981 } });
  await prisma.cuenta.create({
    data: { mesaId: mesa.id, abiertaPorId: admin.id, items: { create: [{ productoId: s.pizza.id, cantidad: 2, precioUnitario: 12000, numeroEnvio: 1, creadoPorId: admin.id }] } },
  });
  try {
    await interceptarImpresion(page);
    await page.goto(`/mesas/${mesa.id}`);
    await page.getByRole("button", { name: "Cerrar cuenta" }).click();
    const cierre = page.getByRole("dialog", { name: "Cerrar cuenta · Mesa 981" });
    await expect(cierre.getByText("Cada producto se descuenta de su sección habitual; si ahí no alcanza, de otra sección con stock.")).toBeVisible();
    await cierre.getByRole("button", { name: "Cerrar y registrar la venta" }).click();
    const aviso = page.locator('[role="status"][aria-live="polite"]');
    await expect(aviso).toHaveText(/^Cuenta de la mesa 981 cerrada: se registró la venta por /);
    await expect(aviso).not.toContainText("⚠");

    const venta = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA", detalleLibre: "Mesa 981", sucursalId }, include: { movimientos: true } });
    const filas = venta.movimientos.map((m) => [m.proceso, m.seccionId, Number(m.cantidad)]).sort();
    expect(filas).toEqual([["CONSUMO", s.deposito.id, -0.5], ["VENTA", s.cocina.id, -2]].sort());
  } finally {
    await s.limpiar([mesa.id]);
  }
});

test("una sección excluida del respaldo automático no se usa al cerrar: la venta sale de la otra aunque la excluida tenga el lote que vence antes", async ({ paginaAutenticada: page, sucursalId }) => {
  const s = await sembrar(sucursalId);
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const compra = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: admin.id } });
  await prisma.movimientoStock.createMany({
    data: [
      { operacionId: compra.id, productoId: s.muzzarella.id, seccionId: s.cocina.id, proceso: "COMPRA", cantidad: 1, loteVencimiento: new Date("2026-10-01"), detalle: "Compra", precioTotal: 0, precioPorUnidadStock: 0 },
      { operacionId: compra.id, productoId: s.muzzarella.id, seccionId: s.deposito.id, proceso: "COMPRA", cantidad: 1, loteVencimiento: new Date("2026-11-01"), detalle: "Compra", precioTotal: 0, precioPorUnidadStock: 0 },
    ],
  });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 982 } });
  await prisma.cuenta.create({
    data: { mesaId: mesa.id, abiertaPorId: admin.id, items: { create: [{ productoId: s.pizza.id, cantidad: 2, precioUnitario: 12000, numeroEnvio: 1, creadoPorId: admin.id }] } },
  });
  try {
    // Se excluye Cocina desde Movimientos › Secciones.
    await page.goto("/movimientos/secciones");
    const filaCocina = page.locator(`tr:has(input[value="${s.cocina.nombre}"])`);
    await filaCocina.getByRole("button", { name: "Quitar del respaldo", exact: true }).click();
    await expect(filaCocina.getByRole("button", { name: "Usar de respaldo", exact: true })).toBeVisible();

    await interceptarImpresion(page);
    await page.goto(`/mesas/${mesa.id}`);
    await page.getByRole("button", { name: "Cerrar cuenta" }).click();
    await page.getByRole("dialog", { name: "Cerrar cuenta · Mesa 982" }).getByRole("button", { name: "Cerrar y registrar la venta" }).click();
    const aviso = page.locator('[role="status"][aria-live="polite"]');
    await expect(aviso).toHaveText(/^Cuenta de la mesa 982 cerrada: se registró la venta por /);
    await expect(aviso).not.toContainText("⚠");

    const venta = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA", detalleLibre: "Mesa 982", sucursalId }, include: { movimientos: true } });
    const filas = venta.movimientos.map((m) => [m.proceso, m.seccionId, Number(m.cantidad)]).sort();
    expect(filas).toEqual([["CONSUMO", s.deposito.id, -0.5], ["VENTA", s.deposito.id, -2]].sort());
  } finally {
    await s.limpiar([mesa.id]);
  }
});
