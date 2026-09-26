import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { abrirComoRol } from "./fixtures/rol-pos";

/**
 * Boletas emitidas (Task #17 del backlog): antes de esta pantalla las boletas más viejas que las 3 últimas de una mesa
 * (`BOLETAS_RECIENTES_POR_MESA`) quedaban totalmente inaccesibles. Los datos se siembran directo con Prisma (cuenta + ítem +
 * Operacion VENTA + `EjemplarBoleta`), igual que compras-registradas.spec.ts: lo que se ejercita acá es la PANTALLA (filtros,
 * marcas, link a Trazabilidad, paginación, permisos), no la consulta — esa la cubre el test de integración de Vitest con las
 * acciones reales del POS.
 */

async function sembrarProducto(sucursalId: string, marca: string) {
  const unidad = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "unidad" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-RB-${marca}`, nombre: `E2E Boleta Producto ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 5000 } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
  return producto;
}

async function sembrarEjemplar(
  sucursalId: string,
  mesaId: string,
  adminId: string,
  productoId: string,
  opts: { numero: number; ejemplar?: number; emitidoEn?: Date; corrigeAId?: string | null }
) {
  const emitidoEn = opts.emitidoEn ?? new Date();
  const venta = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: emitidoEn, usuarioId: adminId, detalleLibre: "Mesa E2E RB" } });
  const cuenta = await prisma.cuenta.create({
    data: {
      mesaId,
      abiertaPorId: adminId,
      cerradaEn: emitidoEn,
      cerradaPorId: adminId,
      items: { create: [{ productoId, cantidad: 1, precioUnitario: 5000, numeroEnvio: 1, operacionId: venta.id, creadoPorId: adminId }] },
    },
  });
  const ejemplar = await prisma.ejemplarBoleta.create({
    data: { sucursalId, cuentaId: cuenta.id, numero: opts.numero, ejemplar: opts.ejemplar ?? 1, emitidoEn, emitidoPorId: adminId, corrigeAId: opts.corrigeAId ?? null },
  });
  return { cuenta, ejemplar, venta };
}

/** Borra lo que tocó una mesa (cuentas, ítems, operaciones, ejemplares) y la mesa misma. */
async function limpiarMesas(mesaIds: string[]) {
  const cuentaIds = (await prisma.cuenta.findMany({ where: { mesaId: { in: mesaIds } }, select: { id: true } })).map((c) => c.id);
  const items = await prisma.cuentaItem.findMany({ where: { cuentaId: { in: cuentaIds } }, select: { operacionId: true } });
  const operacionIds = [...new Set(items.flatMap((i) => (i.operacionId ? [i.operacionId] : [])))];
  await prisma.cuentaItem.deleteMany({ where: { cuentaId: { in: cuentaIds } } });
  await prisma.ejemplarBoleta.deleteMany({ where: { cuentaId: { in: cuentaIds }, corrigeAId: { not: null } } });
  await prisma.ejemplarBoleta.deleteMany({ where: { cuentaId: { in: cuentaIds } } });
  await prisma.cuenta.deleteMany({ where: { id: { in: cuentaIds } } });
  await prisma.operacion.deleteMany({ where: { id: { in: operacionIds } } });
  await prisma.mesa.deleteMany({ where: { id: { in: mesaIds } } });
}

test("filtro de fecha (\"hoy\" por default, en hora Argentina, y un rango personalizado)", async ({ paginaAutenticada: page, sucursalId }) => {
  const marca = `${Date.now()}`;
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const producto = await sembrarProducto(sucursalId, marca);
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 941 } });
  const hoy = await sembrarEjemplar(sucursalId, mesa.id, admin.id, producto.id, { numero: 100001 });
  const haceUnMes = await sembrarEjemplar(sucursalId, mesa.id, admin.id, producto.id, { numero: 100002, emitidoEn: new Date(Date.now() - 40 * 24 * 60 * 60_000) });
  try {
    await page.goto(`/reportes/boletas?mesaId=${mesa.id}`);
    await expect(page.getByRole("heading", { name: "Boletas emitidas" })).toBeVisible();
    await expect(page.locator(`[data-boleta="${hoy.ejemplar.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-boleta="${haceUnMes.ejemplar.id}"]`)).toHaveCount(0);

    await page.goto(`/reportes/boletas?mesaId=${mesa.id}&desde=&hasta=`);
    await expect(page.locator(`[data-boleta="${hoy.ejemplar.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-boleta="${haceUnMes.ejemplar.id}"]`)).toBeVisible();
  } finally {
    await limpiarMesas([mesa.id]);
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});

