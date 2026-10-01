import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { crearMembresia } from "../setup/membresia";

/**
 * Compras registradas: una fila por factura, con sus líneas, filtros y el enlace desde «Compras por proveedor» del reporte por período.
 * Se siembran las compras directo en la base (proveedor propio de la prueba, factura con marca única) para no depender de otros specs.
 */
test("el listado muestra la factura con sus líneas, filtra por proveedor y se llega desde Compras por proveedor", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const marca = Date.now();
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const producto = await prisma.producto.create({
    data: { codigo: `E2E-CR-${marca}`, nombre: `E2E Harina Compras ${marca}`, tipo: "MP", unidadStockId: unidad.id, unidadCompraId: unidad.id },
  });
  const proveedor = await prisma.proveedor.create({ data: { codigo: `PRV_E2E_CR_${marca}`, nombre: `E2E Proveedor Compras ${marca}` } });
  const fecha = new Date("2026-08-10");
  const factura = `E2E-F-${marca}`;
  const operacion = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha, proveedorId: proveedor.id, nroFactura: factura, usuarioId: admin.id } });
  await prisma.movimientoStock.create({
    data: { operacionId: operacion.id, productoId: producto.id, seccionId, proceso: "COMPRA", cantidad: 12, precioTotal: 360, precioPorUnidadStock: 30, detalle: "" },
  });
  // Una compra SIN proveedor, para el filtro «Sin proveedor».
  const sinProveedor = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha, nroFactura: `E2E-SIN-${marca}`, usuarioId: admin.id } });

  await page.goto(`/reportes/compras?proveedorId=${proveedor.id}`);
  await expect(page.getByRole("heading", { name: "Compras registradas" })).toBeVisible();
  const tarjeta = page.locator(`[data-compra="${operacion.id}"]`);
  await expect(tarjeta).toBeVisible();
  await expect(tarjeta).toContainText(`Factura ${factura}`);
  await expect(tarjeta).toContainText("$360");
  await expect(page.locator(`[data-compra="${sinProveedor.id}"]`)).toHaveCount(0); // el filtro por proveedor deja afuera a las demás

  // El detalle de las líneas está dentro de la fila, desplegable.
  await tarjeta.locator("summary").click();
  await expect(tarjeta).toContainText(`E2E-CR-${marca} — E2E Harina Compras ${marca}`);
  await expect(tarjeta).toContainText("12 kg");
  await expect(tarjeta).toContainText("e2e-admin@local.test");

  // «Sin proveedor» muestra la compra cargada sin proveedor, marcada como tal.
  await page.goto(`/reportes/compras?proveedorId=SIN&factura=E2E-SIN-${marca}`);
  const tarjetaSin = page.locator(`[data-compra="${sinProveedor.id}"]`);
  await expect(tarjetaSin).toContainText("Sin proveedor");

  // Desde Compras por proveedor (Período) el nombre del proveedor lleva a su listado, con el mismo rango de fechas.
  await page.goto("/reportes/periodo?desde=2026-08-01&hasta=2026-08-31");
  const enlace = page.getByRole("link", { name: `E2E Proveedor Compras ${marca}` });
  await expect(enlace).toHaveCount(1);
  await enlace.click();
  await page.waitForURL(/\/reportes\/compras\?proveedorId=.*desde=2026-08-01&hasta=2026-08-31/);
  await expect(page.locator(`[data-compra="${operacion.id}"]`)).toBeVisible();
});

test("el listado está en el menú de Reportes y un usuario sin «Ver» de dinero no lo ve ni lo puede abrir", async ({ paginaAutenticada: page, browser, baseURL, sucursalId }) => {
  await page.goto("/reportes/compras");
  await expect(page.getByRole("navigation").locator('a[href="/reportes/compras"]')).toHaveCount(1);

  const { randomUUID } = await import("node:crypto");
  const rol = await prisma.rol.create({ data: { nombre: `e2e-sin-dinero-${Date.now()}` } });
  await prisma.permisoRol.create({ data: { rolId: rol.id, accionClave: "reporte_vencimientos", puedeVer: true, puedeEditar: false } });
  const usuario = await prisma.user.create({ data: { email: `e2e-sin-dinero-${Date.now()}@local.test`, activoGlobal: true } });
  await crearMembresia({ usuarioId: usuario.id, sucursalId, rolId: rol.id, activo: true });
  const sessionToken = randomUUID();
  await prisma.session.create({ data: { sessionToken, userId: usuario.id, expires: new Date(Date.now() + 1000 * 60 * 60) } });
  const contexto = await browser.newContext();
  await contexto.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: new URL(baseURL ?? "http://localhost:3000").hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
  const otra = await contexto.newPage();

  await otra.goto("/reportes/compras");
  await expect(otra.getByText(/No tenés permiso para ver esta sección/)).toBeVisible();
  await expect(otra.getByRole("navigation").locator('a[href="/reportes/compras"]')).toHaveCount(0);
  await contexto.close();
});
