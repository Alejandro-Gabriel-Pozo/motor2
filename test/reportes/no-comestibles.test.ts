import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { clasificarGruposNoComestibles, normalizarNombreGrupo } from "../../src/core/catalogo/no-comestibles";
import { calcularCostosYMargenes, calcularImpactoRecetasPorPeriodo } from "../../src/core/reportes/costos";
import { obtenerReportePorPeriodo } from "../../src/core/reportes/periodo";

/**
 * «No comestibles» (USAR): packaging y limpieza no cuentan en el food cost ni en el ratio Compras/Ventas. Se reconocen por el árbol de
 * Grupos: un Insumo del grupo «No comestibles» o de cualquiera de sus hijos.
 */
describe("clasificarGruposNoComestibles (puro)", () => {
  const arbol = new Map([
    ["g1", { nombre: "No comestibles", grupoPadreId: null }],
    ["g2", { nombre: "Packaging", grupoPadreId: "g1" }],
    ["g3", { nombre: "Cajas", grupoPadreId: "g2" }],
    ["g4", { nombre: "Lácteos", grupoPadreId: null }],
    ["g5", { nombre: "Quesos", grupoPadreId: "g4" }],
  ]);

  it("el grupo «No comestibles» y todos sus descendientes, a cualquier profundidad", () => {
    const r = clasificarGruposNoComestibles(arbol);
    expect(r.existeGrupo).toBe(true);
    expect([...r.idsGrupos].sort()).toEqual(["g1", "g2", "g3"]);
  });

  it("el nombre se reconoce sin importar mayúsculas, tildes ni espacios", () => {
    expect(normalizarNombreGrupo("  NO   Comestíbles ")).toBe("no comestibles");
    const r = clasificarGruposNoComestibles(new Map([["x", { nombre: " NO comestíbles ", grupoPadreId: null }]]));
    expect(r.existeGrupo).toBe(true);
    expect(r.idsGrupos.has("x")).toBe(true);
  });

  it("sin ese grupo no se excluye nada", () => {
    const r = clasificarGruposNoComestibles(new Map([["g4", { nombre: "Lácteos", grupoPadreId: null }]]));
    expect(r.existeGrupo).toBe(false);
    expect(r.idsGrupos.size).toBe(0);
  });

  it("un ciclo en el árbol no cuelga el cálculo", () => {
    const ciclo = new Map([
      ["a", { nombre: "A", grupoPadreId: "b" }],
      ["b", { nombre: "B", grupoPadreId: "a" }],
    ]);
    expect(clasificarGruposNoComestibles(ciclo).existeGrupo).toBe(false);
  });
});

