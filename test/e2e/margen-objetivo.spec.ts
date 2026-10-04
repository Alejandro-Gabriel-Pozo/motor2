import { randomUUID } from "node:crypto";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { crearMembresia } from "../setup/membresia";

/**
 * Margen objetivo (food cost) configurable: administración lo fija para la empresa y por categoría (`/catalogo/margen-objetivo`) y el reporte de
 * Costos lo usa para «Food cost alto» y el precio mínimo. Rige el de la categoría; si no, el de la empresa; si no, el 40 % por defecto.
 * Solo administración puede editarlo: un operario no ve la pantalla ni el enlace.
 */

test("el admin fija el objetivo de la empresa y el de una categoría, y Costos cambia el estado y el precio para el objetivo", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const marca = Date.now();
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const categoria = await prisma.categoriaProducto.create({ data: { nombre: `E2E Cat Objetivo ${marca}` } });
  const mp = await prisma.producto.create({ data: { codigo: `E2E-MO-MP-${marca}`, nombre: `E2E Insumo MO ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  const plato = await prisma.producto.create({
    data: { codigo: `E2E-MO-PV-${marca}`, nombre: `E2E Plato MO ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 10000, categoriaId: categoria.id },
  });
  await prisma.recetaVersion.create({ data: { productoId: plato.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: kg.id }] } } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const operacion = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: admin.id } });
  await prisma.movimientoStock.create({
    data: { operacionId: operacion.id, productoId: mp.id, seccionId, proceso: "COMPRA", cantidad: 10, detalle: "Compra", precioTotal: 40000, precioPorUnidadStock: 4000 },
  });
  try {
    const fila = page.locator("tr", { hasText: plato.nombre });

    // Sin objetivo cargado rige el 40 % por defecto: con el costo en $4000 sobre $10.000 está justo, no alto.
    await page.goto("/reportes/costos");
    await expect(fila).toContainText("$10.000");
    await expect(fila.getByText("Food cost alto")).toHaveCount(0);

    // Objetivo de la empresa: 30 % → el mismo plato pasa a «Food cost alto» y el precio mínimo sube a $4000 ÷ 0,30 redondeado hacia arriba.
    await page.goto("/catalogo/margen-objetivo");
    await expect(page.getByRole("heading", { name: /Margen objetivo/ })).toBeVisible();
    await page.getByLabel("Food cost objetivo (%)").fill("30");
    await page.locator("section", { hasText: "De toda la empresa" }).getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Food cost objetivo de la empresa: 30 %.")).toBeVisible();
    await page.goto("/reportes/costos");
    await expect(fila).toContainText("30%");
    await expect(fila).toContainText("$13.333,34");
    await expect(fila.getByText("Food cost alto")).toBeVisible();

    // Objetivo de la categoría del plato: 50 % → gana sobre el de la empresa y el plato vuelve a estar bien.
    await page.goto("/catalogo/margen-objetivo");
    const filaCategoria = page.locator("tr", { hasText: categoria.nombre });
    await filaCategoria.getByLabel(`Food cost objetivo de ${categoria.nombre} (%)`).fill("50");
    await filaCategoria.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText(`Food cost objetivo de la categoría «${categoria.nombre}»: 50 %.`)).toBeVisible();
    await page.goto("/reportes/costos");
    await expect(fila).toContainText("50%");
    await expect(fila).toContainText("$8.000");
    await expect(fila.getByText("Food cost alto")).toHaveCount(0);

    // Un valor fuera de rango se rechaza con su mensaje y no cambia nada.
    await page.goto("/catalogo/margen-objetivo");
    await page.getByLabel("Food cost objetivo (%)").fill("100");
    await page.locator("section", { hasText: "De toda la empresa" }).getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText(/tiene que ser menor que 100 %/)).toBeVisible();
  } finally {
    await prisma.margenObjetivo.deleteMany();
    await prisma.movimientoStock.deleteMany({ where: { productoId: mp.id } });
    await prisma.operacion.deleteMany({ where: { id: operacion.id } });
    await prisma.recetaVersion.deleteMany({ where: { productoId: plato.id } });
    await prisma.producto.deleteMany({ where: { id: { in: [mp.id, plato.id] } } });
    await prisma.categoriaProducto.deleteMany({ where: { id: categoria.id } });
  }
});

