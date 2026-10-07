import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { calcularCostosYMargenes } from "../../src/server/lecturas/reportes/costos";
import { type Db } from "../../src/lib/db-tipos";
import { construirIndiceRecetas } from "../../src/server/lecturas/reportes/comun";

/**
 * Paso 5 del plan (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md): el consumo de venta/producción y
 * calcularCostosYMargenes usan el valor EFECTIVO de la sucursal — un override en OTRA sucursal nunca mueve un número de
 * esta, y un override completo/parcial en la propia se refleja exacto.
 */
describe("Rendimiento local: consumo de venta/producción y costos usan el valor efectivo de la sucursal", () => {
  let sucursalAId: string;
  let sucursalBId: string;
  let seccionAId: string;
  let seccionBId: string;
  let unidadKgId: string;
  let mp: { id: string };
  let pv: { id: string };
  let recetaIngredienteId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalAId = base.sucursal.id;
    sucursalBId = (await prisma.sucursal.create({ data: { nombre: "Sucursal B" } })).id;
    const { kg } = await sembrarCatalogoBase();
    unidadKgId = kg.id;
    seccionAId = (await sembrarSeccion(sucursalAId, "Depósito A")).id;
    seccionBId = (await sembrarSeccion(sucursalBId, "Depósito B")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: sucursalAId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    mp = await sembrarProductoDisponible({ codigo: "MP_RL", nombre: "Harina RL", tipo: "MP", unidadStockId: unidadKgId }, sucursalAId);
    await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursalBId, productoId: mp.id, disponible: true } });
    pv = await sembrarProductoDisponible({ codigo: "PV_RL", nombre: "Pan RL", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalAId);
    await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursalBId, productoId: pv.id, disponible: true } });

    const receta = await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, mermaPorcentaje: 0, unidadId: unidadKgId }] } },
      include: { ingredientes: true },
    });
    recetaIngredienteId = receta.ingredientes[0].id;

    // Stock amplio en las dos sucursales, para que ninguna venta rechace por falta de stock.
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mp.id, cantidad: 1000, precioTotal: 10000 }] });
  });

  async function comprarStockEnB() {
    // Sesión de B: sin sesión de usuario propia en el fixture, se escribe el movimiento directo a nivel Prisma (evita
    // necesitar un segundo login) — mismo criterio que otros tests de "otra sucursal" del proyecto.
    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@test.com" } });
    const operacion = await prisma.operacion.create({ data: { sucursalId: sucursalBId, proceso: "COMPRA", fecha: new Date(), usuarioId: admin.id } });
    await prisma.movimientoStock.create({
      data: { operacionId: operacion.id, productoId: mp.id, seccionId: seccionBId, proceso: "COMPRA", cantidad: 1000, detalle: "Compra", precioTotal: 10000, precioPorUnidadStock: 10 },
    });
  }

  it("(1) override en B no cambia nada en A: A sigue consumiendo exacto el valor central", async () => {
    await comprarStockEnB();
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId, sucursalId: sucursalBId, cantidad: 5, mermaPorcentaje: 50 } });

    const venta = await registrarVenta({ fecha: new Date(), seccionId: seccionAId, ventas: [{ productoId: pv.id, cantidadVendida: 3 }] });
    expect(venta.ok, venta.mensaje).toBe(true);

    const consumo = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: mp.id, proceso: "CONSUMO", seccionId: seccionAId } });
    // 3 × 1 × (1+0/100) = 3 — el valor central, sin ningún rastro del override de B.
    expect(Number(consumo.cantidad)).toBe(-3);
  });

  it("(2) override COMPLETO en A da exactamente q×c_override×(1+m_override/100); B no cambia", async () => {
    await comprarStockEnB();
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId, sucursalId: sucursalAId, cantidad: 2, mermaPorcentaje: 25 } });

    const venta = await registrarVenta({ fecha: new Date(), seccionId: seccionAId, ventas: [{ productoId: pv.id, cantidadVendida: 4 }] });
    expect(venta.ok, venta.mensaje).toBe(true);

    const consumoA = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: mp.id, proceso: "CONSUMO", seccionId: seccionAId } });
    // 4 × 2 × 1.25 = 10.
    expect(Number(consumoA.cantidad)).toBe(-10);

    // B sigue usando el central si vendiera (no lo hace acá, pero el índice de B no ve el override de A).
    const indiceB = await construirIndiceRecetas(prisma, sucursalBId);
    const ingB = indiceB.recetaPorProducto.get(pv.id)![0];
    expect(ingB.cantidad).toBe(1);
    expect(ingB.mermaPorcentaje).toBe(0);
    expect(ingB.calibradoLocal).toBe(false);
  });

  it("(3) override PARCIAL (solo merma): la cantidad sigue central, la merma es la calibrada", async () => {
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId, sucursalId: sucursalAId, cantidad: null, mermaPorcentaje: 100 } });

    const venta = await registrarVenta({ fecha: new Date(), seccionId: seccionAId, ventas: [{ productoId: pv.id, cantidadVendida: 2 }] });
    expect(venta.ok, venta.mensaje).toBe(true);

    const consumo = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: mp.id, proceso: "CONSUMO", seccionId: seccionAId } });
    // 2 × 1 (central) × (1 + 100/100) = 4.
    expect(Number(consumo.cantidad)).toBe(-4);
  });

  it("(4) PRODUCCION con override: mismo criterio que la venta", async () => {
    const mpProducida = await sembrarProductoDisponible({ codigo: "MP_RL_PROD", nombre: "Salsa RL", tipo: "MP", unidadStockId: unidadKgId, seProduce: true }, sucursalAId);
    const receta = await prisma.recetaVersion.create({
      data: { productoId: mpProducida.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, mermaPorcentaje: 0, unidadId: unidadKgId }] } },
      include: { ingredientes: true },
    });
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId: receta.ingredientes[0].id, sucursalId: sucursalAId, cantidad: 3, mermaPorcentaje: 0 } });

    const produccion = await registrarMovimiento({ proceso: "PRODUCCION", fecha: new Date(), seccionId: seccionAId, items: [{ productoId: mpProducida.id, cantidad: 2 }] });
    expect(produccion.ok, produccion.mensaje).toBe(true);

    const consumo = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: mp.id, proceso: "CONSUMO", seccionId: seccionAId } });
    // 2 × 3 (override) × 1 = 6.
    expect(Number(consumo.cantidad)).toBe(-6);
  });

  it("(5) calcularCostosYMargenes por sucursal: el costo de la receta usa el override de ESA sucursal", async () => {
    await comprarStockEnB();
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId, sucursalId: sucursalAId, cantidad: 4, mermaPorcentaje: 0 } });

    const costosA = await calcularCostosYMargenes(sucursalAId, prisma);
    const costosB = await calcularCostosYMargenes(sucursalBId, prisma);
    const filaA = costosA.find((f) => f.productoNombre === "Pan RL")!;
    const filaB = costosB.find((f) => f.productoNombre === "Pan RL")!;

    // Costo de Harina RL en A: $10000/1000 = $10/kg (misma compra para las dos, ver beforeEach). Override en A: 4kg → costo = 40.
    expect(filaA.costo).toBe(40);
    // B sin override: costo = 1kg × $10/kg = 10 (con la compra de comprarStockEnB, también $10/kg).
    expect(filaB.costo).toBe(10);
  });

  it("(6) construirIndiceRecetas(db, sucursalId) de otra sucursal, pasado a calcularCostosYMargenes de ESTA, lanza", async () => {
    const indiceDeB = await construirIndiceRecetas(prisma, sucursalBId);
    await expect(calcularCostosYMargenes(sucursalAId, prisma, undefined, indiceDeB)).rejects.toThrow(/otra sucursal|sucursal/i);
  });

  it("(7) catalogo-una-sola-carga.test.ts sigue en 1: el include anidado de rendimientosLocales no suma una consulta más", async () => {
    let llamadas = 0;
    const dbContado = prisma.$extends({
      query: {
        recetaVersion: {
          findMany({ args, query }) {
            llamadas++;
            return query(args);
          },
        },
      },
    }) as unknown as Db;

    await construirIndiceRecetas(dbContado, sucursalAId);
    expect(llamadas).toBe(1);
  });
});
