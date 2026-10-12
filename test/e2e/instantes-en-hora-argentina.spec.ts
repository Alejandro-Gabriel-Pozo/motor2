import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * Los INSTANTES que se muestran (cuándo se creó un traspaso, cuándo se anuló una venta, cuándo se guardó una versión de receta) se leen en la
 * zona de la empresa (Argentina), no en UTC ni en la zona del servidor. A las 22:30 argentinas del 30/9 son las 01:30 UTC del 1/10: sin la zona
 * la pantalla decía «1 de octubre». El servidor del E2E corre en UTC, así que el desfase se ve.
 *
 * P1: `Operacion.fecha` y `ConteoFisico.fecha` también son instantes (el POS guarda la hora de cierre; los formularios, el mediodía argentino del día elegido), así que su día se
 * lee en la zona: los dos últimos casos de este archivo siembran una venta y un conteo a las 22:30 argentinas y miran Trazabilidad y Conteos. (Lo cargado ANTES de P1 a las 00:00 UTC
 * se ve un día antes; no se rellena: ver docs/pureza-integracion.md, O.254.)
 *
 * Los instantes son del pasado (más de un día): no se vuelven falsos con el paso del tiempo.
 */
const A_LAS_2230_ARGENTINAS = new Date("2026-09-30T22:30:00-03:00");

test("Traspasos: la fecha de un traspaso creado a las 22:30 argentinas es ese día, no el siguiente", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const otra = await prisma.sucursal.create({ data: { nombre: `E2E Hora AR B ${marca}` } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-HAR-${marca}`, nombre: `E2E Harina Hora ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  const traspaso = await prisma.traspasoSucursal.create({
    data: {
      origenSucursalId: otra.id,
      destinoSucursalId: sucursalId,
      seccionDestinoId: seccionId,
      iniciadoPor: "DESTINO",
      estado: "SOLICITADA",
      productoId: producto.id,
      cantidad: 3,
      creadoPorId: admin.id,
      creadoEn: A_LAS_2230_ARGENTINAS,
    },
  });
  try {
    await page.goto("/traspasos");
    await expect(page.locator(`div[data-traspaso="${traspaso.id}"]`)).toContainText("(2026-09-30)");
  } finally {
    await prisma.traspasoSucursal.deleteMany({ where: { id: traspaso.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
    await prisma.sucursal.deleteMany({ where: { id: otra.id } });
  }
});

test("Trazabilidad: «Anulada el» de una venta anulada a las 22:30 argentinas es ese día, no el siguiente", async ({ paginaAutenticada: page, sucursalId }) => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const operacion = await prisma.operacion.create({
    data: { sucursalId, proceso: "VENTA", fecha: new Date("2026-09-30T00:00:00Z"), usuarioId: admin.id, anuladaEn: A_LAS_2230_ARGENTINAS, anuladaPorId: admin.id },
  });
  try {
    await page.goto(`/reportes/trazabilidad?idOperacion=${operacion.id}`);
    await expect(page.getByText(/Anulada el 2026-09-30/)).toBeVisible();
  } finally {
    await prisma.operacion.deleteMany({ where: { id: operacion.id } });
  }
});

test("Historial de receta: la hora de una versión guardada a las 22:30 argentinas se ve como 22:30 del 30/09", async ({ paginaAutenticada: page }) => {
  const marca = Date.now();
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const insumo = await prisma.producto.create({ data: { codigo: `E2E-HRH-MP-${marca}`, nombre: `E2E Insumo Hora ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  const plato = await prisma.producto.create({ data: { codigo: `E2E-HRH-PV-${marca}`, nombre: `E2E Plato Hora ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 50 } });
  const version = await prisma.recetaVersion.create({
    data: { productoId: plato.id, version: 1, creadoEn: A_LAS_2230_ARGENTINAS, ingredientes: { create: [{ insumoProductoId: insumo.id, cantidad: 1, unidadId: kg.id }] } },
  });
  try {
    await page.goto(`/catalogo/recetas/${plato.id}/historial`);
    await expect(page.getByRole("heading", { name: /Versión 1/ })).toContainText("30/09/2026 22:30");
  } finally {
    await prisma.recetaIngrediente.deleteMany({ where: { recetaVersionId: version.id } });
    await prisma.recetaVersion.deleteMany({ where: { id: version.id } });
    await prisma.producto.deleteMany({ where: { id: { in: [plato.id, insumo.id] } } });
  }
});

test("Trazabilidad: la fecha de una venta de las 22:30 argentinas es ese día (encabezado de la operación y lista de operaciones encontradas)", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-OPF-${marca}`, nombre: `E2E Pan Operacion Fecha ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 50 } });
  const operacion = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: A_LAS_2230_ARGENTINAS, usuarioId: admin.id } });
  await prisma.movimientoStock.create({
    data: { operacionId: operacion.id, productoId: producto.id, seccionId, proceso: "VENTA", cantidad: -1, detalle: "Venta", precioTotal: 50, precioPorUnidadStock: 50 },
  });
  try {
    await page.goto(`/reportes/trazabilidad?idOperacion=${operacion.id}`);
    await expect(page.getByRole("heading", { level: 2, name: /^Operación / })).toContainText("— 2026-09-30 —");

    await page.goto(`/reportes/trazabilidad?producto=${encodeURIComponent(producto.codigo)}`);
    await expect(page.getByRole("cell", { name: "2026-09-30", exact: true })).toBeVisible();
    await expect(page.getByText("2026-10-01")).toHaveCount(0);
  } finally {
    await prisma.movimientoStock.deleteMany({ where: { operacionId: operacion.id } });
    await prisma.operacion.deleteMany({ where: { id: operacion.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});

test("Conteos: la fecha de un conteo físico de las 22:30 argentinas es ese día, no el siguiente", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-CNT-${marca}`, nombre: `E2E Harina Conteo Hora ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  await prisma.conteoFisico.create({
    data: { sucursalId, fecha: A_LAS_2230_ARGENTINAS, productoId: producto.id, seccionId, saldoSistema: 4, conteoReal: 4, diferencia: 0, accion: "AJUSTAR", estado: "RESUELTO", usuarioId: admin.id },
  });
  try {
    await page.goto(`/reportes/conteos?productoId=${producto.id}`);
    await expect(page.getByRole("cell", { name: "2026-09-30", exact: true })).toBeVisible();
    await expect(page.getByText("2026-10-01")).toHaveCount(0);
    // El filtro cierra el día en la zona de la empresa: el conteo de las 22:30 del 30/9 entra con desde=hasta=30/9 y no con el 1/10 (con el «hasta» crudo en 00:00Z no entraba).
    await page.goto(`/reportes/conteos?productoId=${producto.id}&desde=2026-09-30&hasta=2026-09-30`);
    await expect(page.getByRole("cell", { name: "2026-09-30", exact: true })).toBeVisible();
    await page.goto(`/reportes/conteos?productoId=${producto.id}&desde=2026-10-01&hasta=2026-10-01`);
    await expect(page.getByRole("cell", { name: "2026-09-30", exact: true })).toHaveCount(0);
  } finally {
    await prisma.conteoFisico.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});
