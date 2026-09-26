import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Venta fraccionada en el POS (Task #25, docs/plan-venta-fraccionada-2026-09-26.md): un producto con `pasoVenta` acepta un
 * múltiplo exacto del paso (ej. 0,5) SIN redondearlo, y rechaza cualquier otra cantidad con un mensaje claro — a diferencia de un
 * producto SIN paso, que sigue redondeando en silencio como siempre (bug ya fijado como comportamiento "correcto" hoy en
 * test/pos/cuenta-action.test.ts).
 */
async function sembrarPizzaFraccionada(sucursalId: string) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  // 0 decimales, a propósito: el bug corregido es EXACTAMENTE "0,5 en una unidad de 0 decimales se redondea en silencio".
  const unidad = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "unidad" } });
  const pizza = await prisma.producto.create({
    data: { codigo: `E2E-VF-${marca}`, nombre: `E2E Pizza fraccionada ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 12000, pasoVenta: 0.5 },
  });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: pizza.id, disponible: true } });
  return {
    pizza,
    limpiar: async (mesaIds: string[]) => {
      await prisma.cuentaItem.deleteMany({ where: { cuenta: { mesaId: { in: mesaIds } } } });
      await prisma.cuenta.deleteMany({ where: { mesaId: { in: mesaIds } } });
      await prisma.mesa.deleteMany({ where: { id: { in: mesaIds } } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: pizza.id } });
      await prisma.producto.deleteMany({ where: { id: pizza.id } });
    },
  };
}

async function mesaConCuenta(sucursalId: string, numero: number) {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero } });
  const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: admin.id } });
  return { mesa, cuenta };
}

const aviso = (page: import("@playwright/test").Page) => page.locator('[role="status"][aria-live="polite"]');

test("un múltiplo exacto del paso (0,5) se acepta tal cual, sin redondear; muestra la ayuda 'Se vende de a 0,5'", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarPizzaFraccionada(sucursalId);
  const { mesa, cuenta } = await mesaConCuenta(sucursalId, 981);
  try {
    await page.goto(`/mesas/${mesa.id}`);
    const combo = page.getByRole("combobox", { name: "Producto" });
    await combo.fill(cat.pizza.nombre);
    await page.getByRole("option", { name: new RegExp(cat.pizza.nombre) }).click();

    await expect(page.getByText("Se vende de a 0,5")).toBeVisible();

    const campoCantidad = page.getByLabel(`Cantidad de ${cat.pizza.nombre}`, { exact: true });
    await campoCantidad.fill("0,5");
    await campoCantidad.blur();
    await expect(page.getByRole("form", { name: "Agregar producto" }).getByRole("alert")).toHaveCount(0);

    await page.getByRole("button", { name: "Agregar 1 al pedido", exact: true }).click();
    await expect(aviso(page)).toHaveText("Se agregó 1 ítem a la mesa 981.");

    const item = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId: cuenta.id } });
    expect(Number(item.cantidad)).toBe(0.5); // NUNCA redondeado a 1, a diferencia de un producto sin paso
    expect(Number(item.precioUnitario) * Number(item.cantidad)).toBe(6000); // proporcional: 0,5 × 12000
  } finally {
    await cat.limpiar([mesa.id]);
  }
});

test("una cantidad que NO es múltiplo exacto del paso se rechaza con un mensaje claro, sin redondear en silencio", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarPizzaFraccionada(sucursalId);
  const { mesa, cuenta } = await mesaConCuenta(sucursalId, 982);
  try {
    await page.goto(`/mesas/${mesa.id}`);
    const combo = page.getByRole("combobox", { name: "Producto" });
    await combo.fill(cat.pizza.nombre);
    await page.getByRole("option", { name: new RegExp(cat.pizza.nombre) }).click();

    const campoCantidad = page.getByLabel(`Cantidad de ${cat.pizza.nombre}`, { exact: true });
    await campoCantidad.fill("0,3");
    await campoCantidad.blur();
    await expect(page.getByText("Se vende de a 0,5: la cantidad tiene que ser un múltiplo exacto.")).toBeVisible();

    // La lista no deja confirmar con la línea en error.
    await expect(page.getByRole("button", { name: /Agregar \d+ al pedido/ })).toBeDisabled();
    expect(await prisma.cuentaItem.count({ where: { cuentaId: cuenta.id } })).toBe(0);
  } finally {
    await cat.limpiar([mesa.id]);
  }
});

test("accesibilidad: la línea con la ayuda de paso, y con el error de paso, sin violaciones", async ({ paginaAutenticada: page, sucursalId }) => {
  const cat = await sembrarPizzaFraccionada(sucursalId);
  const { mesa } = await mesaConCuenta(sucursalId, 983);
  try {
    await page.goto(`/mesas/${mesa.id}`);
    const combo = page.getByRole("combobox", { name: "Producto" });
    await combo.fill(cat.pizza.nombre);
    await page.getByRole("option", { name: new RegExp(cat.pizza.nombre) }).click();
    await expect(page.getByText("Se vende de a 0,5")).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations, "línea con ayuda de paso").toEqual([]);

    const campoCantidad = page.getByLabel(`Cantidad de ${cat.pizza.nombre}`, { exact: true });
    await campoCantidad.fill("0,3");
    await campoCantidad.blur();
    await expect(page.getByRole("form", { name: "Agregar producto" }).getByRole("alert")).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations, "línea con error de paso").toEqual([]);
  } finally {
    await cat.limpiar([mesa.id]);
  }
});