test("filtro por mesa, marcas de corrección/reemplazo, y el detalle enlaza a Trazabilidad", async ({ paginaAutenticada: page, sucursalId }) => {
  const marca = `${Date.now()}`;
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const producto = await sembrarProducto(sucursalId, marca);
  const mesaA = await prisma.mesa.create({ data: { sucursalId, numero: 942 } });
  const mesaB = await prisma.mesa.create({ data: { sucursalId, numero: 943 } });
  const { cuenta, ejemplar: a, venta } = await sembrarEjemplar(sucursalId, mesaA.id, admin.id, producto.id, { numero: 100010 });
  const b = await prisma.ejemplarBoleta.create({
    data: { sucursalId, cuentaId: cuenta.id, numero: a.numero, ejemplar: 2, emitidoPorId: admin.id, corrigeAId: a.id, motivo: "Motivo E2E" },
  });
  await sembrarEjemplar(sucursalId, mesaB.id, admin.id, producto.id, { numero: 100011 });
  try {
    await page.goto(`/reportes/boletas?mesaId=${mesaA.id}&desde=&hasta=`);
    await expect(page.locator("[data-boleta]")).toHaveCount(2);
    await expect(page.getByText(`Filtrando por Mesa ${String(mesaA.numero).padStart(2, "0")}`)).toBeVisible();

    const filaB = page.locator(`[data-boleta="${b.id}"]`);
    const filaA = page.locator(`[data-boleta="${a.id}"]`);
    await expect(filaB).toContainText(`N.º ${a.numero}-B`);
    await expect(filaB).toContainText(`Corrección de N.º ${a.numero}-A`);
    await expect(filaA).toContainText(`Reemplazada por N.º ${a.numero}-B`);
    // Solo el ÚLTIMO ejemplar (la B) tiene estado — la venta acá está vigente, así que ninguna de las dos marca "Desactualizada" ni "Venta anulada".
    await expect(filaB).not.toContainText("Venta anulada");
    await expect(filaA).not.toContainText("Venta anulada");

    await filaA.locator("summary").click();
    const enlace = filaA.getByRole("link", { name: "Trazabilidad" });
    await expect(enlace).toBeVisible();
    await enlace.click();
    await page.waitForURL(new RegExp(`/reportes/trazabilidad\\?idOperacion=${venta.id}`));
    await expect(page.getByText(`Operación ${venta.id}`)).toBeVisible();
  } finally {
    await limpiarMesas([mesaA.id, mesaB.id]);
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});

test("paginación por cursor: página siguiente muestra el resto sin repetir filas", async ({ paginaAutenticada: page, sucursalId }) => {
  const marca = `${Date.now()}`;
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const producto = await sembrarProducto(sucursalId, marca);
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 944 } });
  const ejemplares = [];
  for (let i = 0; i < 31; i++) ejemplares.push((await sembrarEjemplar(sucursalId, mesa.id, admin.id, producto.id, { numero: 100100 + i })).ejemplar);
  try {
    await page.goto(`/reportes/boletas?mesaId=${mesa.id}&desde=&hasta=`);
    await expect(page.locator("[data-boleta]")).toHaveCount(30);
    const siguiente = page.getByRole("link", { name: "Página siguiente →" });
    await expect(siguiente).toBeVisible();
    await siguiente.click();
    await expect(page.locator("[data-boleta]")).toHaveCount(1);
  } finally {
    await limpiarMesas([mesa.id]);
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});

test("desde la pantalla de la mesa: «Ver todas las boletas de esta mesa» lleva al reporte filtrado por esa mesa", async ({ paginaAutenticada: page, sucursalId }) => {
  const marca = `${Date.now()}`;
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const producto = await sembrarProducto(sucursalId, marca);
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 945 } });
  const { ejemplar } = await sembrarEjemplar(sucursalId, mesa.id, admin.id, producto.id, { numero: 100200 });
  try {
    await page.goto(`/mesas/${mesa.id}`);
    const link = page.getByRole("link", { name: "Ver todas las boletas de esta mesa →" });
    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL(new RegExp(`/reportes/boletas\\?mesaId=${mesa.id}`));
    await expect(page.locator(`[data-boleta="${ejemplar.id}"]`)).toBeVisible();
  } finally {
    await limpiarMesas([mesa.id]);
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});

test("un rol sin \"ver_reportes_dinero\" no ve el link en el menú, no puede abrir la pantalla, y no ve el link desde la mesa", async ({
  browser,
  baseURL,
  paginaAutenticada: page,
  sucursalId,
}) => {
  const marca = `${Date.now()}`;
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const producto = await sembrarProducto(sucursalId, marca);
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 946 } });
  await sembrarEjemplar(sucursalId, mesa.id, admin.id, producto.id, { numero: 100300 });
  const sinDinero = await abrirComoRol(browser, baseURL, sucursalId, { pos_mesas: "ver", ver_reportes_operativos: "ver" });
  try {
    await page.goto("/reportes/boletas");
    await expect(page.getByRole("navigation").locator('a[href="/reportes/boletas"]')).toHaveCount(1);

    await sinDinero.page.goto("/reportes/boletas");
    await expect(sinDinero.page.getByText(/No tenés permiso para ver esta sección/)).toBeVisible();
    await expect(sinDinero.page.getByRole("navigation").locator('a[href="/reportes/boletas"]')).toHaveCount(0);

    await sinDinero.page.goto(`/mesas/${mesa.id}`);
    await expect(sinDinero.page.getByRole("link", { name: "Ver todas las boletas de esta mesa →" })).toHaveCount(0);
  } finally {
    await sinDinero.limpiar();
    await limpiarMesas([mesa.id]);
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});
