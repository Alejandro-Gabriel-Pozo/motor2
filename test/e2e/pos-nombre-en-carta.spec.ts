import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { prismaAdmin } from "../setup/cliente-duenio";
import { borrarRecetasDeReventa, darRecetaDeReventa } from "../setup/receta-de-venta";

/**
 * «Nombre en la carta» (2026-11-04; `docs/diseno-nombre-en-carta-2026-11-04.md`) en el selector del mozo, a 375 px de ancho, con el servidor de producción y la base real: el botón del plato dice el nombre
 * de la CARTA de la sucursal (no el interno) y el que no lo tiene sigue con el nombre del producto. Al tocarlo, la lista «Por agregar» lo nombra con el nombre del producto (decisión declarada: la
 * comanda, el ticket y la lista siguen con el interno). Sin desborde horizontal ni violaciones de axe.
 */
test("selector del mozo: el plato con «Nombre en la carta» se ve con ese nombre y el otro con el del producto, a 375 px", async ({ paginaAutenticada: page, sucursalId }) => {
  test.setTimeout(90_000);
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const reventas: { pv: string; mp: string }[] = [];
  const crear = async (clave: string, nombre: string, precioVenta: number) => {
    const p = await prisma.producto.create({ data: { codigo: `E2E-NC-${clave}-${marca}`, nombre, tipo: "PV", unidadStockId: unidad.id, precioVenta } });
    reventas.push({ pv: p.id, mp: (await darRecetaDeReventa(prisma, p, { sucursalIds: [sucursalId] })).id });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
    return p;
  };
  const interno = `E2E Milanesa napolitana con guarnición de la casa ${marca}`;
  const deCarta = `E2E La Napo ${marca}`;
  const milanesa = await crear("MILA", interno, 9000);
  const bife = await crear("BIFE", `E2E Bife de chorizo ${marca}`, 34000);
  const productoIds = [milanesa.id, bife.id];
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Platos ${marca}`, orden: 1 } });
  await prisma.contenidoCartaProducto.createMany({
    data: [
      { sucursalId, productoId: milanesa.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 1, nombreEnCarta: deCarta },
      { sucursalId, productoId: bife.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 2 },
    ],
  });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 984 } });
  await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id } });
  try {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/mesas/${mesa.id}`);
    await expect(page.locator("main h1")).toHaveText("Mesa 984");
    await page.getByRole("group", { name: "Secciones de la carta" }).getByRole("button", { name: seccion.nombre }).click();
    const region = page.getByRole("region", { name: seccion.nombre });

    // El botón dice el nombre de la carta; el nombre interno no aparece en el selector.
    await expect(region.getByRole("button", { name: deCarta })).toBeVisible();
    await expect(region.getByRole("button", { name: interno })).toHaveCount(0);
    await expect(region.getByRole("button", { name: `E2E Bife de chorizo ${marca}` })).toBeVisible();

    // Sin desborde horizontal ni violaciones de accesibilidad.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "la página se desborda a 375 px").toBe(true);
    expect((await new AxeBuilder({ page }).include("[data-selector-carta]").analyze()).violations).toEqual([]);

    // Tocarlo lo suma a «Por agregar», que lo nombra con el nombre del producto.
    await region.getByRole("button", { name: deCarta }).click();
    await expect(page.locator(`[data-linea-por-agregar="${interno}"]`)).toBeVisible();
  } finally {
    await prisma.cuentaItem.deleteMany({ where: { cuenta: { mesaId: mesa.id } } });
    await prismaAdmin.agregadoDeCuenta.deleteMany({ where: { cuenta: { mesaId: mesa.id } } });
    await prisma.cuenta.deleteMany({ where: { mesaId: mesa.id } });
    await prisma.mesa.deleteMany({ where: { id: mesa.id } });
    await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: { in: productoIds } } });
    await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
    await borrarRecetasDeReventa(prisma, { pvIds: reventas.map((r) => r.pv), mpIds: reventas.map((r) => r.mp) });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: productoIds } } });
    await prisma.producto.deleteMany({ where: { id: { in: productoIds } } });
  }
});