test("un operario no ve el enlace ni puede abrir la pantalla del margen objetivo", async ({ browser, baseURL, sucursalId }) => {
  const { id: empresaId } = await prisma.empresa.findFirstOrThrow({ where: { estado: "ACTIVE" } });
  const operador = await prisma.rol.upsert({ where: { empresaId_clave: { empresaId, clave: "operador" } }, update: { activo: true }, create: { nombre: "operador", clave: "operador" } });
  const usuario = await prisma.user.create({ data: { email: `e2e-operador-objetivo-${Date.now()}@local.test`, activoGlobal: true } });
  await crearMembresia({ usuarioId: usuario.id, sucursalId, rolId: operador.id, activo: true });
  const sessionToken = randomUUID();
  await prisma.session.create({ data: { sessionToken, userId: usuario.id, expires: new Date(Date.now() + 1000 * 60 * 60) } });
  const contexto = await browser.newContext();
  await contexto.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: new URL(baseURL ?? "http://localhost:3000").hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = await contexto.newPage();
  try {
    await page.goto("/catalogo/margen-objetivo");
    await expect(page.getByText(/No tenés permiso para ver esta sección/)).toBeVisible();
    await expect(page.locator('a[href="/catalogo/margen-objetivo"]')).toHaveCount(0);
  } finally {
    await contexto.close();
    await prisma.session.deleteMany({ where: { userId: usuario.id } });
    await prisma.usuarioSucursal.deleteMany({ where: { usuarioId: usuario.id } });
    await prisma.usuarioEmpresa.deleteMany({ where: { usuarioId: usuario.id } });
    await prisma.user.deleteMany({ where: { id: usuario.id } });
  }
});

test("el reporte por período avisa de los platos fuera del objetivo solo si la empresa cargó uno, y lleva a Costos", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const marca = Date.now();
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const mp = await prisma.producto.create({ data: { codigo: `E2E-MP-ALERTA-${marca}`, nombre: `E2E Insumo Alerta ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  const plato = await prisma.producto.create({ data: { codigo: `E2E-PV-ALERTA-${marca}`, nombre: `E2E Plato Alerta ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 10000 } });
  await prisma.recetaVersion.create({ data: { productoId: plato.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: kg.id }] } } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const operacion = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: admin.id } });
  await prisma.movimientoStock.create({
    data: { operacionId: operacion.id, productoId: mp.id, seccionId, proceso: "COMPRA", cantidad: 10, detalle: "Compra", precioTotal: 40000, precioPorUnidadStock: 4000 },
  });
  const alerta = page.getByText(/sobre el objetivo cargado/);
  const fijarObjetivo = async (pct: string) => {
    await page.goto("/catalogo/margen-objetivo");
    await page.getByLabel("Food cost objetivo (%)").fill(pct);
    await page.locator("section", { hasText: "De toda la empresa" }).getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText(`Food cost objetivo de la empresa: ${pct} %.`)).toBeVisible();
  };
  try {
    // Sin objetivo cargado (rige el 40 % por defecto, sin avisar nada) el Período no dice nada del margen.
    await page.goto("/reportes/periodo");
    await expect(page.getByRole("heading", { name: "Reporte por período" })).toBeVisible();
    await expect(alerta).toHaveCount(0);

    // Con un objetivo que el plato (40 %) no cumple, aparece la alerta con el enlace a Costos.
    await fijarObjetivo("30");
    await page.goto("/reportes/periodo");
    await expect(alerta).toBeVisible();
    await page.getByRole("link", { name: "Ver en Costos" }).click();
    await page.waitForURL((url) => url.pathname === "/reportes/costos");
    await expect(page.getByRole("heading", { name: "Costos y márgenes" })).toBeVisible();

    // Con un objetivo que cumple, la alerta desaparece.
    await fijarObjetivo("50");
    await page.goto("/reportes/periodo");
    await expect(page.getByRole("heading", { name: "Reporte por período" })).toBeVisible();
    await expect(alerta).toHaveCount(0);
  } finally {
    await prisma.margenObjetivo.deleteMany();
    await prisma.movimientoStock.deleteMany({ where: { productoId: mp.id } });
    await prisma.operacion.deleteMany({ where: { id: operacion.id } });
    await prisma.recetaVersion.deleteMany({ where: { productoId: plato.id } });
    await prisma.producto.deleteMany({ where: { id: { in: [mp.id, plato.id] } } });
  }
});
