import { randomUUID } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { crearMembresia } from "../setup/membresia";

/**
 * §4 (docs/planes-demo-y-claridad-reportes-2026-09-21.md) — "Cómo se compró"/"Cómo se vendió", el cartel "Producto de
 * reventa" para un PV sin stock propio, el filtro "Qué mostrar" del Kardex y la columna "Origen". Ver el plan de
 * implementación: docs/plan-historial-producto-mp-pv-2026-09-22.md.
 */

const dia = (n: number) => new Date(Date.now() - n * 86_400_000);

test("MP con compras: 'Cómo se compró' muestra la mediana y la variación contra la compra anterior", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const marca = Date.now();
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const proveedor = await prisma.proveedor.create({ data: { codigo: `PRV_E2E_HIST_${marca}`, nombre: `E2E Proveedor Historial ${marca}` } });
  const mp = await prisma.producto.create({ data: { codigo: `E2E-HIST-MP-${marca}`, nombre: `E2E Harina Historial ${marca}`, tipo: "MP", unidadStockId: kg.id } });

  const operaciones: string[] = [];
  async function comprar(hace: number, cantidad: number, precioPorUnidad: number) {
    const op = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: dia(hace), proveedorId: proveedor.id, usuarioId: admin.id } });
    operaciones.push(op.id);
    await prisma.movimientoStock.create({
      data: { operacionId: op.id, productoId: mp.id, seccionId, proceso: "COMPRA", cantidad, detalle: "Compra", precioTotal: cantidad * precioPorUnidad, precioPorUnidadStock: precioPorUnidad },
    });
    return op;
  }
  await comprar(3, 25, 900);
  const segunda = await comprar(2, 25, 1000); // +11.1% vs. la anterior (900)
  await comprar(1, 25, 1000);

  try {
    await page.goto(`/reportes/historial?productoId=${mp.id}`);
    await expect(page.getByRole("heading", { name: new RegExp(mp.nombre) })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cómo se compró" })).toBeVisible();
    await expect(page.getByText("Se compró 3 veces")).toBeVisible();
    await expect(page.getByText(/casi siempre 25 kg/)).toBeVisible();

    const filaSegunda = page.locator("tr", { hasText: "1.000" }).filter({ hasText: "+11.1%" });
    await expect(filaSegunda).toBeVisible();
    void segunda; // referenciada solo para dejar clara la relación con la variación de arriba
  } finally {
    await prisma.movimientoStock.deleteMany({ where: { productoId: mp.id } });
    await prisma.operacion.deleteMany({ where: { id: { in: operaciones } } });
    await prisma.producto.deleteMany({ where: { id: mp.id } });
    await prisma.proveedor.deleteMany({ where: { id: proveedor.id } });
  }
});

test("PV sin stock propio: cartel 'Producto de reventa', sin saldo actual en el encabezado ni columna 'Saldo corriente'", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const marca = Date.now();
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const mp = await prisma.producto.create({ data: { codigo: `E2E-HIST-REV-MP-${marca}`, nombre: `E2E Agua Caja ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  const pv = await prisma.producto.create({ data: { codigo: `E2E-HIST-REV-PV-${marca}`, nombre: `E2E Agua Botella ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 1500 } });
  await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: kg.id }] } } });

  const operaciones: string[] = [];
  const venta = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: dia(1), usuarioId: admin.id } });
  operaciones.push(venta.id);
  await prisma.movimientoStock.create({
    data: { operacionId: venta.id, productoId: pv.id, seccionId, proceso: "VENTA", cantidad: -3, detalle: `Venta de "${pv.nombre}"`, precioTotal: 4500, precioPorUnidadStock: 1500 },
  });

  try {
    await page.goto(`/reportes/historial?productoId=${pv.id}`);
    await expect(page.getByRole("heading", { name: new RegExp(pv.nombre) })).toBeVisible();
    await expect(page.getByText("Producto de reventa: no lleva stock propio.")).toBeVisible();
    await expect(page.getByText(`1 kg de ${mp.nombre}`)).toBeVisible();
    await expect(page.getByRole("link", { name: "Ver receta" })).toBeVisible();

    await expect(page.getByText(/saldo actual/)).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Saldo corriente" })).toHaveCount(0);

    await expect(page.getByRole("heading", { name: "Cómo se vendió" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "3", exact: true })).toBeVisible();
  } finally {
    await prisma.movimientoStock.deleteMany({ where: { productoId: pv.id } });
    await prisma.operacion.deleteMany({ where: { id: { in: operaciones } } });
    await prisma.recetaVersion.deleteMany({ where: { productoId: pv.id } });
    await prisma.producto.deleteMany({ where: { id: { in: [pv.id, mp.id] } } });
  }
});

