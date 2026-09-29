import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import AxeBuilder from "@axe-core/playwright";

/**
 * 6b: la tarjeta «Compras» de /reportes/periodo muestra «Compras / Ventas (desembolso)» y «Costo de lo vendido (consumo)» por separado.
 *
 * El reporte agrega sobre TODA la sucursal, y otros specs dejan compras y ventas en 2026-08 y en «hoy»: por eso esta prueba usa una VENTANA DE FECHAS PROPIA
 * (marzo de 2024, que ningún otro spec toca) y un importe exacto que solo esta siembra puede producir. Se siembra directo en la base (marca única, se limpia).
 *
 * Datos: un kg de harina cuesta $5; un pan lleva 2 kg → cuesta $10 y se vende a $100.
 *  - venta del 2/3, ANTES de cualquier compra: no se puede costear (queda afuera y baja la cobertura);
 *  - compra del 5/3: 10 kg por $50;
 *  - venta del 6/3: no guardó su costo, pero se reconstruye con la compra ($10) → «reconstruido».
 * Resultado: costo de lo vendido $10 sobre $100 costeables (10 %), cobertura 50 % de lo vendido → «parcial».
 */
async function sembrar(sucursalId: string, seccionId: string) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const harina = await prisma.producto.create({ data: { codigo: `E2E-CV-MP-${marca}`, nombre: `E2E Harina Consumo ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  const pan = await prisma.producto.create({ data: { codigo: `E2E-CV-PV-${marca}`, nombre: `E2E Pan Consumo ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
  await prisma.recetaVersion.create({ data: { productoId: pan.id, version: 1, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 2, unidadId: kg.id }] } } });

  const operaciones: string[] = [];
  async function venta(fecha: string) {
    const op = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: new Date(`${fecha}T12:00:00Z`), usuarioId: admin.id } });
    operaciones.push(op.id);
    await prisma.movimientoStock.create({
      data: { operacionId: op.id, productoId: pan.id, seccionId, proceso: "VENTA", cantidad: -1, detalle: "Venta", precioTotal: 100, precioPorUnidadStock: 100, costoUnitarioVenta: null },
    });
  }
  await venta("2024-03-02");
  const compra = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date("2024-03-05T12:00:00Z"), usuarioId: admin.id } });
  operaciones.push(compra.id);
  await prisma.movimientoStock.create({
    data: { operacionId: compra.id, productoId: harina.id, seccionId, proceso: "COMPRA", cantidad: 10, detalle: "Compra", precioTotal: 50, precioPorUnidadStock: 5 },
  });
  await venta("2024-03-06");

  const limpiar = async () => {
    await prisma.movimientoStock.deleteMany({ where: { productoId: { in: [harina.id, pan.id] } } });
    await prisma.operacion.deleteMany({ where: { id: { in: operaciones } } });
    await prisma.recetaVersion.deleteMany({ where: { productoId: pan.id } });
    await prisma.producto.deleteMany({ where: { id: { in: [pan.id, harina.id] } } });
  };
  return { limpiar };
}

const VENTANA = "/reportes/periodo?desde=2024-03-01&hasta=2024-03-31";

test("Período muestra el desembolso y el consumo por separado, con «reconstruido» y «parcial» cuando corresponde", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const { limpiar } = await sembrar(sucursalId, seccionId);
  try {
    await page.goto(VENTANA);
    await expect(page.getByRole("heading", { name: "Reporte por período" })).toBeVisible();

    // Los dos rótulos, a la vez y distintos: uno mide lo que se compró, el otro lo que costó lo que se vendió.
    await expect(page.getByText("Compras / Ventas (desembolso):")).toBeVisible();
    const consumo = page.locator("[data-costo-de-lo-vendido]");
    await expect(consumo).toBeVisible();
    await expect(consumo).toContainText("Costo de lo vendido (consumo):");
    await expect(consumo).toContainText("$10 (10%)"); // $10 de costo sobre los $100 costeables
    await expect(consumo).toContainText("· reconstruido"); // la venta del 6/3 no guardó su costo
    await expect(consumo).toContainText("· parcial (cubre 50% de lo vendido)"); // la del 2/3, anterior a toda compra, no se pudo costear

    // El aviso explica la diferencia con el ratio de compras y qué no se pudo costear.
    await expect(consumo.locator("[title]").first()).toHaveAttribute("title", /Mide CONSUMO, a diferencia de Compras\/Ventas/);
    await expect(consumo.locator("[title]").first()).toHaveAttribute("title", /Cubre \$100 de \$200 vendidos \(50 %\)/);
  } finally {
    await limpiar();
  }
});

test("la línea de consumo del reporte por período, con su texto ámbar «parcial», no tiene violaciones de axe (contraste incluido)", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const { limpiar } = await sembrar(sucursalId, seccionId);
  try {
    await page.goto(VENTANA);
    const consumo = page.locator("[data-costo-de-lo-vendido]");
    await expect(consumo.getByText(/· parcial/)).toBeVisible(); // el caso que se quiere auditar (texto ámbar) realmente se dibujó

    // Acotado a la línea nueva: el resto de la pantalla (gráfico de Recharts, formulario de fechas) trae sus propios hallazgos, ajenos a este cambio.
    const resultados = await new AxeBuilder({ page }).include("[data-costo-de-lo-vendido]").analyze();
    expect(resultados.violations).toEqual([]);
  } finally {
    await limpiar();
  }
});
