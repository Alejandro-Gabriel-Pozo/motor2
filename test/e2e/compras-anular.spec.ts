import { randomUUID } from "node:crypto";
import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { crearMembresia } from "../setup/membresia";
import { ajustarCeldasDelAdmin } from "./fixtures/admin-con-filas";
import { prismaAdmin } from "../setup/cliente-duenio";

/**
 * Anular una compra desde «Compras registradas» (K1c). Se siembran las compras directo en la base, con un proveedor y un producto propios de cada prueba (marca
 * única), para no depender de lo que dejen otros specs. Cada prueba limpia lo que creó (compra, contra-asiento y auditoría).
 */
async function sembrarCompra(sucursalId: string, seccionId: string, opciones: { consumirDeLo?: number } = {}) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-AN-${marca}`, nombre: `E2E Harina Anular ${marca}`, tipo: "MP", unidadStockId: unidad.id } });
  const proveedor = await prisma.proveedor.create({ data: { codigo: `PRV_E2E_AN_${marca}`, nombre: `E2E Proveedor Anular ${marca}` } });
  const factura = `E2E-AN-F-${marca}`;
  const operacion = await prisma.operacion.create({
    data: { sucursalId, proceso: "COMPRA", fecha: new Date("2026-08-10T12:00:00Z"), proveedorId: proveedor.id, nroFactura: factura, usuarioId: admin.id },
  });
  await prisma.movimientoStock.create({
    data: { operacionId: operacion.id, productoId: producto.id, seccionId, proceso: "COMPRA", cantidad: 12, precioTotal: 360, precioPorUnidadStock: 30, detalle: "Compra" },
  });
  if (opciones.consumirDeLo) {
    const consumo = await prisma.operacion.create({ data: { sucursalId, proceso: "CONSUMO", fecha: new Date("2026-08-11T12:00:00Z"), usuarioId: admin.id } });
    await prisma.movimientoStock.create({
      data: { operacionId: consumo.id, productoId: producto.id, seccionId, proceso: "CONSUMO", cantidad: -opciones.consumirDeLo, detalle: "Consumo", precioTotal: 0, precioPorUnidadStock: 0 },
    });
  }
  const limpiar = async () => {
    const reversiones = await prisma.operacion.findMany({ where: { detalleLibre: { contains: operacion.id } }, select: { id: true } });
    const ids = (await prisma.movimientoStock.findMany({ where: { productoId: producto.id }, select: { operacionId: true } })).map((m) => m.operacionId);
    await prisma.movimientoStock.deleteMany({ where: { productoId: producto.id } });
    await prisma.operacion.deleteMany({ where: { id: { in: [...new Set([...ids, ...reversiones.map((r) => r.id)])] } } });
    await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "Operacion", entidadId: operacion.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
    // Con FK compuesta la operación ya no queda con proveedor NULL al borrarlo (RESTRICT): también las compras sin movimientos (p. ej. la recarga).
    await prisma.operacion.deleteMany({ where: { proveedorId: proveedor.id } });
    await prisma.proveedor.deleteMany({ where: { id: proveedor.id } });
  };
  return { marca, producto, proveedor, factura, operacion, limpiar };
}

test("se anula una compra desde su detalle, con confirmación: el stock vuelve, queda marcada y su factura queda libre", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const c = await sembrarCompra(sucursalId, seccionId);
  try {
    await page.goto(`/reportes/compras?proveedorId=${c.proveedor.id}`);
    const tarjeta = page.locator(`[data-compra="${c.operacion.id}"]`);
    await expect(tarjeta).toBeVisible();
    await expect(tarjeta).not.toContainText("Anulada");
    await tarjeta.locator("summary").click();

    // Confirmación: el aviso se anuncia (role="alert") y el foco va a «Cancelar», lo seguro en una acción que no se deshace.
    await tarjeta.getByRole("button", { name: /^Anular compra/ }).click();
    const aviso = tarjeta.getByRole("alert").filter({ hasText: "¿Anular la compra" });
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText(c.factura);
    await expect(tarjeta.getByRole("button", { name: "Cancelar" })).toBeFocused();

    // Escape cancela y el foco vuelve al botón que la abrió; no se anuló nada.
    await page.keyboard.press("Escape");
    await expect(aviso).toHaveCount(0);
    await expect(tarjeta.getByRole("button", { name: /^Anular compra/ })).toBeFocused();
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: c.operacion.id } })).anuladaEn).toBeNull();

    // Confirmar.
    await tarjeta.getByRole("button", { name: /^Anular compra/ }).click();
    await tarjeta.getByRole("button", { name: "Sí, anular" }).click();
    await expect(tarjeta.getByRole("status").filter({ hasText: "Compra anulada" })).toBeVisible();
    await expect(tarjeta.getByRole("status")).toContainText(c.factura); // avisa que el número quedó libre

    // La fila queda marcada como anulada, con el total tachado y sin el botón de anular.
    await expect(tarjeta.getByText("Anulada", { exact: true })).toBeVisible();
    await expect(tarjeta.getByRole("button", { name: /^Anular compra/ })).toHaveCount(0);

    // En la base: marcada, contra-asiento escrito y stock en cero.
    const anulada = await prisma.operacion.findUniqueOrThrow({ where: { id: c.operacion.id } });
    expect(anulada.anuladaEn).not.toBeNull();
    const saldo = await prisma.movimientoStock.aggregate({ where: { productoId: c.producto.id }, _sum: { cantidad: true } });
    expect(Number(saldo._sum.cantidad)).toBe(0);
    expect(await prisma.operacion.count({ where: { proceso: "AJUSTE", detalleLibre: { contains: c.operacion.id } } })).toBe(1);

    // Recargar el listado: sigue marcada, y el total de la página no la cuenta.
    await page.reload();
    const recargada = page.locator(`[data-compra="${c.operacion.id}"]`);
    await expect(recargada.getByText("Anulada", { exact: true })).toBeVisible();
    await expect(page.getByText(/sin contar 1 anulada/)).toBeVisible();
    await expect(page.getByText(/suman \$0/)).toBeVisible();

    // La factura quedó libre: se puede volver a cargar con el mismo número.
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
    const recarga = await prisma.operacion.create({
      data: { sucursalId, proceso: "COMPRA", fecha: new Date("2026-08-12T12:00:00Z"), proveedorId: c.proveedor.id, nroFactura: c.factura, usuarioId: admin.id },
    });
    expect(recarga.id).not.toBe(c.operacion.id);
  } finally {
    await c.limpiar();
  }
});

test("si lo comprado ya se consumió, la anulación se rechaza con un mensaje visible y no se toca nada", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const c = await sembrarCompra(sucursalId, seccionId, { consumirDeLo: 8 });
  try {
    await page.goto(`/reportes/compras?proveedorId=${c.proveedor.id}`);
    const tarjeta = page.locator(`[data-compra="${c.operacion.id}"]`);
    await tarjeta.locator("summary").click();
    await tarjeta.getByRole("button", { name: /^Anular compra/ }).click();
    await tarjeta.getByRole("button", { name: "Sí, anular" }).click();

    const error = tarjeta.getByRole("alert").filter({ hasText: "No se puede anular" });
    await expect(error).toBeVisible();
    await expect(error).toContainText("se compraron 12 y hoy quedan 4");
    await expect(error).toContainText("Devolución a proveedor"); // la salida que se ofrece
    // El botón sigue disponible y con el foco, para poder reintentar o salir.
    await expect(tarjeta.getByRole("button", { name: /^Anular compra/ })).toBeVisible();
    await expect(tarjeta.getByRole("button", { name: /^Anular compra/ })).toBeFocused();

    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: c.operacion.id } })).anuladaEn).toBeNull();
    expect(await prisma.operacion.count({ where: { proceso: "AJUSTE", detalleLibre: { contains: c.operacion.id } } })).toBe(0);
    await expect(tarjeta.getByText("Anulada", { exact: true })).toHaveCount(0);
  } finally {
    await c.limpiar();
  }
});

test("quien puede ver los reportes de dinero pero no tiene «anular_compra» ve la compra sin el botón de anular", async ({ browser, baseURL, sucursalId, seccionId }) => {
  const c = await sembrarCompra(sucursalId, seccionId);
  const marca = Date.now();
  // «anular_compra» es de piso administrador: «quien no la tiene» se arma sobre el rol «admin», quitándole esa celda (se restaura al final).
  const admin = await ajustarCeldasDelAdmin({ anular_compra: null });
  const rol = { id: admin.rolId };
  const usuario = await prisma.user.create({ data: { email: `e2e-sin-anular-${marca}@local.test`, activoGlobal: true } });
  await crearMembresia({ usuarioId: usuario.id, sucursalId, rolId: rol.id, activo: true });
  const sessionToken = randomUUID();
  await prisma.session.create({ data: { sessionToken, userId: usuario.id, expires: new Date(Date.now() + 1000 * 60 * 60) } });
  const contexto = await browser.newContext();
  await contexto.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: new URL(baseURL ?? "http://localhost:3000").hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
  try {
    const otra = await contexto.newPage();
    await otra.goto(`/reportes/compras?proveedorId=${c.proveedor.id}`);
    const tarjeta = otra.locator(`[data-compra="${c.operacion.id}"]`);
    await expect(tarjeta).toBeVisible(); // ve la compra
    await tarjeta.locator("summary").click();
    await expect(tarjeta).toContainText(c.factura);
    await expect(tarjeta.getByRole("button", { name: /Anular compra/ })).toHaveCount(0); // pero no puede anularla
  } finally {
    await contexto.close();
    await c.limpiar();
    await prisma.session.deleteMany({ where: { userId: usuario.id } });
    await prisma.usuarioSucursal.deleteMany({ where: { usuarioId: usuario.id } });
    await prisma.usuarioEmpresa.deleteMany({ where: { usuarioId: usuario.id } });
    await prisma.user.deleteMany({ where: { id: usuario.id } });
    await admin.restaurar();
  }
});