test("filtro 'Qué mostrar' → 'Solo compras' reduce las filas del Kardex, sin cambiar el saldo corriente de las que quedan", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const marca = Date.now();
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const mp = await prisma.producto.create({ data: { codigo: `E2E-HIST-FILT-${marca}`, nombre: `E2E Filtro Kardex ${marca}`, tipo: "MP", unidadStockId: kg.id } });

  const operaciones: string[] = [];
  const compra = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: dia(2), usuarioId: admin.id } });
  operaciones.push(compra.id);
  await prisma.movimientoStock.create({ data: { operacionId: compra.id, productoId: mp.id, seccionId, proceso: "COMPRA", cantidad: 10, detalle: "Compra", precioTotal: 100, precioPorUnidadStock: 10 } });
  const ajuste = await prisma.operacion.create({ data: { sucursalId, proceso: "AJUSTE", fecha: dia(1), usuarioId: admin.id } });
  operaciones.push(ajuste.id);
  await prisma.movimientoStock.create({ data: { operacionId: ajuste.id, productoId: mp.id, seccionId, proceso: "AJUSTE", cantidad: -2, detalle: "Ajuste", precioTotal: 0, precioPorUnidadStock: 0 } });

  try {
    await page.goto(`/reportes/historial?productoId=${mp.id}`);
    const kardex = page.locator("details").filter({ hasText: "Movimiento por movimiento" });
    await kardex.locator("summary").click();
    await expect(kardex.getByRole("row")).toHaveCount(3); // encabezado + 2 movimientos
    const filaCompra = kardex.getByRole("row", { name: /COMPRA/ });
    await expect(filaCompra).toContainText("10"); // saldo corriente ANTES de filtrar

    await page.getByLabel("Qué mostrar").selectOption("compras");
    await page.getByRole("button", { name: "Ver historial" }).click();
    await expect(kardex.getByRole("row")).toHaveCount(2); // encabezado + 1 (la compra) — el ajuste queda afuera
    await expect(kardex.getByRole("row", { name: /AJUSTE/ })).toHaveCount(0);
    await expect(kardex.getByRole("row", { name: /COMPRA/ })).toContainText("10"); // MISMO saldo — el filtro es de presentación, no recalcula nada
  } finally {
    await prisma.movimientoStock.deleteMany({ where: { productoId: mp.id } });
    await prisma.operacion.deleteMany({ where: { id: { in: operaciones } } });
    await prisma.producto.deleteMany({ where: { id: mp.id } });
  }
});