describe("No comestibles en los reportes", () => {
  let sucursalId: string;
  let seccionId: string;
  let harinaId: string;
  let cajaId: string;
  let panId: string;
  let grupoNoComestiblesId: string;

  const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    await prisma.insumo.deleteMany();
    await prisma.grupo.deleteMany();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const { kg } = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    harinaId = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id } })).id;
    cajaId = (await prisma.producto.create({ data: { codigo: "MP_CAJA", nombre: "Caja de pizza", tipo: "MP", unidadStockId: kg.id } })).id;
    const pan = await prisma.producto.create({ data: { codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
    panId = pan.id;
    // Receta: 2 kg de harina ($5/kg) + 1 caja ($10): comida $10, packaging $10, costo total $20.
    await prisma.recetaVersion.create({
      data: { productoId: pan.id, version: 1, ingredientes: { create: [{ insumoProductoId: harinaId, cantidad: 2, unidadId: kg.id }, { insumoProductoId: cajaId, cantidad: 1, unidadId: kg.id }] } },
    });
    grupoNoComestiblesId = (await prisma.grupo.create({ data: { nombre: "No comestibles" } })).id;
  });

  async function marcarCajaNoComestible() {
    const packaging = await prisma.grupo.create({ data: { nombre: "Packaging", grupoPadreId: grupoNoComestiblesId } });
    const insumo = await prisma.insumo.create({ data: { nombre: "Cajas", grupoId: packaging.id } });
    await prisma.producto.update({ where: { id: cajaId }, data: { insumoId: insumo.id } });
  }

  async function comprarYVender(mes: string) {
    await registrarMovimiento({ proceso: "COMPRA", fecha: d(`${mes}-05`), seccionId, items: [{ productoId: harinaId, cantidad: 10, precioTotal: 50 }] }); // $50 de comida
    await registrarMovimiento({ proceso: "COMPRA", fecha: d(`${mes}-05`), seccionId, items: [{ productoId: cajaId, cantidad: 10, precioTotal: 100 }] }); // $100 de packaging
    const v = await registrarVenta({ fecha: d(`${mes}-06`), seccionId, ventas: [{ productoId: panId, cantidadVendida: 1 }] });
    expect(v.ok, v.mensaje).toBe(true);
  }

  it("el ratio Compras/Ventas solo cuenta comida y bebida, y muestra aparte lo no comestible", async () => {
    await marcarCajaNoComestible();
    await comprarYVender("2026-08");

    const rep = await obtenerReportePorPeriodo(sucursalId, d("2026-08-01"), d("2026-08-31"));

    expect(rep.compras.totalGastado).toBe(150);
    expect(rep.compras.totalNoComestibles).toBe(100);
    expect(rep.ratioGastoVentas.excluyeNoComestibles).toBe(true);
    expect(rep.ratioGastoVentas.gastoNoComestibles).toBe(100);
    expect(rep.ratioGastoVentas.porcentaje).toBe(50); // $50 de comida ÷ $100 vendido (antes: 150 %)
    expect(rep.ratioGastoVentas.aviso).toContain("quedan fuera");
  });

  it("el período anterior se calcula con el mismo criterio, para que la comparación sea justa", async () => {
    await marcarCajaNoComestible();
    await comprarYVender("2026-07");
    await comprarYVender("2026-08");

    const rep = await obtenerReportePorPeriodo(sucursalId, d("2026-08-01"), d("2026-08-31"));

    expect(rep.ratioGastoVentas.porcentaje).toBe(50);
    expect(rep.ratioGastoVentas.porcentajePeriodoAnterior).toBe(50);
  });

  it("sin el grupo «No comestibles», todo cuenta como antes y el aviso explica cómo separarlos", async () => {
    await prisma.grupo.delete({ where: { id: grupoNoComestiblesId } });
    await comprarYVender("2026-08");

    const rep = await obtenerReportePorPeriodo(sucursalId, d("2026-08-01"), d("2026-08-31"));

    expect(rep.ratioGastoVentas.excluyeNoComestibles).toBe(false);
    expect(rep.compras.totalNoComestibles).toBe(0);
    expect(rep.ratioGastoVentas.porcentaje).toBe(150);
    expect(rep.ratioGastoVentas.aviso).toContain("creá el grupo «No comestibles»");
  });

  it("el food cost del plato es solo de comida y bebida; el costo y el margen incluyen el packaging", async () => {
    await marcarCajaNoComestible();
    await comprarYVender("2026-08");

    const fila = (await calcularCostosYMargenes(sucursalId)).find((f) => f.productoId === panId)!;

    expect(fila.costo).toBe(20); // 2 kg × $5 + 1 caja × $10
    expect(fila.costoNoComestible).toBe(10);
    expect(fila.foodCostPct).toBe(10); // (20 − 10) ÷ 100
    expect(fila.margen).toBe(80); // el margen sí descuenta el packaging
  });

  it("un plato con mucho packaging no se marca «Food cost alto» por el packaging", async () => {
    await prisma.producto.update({ where: { id: panId }, data: { precioVenta: 40 } }); // costo total $20 = 50 % del precio; comida $10 = 25 %
    await marcarCajaNoComestible();
    await comprarYVender("2026-08");

    const conGrupo = (await calcularCostosYMargenes(sucursalId)).find((f) => f.productoId === panId)!;
    expect(conGrupo.estado).toBe("OK");

    await prisma.producto.update({ where: { id: cajaId }, data: { insumoId: null } }); // sin clasificar, la caja cuenta como comida
    const sinClasificar = (await calcularCostosYMargenes(sucursalId)).find((f) => f.productoId === panId)!;
    expect(sinClasificar.estado).toBe("FOOD_COST_ALTO");
  });

  it("Impacto en recetas: si sube solo el packaging, el costo sube pero el food cost % no se mueve; sin clasificar, sí", async () => {
    await marcarCajaNoComestible();
    // La caja cuesta $10 el 1/8 y $20 el 10/8; la harina, $5 siempre.
    await registrarMovimiento({ proceso: "COMPRA", fecha: d("2026-08-01"), seccionId, items: [{ productoId: harinaId, cantidad: 10, precioTotal: 50 }, { productoId: cajaId, cantidad: 10, precioTotal: 100 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: d("2026-08-10"), seccionId, items: [{ productoId: cajaId, cantidad: 10, precioTotal: 200 }] });

    const [fila] = await calcularImpactoRecetasPorPeriodo(sucursalId, d("2026-08-05"));
    expect([fila.costoAntes, fila.costoActual, fila.deltaCosto]).toEqual([20, 30, 10]); // costo total: harina $10 + caja $10 → caja $20
    expect([fila.foodCostPctAntes, fila.foodCostPctActual]).toEqual([10, 10]); // food cost: solo la harina, no cambió

    await prisma.producto.update({ where: { id: cajaId }, data: { insumoId: null } }); // sin clasificar, la caja cuenta como comida
    const [sinClasificar] = await calcularImpactoRecetasPorPeriodo(sucursalId, d("2026-08-05"));
    expect([sinClasificar.foodCostPctAntes, sinClasificar.foodCostPctActual]).toEqual([20, 30]);
  });
});
