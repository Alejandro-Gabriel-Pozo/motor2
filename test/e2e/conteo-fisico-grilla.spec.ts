import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Conteo físico: «Registrar conteo» manda TODA la grilla al servidor en una sola llamada (registrarConteosFisicos). Antes era una
 * llamada por fila: si la sesión vencía a mitad del recorrido, las filas ya escritas quedaban escritas y la persona no recibía
 * el parcial (la siguiente llamada la mandaba al login).
 */
test("registrar el conteo de varias filas es UNA llamada al servidor, y se registran todas", async ({ paginaAutenticada: page, seccionId }) => {
  const ahora = Date.now();
  const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const sucursal = await prisma.seccion.findUniqueOrThrow({ where: { id: seccionId } });

  // Tres materias primas con stock en la sección (una compra directa en la base, como punto de partida del conteo).
  const codigos = [`E2E-CF-A-${ahora}`, `E2E-CF-B-${ahora}`, `E2E-CF-C-${ahora}`];
  const productos = [];
  for (const codigo of codigos) {
    const producto = await prisma.producto.create({ data: { codigo, nombre: `E2E Conteo ${codigo}`, tipo: "MP", unidadStockId: kg.id } });
    const operacion = await prisma.operacion.create({ data: { sucursalId: sucursal.sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: admin.id } });
    await prisma.movimientoStock.create({
      data: { operacionId: operacion.id, productoId: producto.id, seccionId, proceso: "COMPRA", cantidad: 10, detalle: "Stock inicial del test", precioTotal: 0, precioPorUnidadStock: 0 },
    });
    productos.push(producto);
  }

  await page.goto(`/movimientos/conteo-fisico?seccionId=${seccionId}`);
  const fila = (codigo: string) => page.getByRole("row", { name: new RegExp(codigo) });
  // Se cuenta 7, 10 (coincide) y 12: dos con diferencia, una sin.
  await fila(codigos[0]).locator("input").first().fill("7");
  await fila(codigos[1]).locator("input").first().fill("10");
  await fila(codigos[2]).locator("input").first().fill("12");

  const llamadas: string[] = [];
  page.on("request", (peticion) => {
    if (peticion.method() === "POST" && peticion.url().includes("/movimientos/conteo-fisico")) llamadas.push(peticion.url());
  });

  await page.getByRole("button", { name: "Registrar conteo", exact: true }).click();
  await expect(page.getByText(/^3 conteo\(s\) registrado\(s\)\./)).toBeVisible();

  // Una sola llamada para las tres filas (antes eran tres).
  expect(llamadas).toHaveLength(1);

  const conteos = await prisma.conteoFisico.findMany({ where: { productoId: { in: productos.map((p) => p.id) } }, orderBy: { conteoReal: "asc" } });
  expect(conteos.map((c) => [Number(c.conteoReal), Number(c.diferencia)])).toEqual([
    [7, -3],
    [10, 0],
    [12, 2],
  ]);
});

test("una grilla de más de 50 filas se manda en tandas (2 llamadas), y se registran todas", async ({ paginaAutenticada: page, seccionId }) => {
  const ahora = Date.now();
  const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const seccion = await prisma.seccion.findUniqueOrThrow({ where: { id: seccionId } });

  const TOTAL = 55;
  const productos = [];
  for (let i = 0; i < TOTAL; i++) {
    const codigo = `E2E-CG-${String(i).padStart(2, "0")}-${ahora}`;
    const producto = await prisma.producto.create({ data: { codigo, nombre: `E2E Grande ${codigo}`, tipo: "MP", unidadStockId: kg.id } });
    const operacion = await prisma.operacion.create({ data: { sucursalId: seccion.sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: admin.id } });
    await prisma.movimientoStock.create({
      data: { operacionId: operacion.id, productoId: producto.id, seccionId, proceso: "COMPRA", cantidad: 10, detalle: "Stock inicial del test", precioTotal: 0, precioPorUnidadStock: 0 },
    });
    productos.push(producto);
  }

  await page.goto(`/movimientos/conteo-fisico?seccionId=${seccionId}`);
  // Todas se cuentan igual que el sistema (10): sin diferencia, el conteo no toca el stock.
  for (const p of productos) await page.getByRole("row", { name: new RegExp(p.codigo) }).locator("input").first().fill("10");

  const llamadas: string[] = [];
  page.on("request", (peticion) => {
    if (peticion.method() === "POST" && peticion.url().includes("/movimientos/conteo-fisico")) llamadas.push(peticion.url());
  });

  await page.getByRole("button", { name: /^(Registrar conteo|Guardando)/ }).click();
  await expect(page.getByText(new RegExp("^" + TOTAL + " conteo\\(s\\) registrado\\(s\\)\\."))).toBeVisible({ timeout: 30_000 });

  expect(llamadas).toHaveLength(2); // 50 + 5
  expect(await prisma.conteoFisico.count({ where: { productoId: { in: productos.map((p) => p.id) } } })).toBe(TOTAL);
});

test("con la sesión vencida, «Registrar conteo» lleva al login y no escribe nada (el aviso de corte no se traga el redirect)", async ({ paginaAutenticada: page, seccionId }) => {
  const ahora = Date.now();
  const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const seccion = await prisma.seccion.findUniqueOrThrow({ where: { id: seccionId } });
  const codigo = `E2E-CS-${ahora}`;
  const producto = await prisma.producto.create({ data: { codigo, nombre: `E2E Sesion ${codigo}`, tipo: "MP", unidadStockId: kg.id } });
  const operacion = await prisma.operacion.create({ data: { sucursalId: seccion.sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: admin.id } });
  await prisma.movimientoStock.create({
    data: { operacionId: operacion.id, productoId: producto.id, seccionId, proceso: "COMPRA", cantidad: 10, detalle: "Stock inicial del test", precioTotal: 0, precioPorUnidadStock: 0 },
  });

  await page.goto(`/movimientos/conteo-fisico?seccionId=${seccionId}`);
  await page.getByRole("row", { name: new RegExp(codigo) }).locator("input").first().fill("4");

  // La sesión vence con la pestaña abierta.
  await prisma.session.deleteMany({ where: { user: { email: "e2e-admin@local.test" } } });
  await page.getByRole("button", { name: "Registrar conteo", exact: true }).click();

  await page.waitForURL(/\/login/);
  expect(await prisma.conteoFisico.count({ where: { productoId: producto.id } })).toBe(0);
});
