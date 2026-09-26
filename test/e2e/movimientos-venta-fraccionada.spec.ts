import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Venta fraccionada en el MOSTRADOR (Task #25, docs/plan-venta-fraccionada-2026-09-26.md): la misma validación de `pasoVenta`
 * del POS aplica acá — a diferencia del resto de la cantidad, que el mostrador sigue sin validar (no redondea, no rechaza nada
 * que no sea del paso).
 */
async function sembrarPizzaFraccionada(sucursalId: string) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const unidad = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "unidad" } });
  const pizza = await prisma.producto.create({
    data: { codigo: `E2E-VFM-${marca}`, nombre: `E2E Pizza mostrador ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 12000, pasoVenta: 0.5 },
  });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: pizza.id, disponible: true } });
  return {
    pizza,
    limpiar: async () => {
      await prisma.movimientoStock.deleteMany({ where: { productoId: pizza.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: pizza.id } });
      await prisma.producto.deleteMany({ where: { id: pizza.id } });
    },
  };
}

test("mostrador: un múltiplo exacto del paso se vende tal cual, proporcional al precio", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarPizzaFraccionada(sucursalId);
  try {
    await page.goto("/movimientos/venta");
    const combo = page.getByRole("combobox", { name: "Producto" });
    await combo.fill(cat.pizza.nombre);
    await page.getByRole("option", { name: new RegExp(cat.pizza.nombre) }).click();
    await page.getByLabel("Cantidad").fill("0,5");
    await page.getByRole("button", { name: "Confirmar venta" }).click();

    await expect(page.getByText(/Se registraron 1 venta/)).toBeVisible();
    const venta = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: cat.pizza.id, proceso: "VENTA" } });
    expect(Number(venta.cantidad)).toBe(-0.5); // nunca redondeado a -1
    expect(Number(venta.precioTotal)).toBe(6000); // proporcional: 0,5 × 12000
  } finally {
    await cat.limpiar();
  }
});

test("mostrador: lo que no es múltiplo exacto del paso se rechaza, con el mismo mensaje que el POS", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarPizzaFraccionada(sucursalId);
  try {
    await page.goto("/movimientos/venta");
    const combo = page.getByRole("combobox", { name: "Producto" });
    await combo.fill(cat.pizza.nombre);
    await page.getByRole("option", { name: new RegExp(cat.pizza.nombre) }).click();
    await page.getByLabel("Cantidad").fill("0,3");
    await page.getByRole("button", { name: "Confirmar venta" }).click();

    await expect(page.getByText(`"${cat.pizza.nombre}": Se vende de a 0,5: la cantidad tiene que ser un múltiplo exacto.`)).toBeVisible();
    expect(await prisma.movimientoStock.count({ where: { productoId: cat.pizza.id } })).toBe(0);
  } finally {
    await cat.limpiar();
  }
});