test("la columna 'Origen' navega a la trazabilidad de la operación", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const marca = Date.now();
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const mp = await prisma.producto.create({ data: { codigo: `E2E-HIST-ORIG-${marca}`, nombre: `E2E Origen Kardex ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  const compra = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: dia(1), usuarioId: admin.id } });
  await prisma.movimientoStock.create({ data: { operacionId: compra.id, productoId: mp.id, seccionId, proceso: "COMPRA", cantidad: 5, detalle: "Compra", precioTotal: 50, precioPorUnidadStock: 10 } });

  try {
    await page.goto(`/reportes/historial?productoId=${mp.id}`);
    const kardex = page.locator("details").filter({ hasText: "Movimiento por movimiento" });
    await kardex.locator("summary").click();
    await kardex.getByRole("link", { name: "Ver operación" }).click();
    await page.waitForURL(new RegExp(`/reportes/trazabilidad\\?idOperacion=${compra.id}`));
    await expect(page.getByRole("heading", { name: new RegExp(`Operación ${compra.id}`) })).toBeVisible();
  } finally {
    await prisma.movimientoStock.deleteMany({ where: { productoId: mp.id } });
    await prisma.operacion.deleteMany({ where: { id: compra.id } });
    await prisma.producto.deleteMany({ where: { id: mp.id } });
  }
});

/** Un operador con ver_reportes_operativos (entra a la pantalla) pero SIN ver_reportes_dinero (no ve precio). A diferencia del
 * helper de reportes-permisos.spec.ts, acá ver_reportes_operativos se deja en `true` a propósito. */
async function paginaOperadorSinDinero(browser: Browser, baseURL: string | undefined, sucursalId: string): Promise<Page> {
  const { id: empresaId } = await prisma.empresa.findFirstOrThrow({ where: { estado: "ACTIVE" } });
  const operador = await prisma.rol.upsert({ where: { empresaId_nombre: { empresaId, nombre: "operador" } }, update: { activo: true }, create: { nombre: "operador" } });
  await prisma.permisoRol.upsert({
    where: { rolId_accionClave: { rolId: operador.id, accionClave: "ver_reportes_operativos" } },
    update: { puedeVer: true },
    create: { rolId: operador.id, accionClave: "ver_reportes_operativos", puedeVer: true, puedeEditar: false },
  });
  await prisma.permisoRol.upsert({
    where: { rolId_accionClave: { rolId: operador.id, accionClave: "ver_reportes_dinero" } },
    update: { puedeVer: false },
    create: { rolId: operador.id, accionClave: "ver_reportes_dinero", puedeVer: false, puedeEditar: false },
  });
  const usuario = await prisma.user.create({ data: { email: `e2e-operador-historial-${Date.now()}@local.test`, activoGlobal: true } });
  await crearMembresia({ usuarioId: usuario.id, sucursalId, rolId: operador.id, activo: true });
  const sessionToken = randomUUID();
  await prisma.session.create({ data: { sessionToken, userId: usuario.id, expires: new Date(Date.now() + 1000 * 60 * 60 * 24) } });

  const context = await browser.newContext();
  const host = new URL(baseURL ?? "http://localhost:3000").hostname;
  await context.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: host, path: "/", httpOnly: true, sameSite: "Lax" }]);
  return context.newPage();
}

test("un rol con ver_reportes_operativos pero SIN ver_reportes_dinero entra a la pantalla y ve 'Cómo se compró' sin precio ni variación", async ({ browser, baseURL, sucursalId, seccionId }) => {
  const marca = Date.now();
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const mp = await prisma.producto.create({ data: { codigo: `E2E-HIST-PERM-${marca}`, nombre: `E2E Sin Dinero ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  const compra = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: dia(1), usuarioId: admin.id } });
  await prisma.movimientoStock.create({ data: { operacionId: compra.id, productoId: mp.id, seccionId, proceso: "COMPRA", cantidad: 5, detalle: "Compra", precioTotal: 500, precioPorUnidadStock: 100 } });

  const page = await paginaOperadorSinDinero(browser, baseURL, sucursalId);
  try {
    await page.goto(`/reportes/historial?productoId=${mp.id}`);
    await expect(page.getByRole("heading", { name: new RegExp(mp.nombre) })).toBeVisible(); // entra a la pantalla
    await expect(page.getByRole("heading", { name: "Cómo se compró" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Precio por unidad de stock" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Variación vs. la compra anterior" })).toHaveCount(0);
    await expect(page.getByText("$100")).toHaveCount(0);
  } finally {
    await page.context().close();
    await prisma.movimientoStock.deleteMany({ where: { productoId: mp.id } });
    await prisma.operacion.deleteMany({ where: { id: compra.id } });
    await prisma.producto.deleteMany({ where: { id: mp.id } });
  }
});
