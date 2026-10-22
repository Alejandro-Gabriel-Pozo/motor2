import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { capturar, expectSinDesborde, fijarCelular } from "./fixtures/movil";

/**
 * MOVIL (375 × 812): «Secciones» y «Conteo físico» de Movimientos no se salen por la derecha (y sin violaciones de axe) CON DATOS. `movil-sin-desborde` mide las pantallas con lo que trae la base de pruebas (casi vacías);
 * estas dos traen tablas anchas (la de secciones, con el campo de renombrar, dos Sí/No y dos acciones por fila; el historial del conteo, con ocho columnas) y la grilla de conteo, que solo
 * se dibujan con filas. Una tabla ancha tiene que desplazarse DENTRO de su caja (overflow-x-auto) y no ensanchar la página.
 */
test("celular (375 px): Secciones y Conteo físico, con filas, no se salen por la derecha", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  test.setTimeout(240_000);
  const marca = Date.now();
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const seccion = await prisma.seccion.findUniqueOrThrow({ where: { id: seccionId } });
  const larga = await prisma.seccion.create({ data: { sucursalId, nombre: `E2E Depósito con un nombre bastante largo ${marca}` } });

  const productos = [];
  const operaciones: string[] = [];
  for (const [i, nombre] of ["Harina de trigo 000 extra fina de molienda", "Aceite de girasol alto oleico", "Sal"].entries()) {
    const producto = await prisma.producto.create({ data: { codigo: `E2E-MSC-${i}-${marca}`, nombre: `${nombre} ${marca}`, tipo: "MP", unidadStockId: kg.id } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
    const compra = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: admin.id } });
    operaciones.push(compra.id);
    await prisma.movimientoStock.create({
      data: { operacionId: compra.id, productoId: producto.id, seccionId, proceso: "COMPRA", cantidad: 10, detalle: "Stock inicial del test", precioTotal: 0, precioPorUnidadStock: 0 },
    });
    productos.push(producto);
  }
  // Un conteo pendiente y uno resuelto para que el historial dibuje sus filas con las acciones.
  await prisma.conteoFisico.create({
    data: { sucursalId, fecha: new Date(), productoId: productos[0].id, seccionId, saldoSistema: 10, conteoReal: 8, diferencia: -2, accion: "AJUSTAR", estado: "PENDIENTE", usuarioId: admin.id },
  });
  await prisma.conteoFisico.create({
    data: { sucursalId, fecha: new Date(), productoId: productos[1].id, seccionId, saldoSistema: 10, conteoReal: 10, diferencia: 0, accion: "AJUSTAR", estado: "RESUELTO", usuarioId: admin.id },
  });

  try {
    await fijarCelular(page);
    for (const ruta of ["/movimientos/secciones", `/movimientos/conteo-fisico?seccionId=${seccion.id}`]) {
      await page.goto(ruta);
      await expect(page.locator("h1").first(), `${ruta}: la pantalla cargó`).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expectSinDesborde(page, ruta);
      // La tabla que se desplaza dentro de su caja es una región con nombre y foco de teclado (axe: scrollable-region-focusable).
      expect((await new AxeBuilder({ page }).analyze()).violations, `${ruta}: axe a 375 px`).toEqual([]);
      await capturar(page, `movil-${ruta.split("?")[0].split("/").pop()}`);
    }
  } finally {
    await prisma.conteoFisico.deleteMany({ where: { productoId: { in: productos.map((p) => p.id) } } });
    await prisma.movimientoStock.deleteMany({ where: { productoId: { in: productos.map((p) => p.id) } } });
    await prisma.operacion.deleteMany({ where: { id: { in: operaciones } } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: productos.map((p) => p.id) } } });
    await prisma.producto.deleteMany({ where: { id: { in: productos.map((p) => p.id) } } });
    await prisma.seccion.deleteMany({ where: { id: larga.id } });
  }
});
