import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import type { Db } from "../../src/lib/db-tipos";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { registrarConteoFisico } from "../../src/server/actions/movimientos/conteo-fisico";
import { calcularRendimientoRecetas, calcularRendimientoRecetasCompartidas, calcularRendimientoRecetasSimples } from "../../src/server/consultas/reportes/rendimiento-recetas";

/**
 * O.37 (docs/pureza-integracion.md): el reporte de rendimiento de recetas leía POR POOL dentro de un bucle (apertura/cierre, entradas, ventas, conteos, un
 * `groupBy` por cada día de ancla, los hermanos del Insumo, los movimientos y las ventas de cada tramo/intervalo). Ahora lee en bloque para todos los pools.
 * Este test fija que la cantidad de consultas NO crece con la carta: el mismo escenario con 2 y con 5 pools (cada uno con sus propios días de ancla, así que
 * también crecen los días) tiene que hacer exactamente las mismas consultas, y por el método CONTEO (el camino que más lee). El resultado de cada pool lo
 * cubren `rendimiento-recetas.test.ts` y la caracterización C0; acá solo se mira que todas las filas salgan por CONTEO y resueltas.
 */

/** Las consultas que hace `f`, contadas con `$allOperations` de primer nivel (en Prisma 7 ve las de modelo y las crudas; sumar `$allModels` contaría doble). */
async function contarConsultas<T>(f: (db: Db) => Promise<T>): Promise<{ resultado: T; consultas: string[] }> {
  const consultas: string[] = [];
  const db = prisma.$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        consultas.push(model ? `${model}.${operation}` : operation);
        return query(args);
      },
    },
  }) as unknown as Db;
  const resultado = await f(db);
  return { resultado, consultas: consultas.sort() };
}

const desde = new Date("2026-01-01");
const hasta = new Date("2026-03-15");
const dia = (base: string, mas: number) => new Date(new Date(base).getTime() + mas * 24 * 60 * 60 * 1000);

/**
 * `n` pools SIMPLES (Insumo con dos MP —la segunda, hermana sin movimientos— y un plato 1:1 sobre la primera, con dos conteos que la cubren en días propios
 * de cada pool) y `n` pools COMPARTIDOS (Insumo con nalga/lomo, dos platos a 0,1 y cuatro anclas —tres intervalos— también en días propios).
 */
async function sembrar(n: number) {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  const sucursalId = base.sucursal.id;
  const { kg } = await sembrarCatalogoBase();
  const seccionId = (await sembrarSeccion(sucursalId)).id;
  const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
  await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  const producto = (codigo: string, tipo: "MP" | "PV", insumoId?: string) => sembrarProductoDisponible({ codigo, nombre: codigo, tipo, unidadStockId: kg.id, ...(insumoId ? { insumoId } : {}) }, sucursalId);
  const conteo = async (productoId: string, conteoReal: number, fechaConteo: Date) => {
    const r = await registrarConteoFisico({ productoId, seccionId, conteoReal, fechaConteo, accion: "AJUSTAR" });
    expect(r.ok, r.mensaje).toBe(true);
  };

  for (let i = 0; i < n; i++) {
    const insumo = await prisma.insumo.create({ data: { nombre: `Agua ${i}` } });
    const caja = await producto(`MP_AGUA_${i}`, "MP", insumo.id);
    await producto(`MP_AGUA_HERMANA_${i}`, "MP", insumo.id);
    const botella = await producto(`PV_AGUA_${i}`, "PV");
    await prisma.recetaVersion.create({ data: { productoId: botella.id, version: 1, ingredientes: { create: [{ insumoProductoId: caja.id, cantidad: 1, unidadId: kg.id }] } } });
    await conteo(caja.id, 0, dia("2026-01-02", i));
    // Con precio (O.30): así el costo de reposición entra al resultado (`impactoPesos`, `sinCosto`) y la comparación de la combinada lo ve.
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-10"), seccionId, items: [{ productoId: caja.id, cantidad: 10, precioTotal: 50 }] });
    await registrarVenta({ fecha: new Date("2026-01-15"), seccionId, ventas: [{ productoId: botella.id, cantidadVendida: 6 }] });
    await conteo(caja.id, 4, dia("2026-01-25", i));
  }

  for (let j = 0; j < n; j++) {
    const insumo = await prisma.insumo.create({ data: { nombre: `Carne ${j}` } });
    const nalga = await producto(`MP_NALGA_${j}`, "MP", insumo.id);
    const lomo = await producto(`MP_LOMO_${j}`, "MP", insumo.id);
    const milanesa = await producto(`PV_MILA_${j}`, "PV");
    const bife = await producto(`PV_BIFE_${j}`, "PV");
    await prisma.recetaVersion.create({ data: { productoId: milanesa.id, version: 1, ingredientes: { create: [{ insumoProductoId: nalga.id, cantidad: 0.1, unidadId: kg.id }] } } });
    await prisma.recetaVersion.create({ data: { productoId: bife.id, version: 1, ingredientes: { create: [{ insumoProductoId: lomo.id, cantidad: 0.1, unidadId: kg.id }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2025-12-01"), seccionId, items: [{ productoId: nalga.id, cantidad: 1000, precioTotal: 5000 }, { productoId: lomo.id, cantidad: 1000, precioTotal: 8000 }] });
    await conteo(nalga.id, 1000, dia("2026-01-02", j));
    await conteo(lomo.id, 1000, dia("2026-01-02", j));
    // Mismos pares (m, b) que el test de CONTEO de `rendimiento-recetas.test.ts`: la mezcla varía y la regresión resuelve.
    let saldoNalga = 1000;
    let saldoLomo = 1000;
    for (const t of [{ venta: "2026-01-10", m: 10, b: 4, cierre: "2026-01-16" }, { venta: "2026-01-24", m: 6, b: 12, cierre: "2026-01-30" }, { venta: "2026-02-07", m: 15, b: 2, cierre: "2026-02-13" }]) {
      await registrarVenta({ fecha: dia(t.venta, j), seccionId, ventas: [{ productoId: milanesa.id, cantidadVendida: t.m }, { productoId: bife.id, cantidadVendida: t.b }] });
      saldoNalga = Math.round((saldoNalga - 0.1 * t.m) * 100) / 100;
      saldoLomo = Math.round((saldoLomo - 0.1 * t.b) * 100) / 100;
      await conteo(nalga.id, saldoNalga, dia(t.cierre, j));
      await conteo(lomo.id, saldoLomo, dia(t.cierre, j));
    }
  }
  return sucursalId;
}

describe("rendimiento de recetas: la cantidad de consultas no crece con la cantidad de pools ni de días de ancla (O.37)", () => {
  it("con 2 y con 5 pools (simples y compartidos, por CONTEO) hace exactamente las mismas consultas", async () => {
    const medido: Record<number, { simples: string[]; compartidas: string[] }> = {};
    for (const n of [2, 5]) {
      const sucursalId = await sembrar(n);
      const simples = await contarConsultas((db) => calcularRendimientoRecetasSimples(sucursalId, desde, hasta, db));
      const compartidas = await contarConsultas((db) => calcularRendimientoRecetasCompartidas(sucursalId, desde, hasta, db));
      // El escenario ejercita el camino que más lee: todas las filas por CONTEO.
      expect(simples.resultado).toHaveLength(n);
      expect(simples.resultado.every((f) => f.metodo === "CONTEO" && f.consumoReal === 6)).toBe(true);
      expect(compartidas.resultado).toHaveLength(2 * n);
      expect(compartidas.resultado.every((f) => f.metodo === "CONTEO" && f.resoluble)).toBe(true);
      medido[n] = { simples: simples.consultas, compartidas: compartidas.consultas };
    }
    expect(medido[5].simples).toEqual(medido[2].simples);
    expect(medido[5].compartidas).toEqual(medido[2].compartidas);
    // Y el número, para que una lectura de más (aunque no crezca con N) también se vea.
    expect(medido[2].simples).toHaveLength(15);
    expect(medido[2].compartidas).toHaveLength(15);
  }, 120_000);
});

/**
 * Las lecturas que las dos fases por separado repetían (O.30): `construirPools` (los productos disponibles, la clasificación de no comestibles —`grupo`—,
 * las recetas vigentes —`recetaSucursal` y `recetaVersion`— y los hermanos de los Insumos —el segundo `producto.findMany`—) y `obtenerCostoActualPorMP`
 * (`$queryRaw`). La combinada las hace una sola vez. (`contarConsultas` anota el modelo como lo entrega Prisma, con mayúscula.)
 */
const LECTURAS_COMPARTIDAS_ENTRE_FASES = ["$queryRaw", "Grupo.findMany", "Producto.findMany", "Producto.findMany", "RecetaSucursal.findMany", "RecetaVersion.findMany"];

/** `todas` sin UNA copia de cada elemento de `quitar` (multiconjunto); falla si alguno no estaba. */
function sinUnaCopiaDe(todas: readonly string[], quitar: readonly string[]): string[] {
  const restantes = [...todas];
  for (const q of quitar) {
    const i = restantes.indexOf(q);
    expect(i, `falta ${q} entre las consultas de las dos fases`).toBeGreaterThanOrEqual(0);
    restantes.splice(i, 1);
  }
  return restantes.sort();
}

describe("rendimiento de recetas: la pantalla construye los pools y lee el costo UNA vez para las dos tablas (O.30)", () => {
  it("calcularRendimientoRecetas da lo mismo que las dos fases por separado, con una sola construcción de pools, con 2 y con 5 pools", async () => {
    const medido: Record<number, string[]> = {};
    for (const n of [2, 5]) {
      const sucursalId = await sembrar(n);
      const simples = await contarConsultas((db) => calcularRendimientoRecetasSimples(sucursalId, desde, hasta, db));
      const compartidas = await contarConsultas((db) => calcularRendimientoRecetasCompartidas(sucursalId, desde, hasta, db));
      const combinada = await contarConsultas((db) => calcularRendimientoRecetas(sucursalId, desde, hasta, db));
      // Mismas filas, en el mismo orden, que las dos funciones de antes (las que usaba la página).
      expect(combinada.resultado).toStrictEqual({ simples: simples.resultado, compartidas: compartidas.resultado });
      expect(combinada.resultado.simples).toHaveLength(n);
      expect(combinada.resultado.compartidas).toHaveLength(2 * n);
      // El costo de reposición (la lectura que la combinada comparte) llega a las dos tablas: un costo mal pasado cambiaría estas filas.
      expect(combinada.resultado.simples.every((f) => !f.sinCosto)).toBe(true);
      expect(combinada.resultado.compartidas.every((f) => !f.sinCosto)).toBe(true);
      // Exactamente las consultas de las dos fases menos UNA copia de las que repetían (pools y costo).
      expect(combinada.consultas).toEqual(sinUnaCopiaDe([...simples.consultas, ...compartidas.consultas], LECTURAS_COMPARTIDAS_ENTRE_FASES));
      medido[n] = combinada.consultas;
    }
    expect(medido[5]).toEqual(medido[2]);
    // 15 + 15 − 6: el número exacto, para que una lectura de más (p. ej. construir los pools dos veces) se vea.
    expect(medido[2]).toHaveLength(24);
  }, 120_000);
});
