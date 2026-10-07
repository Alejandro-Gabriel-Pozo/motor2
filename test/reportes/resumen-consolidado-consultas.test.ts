import { describe, expect, it, vi } from "vitest";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { crearMembresia } from "../setup/membresia";
import type { Db } from "../../src/lib/db-tipos";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { obtenerResumenConsolidado } from "../../src/server/consultas/reportes/resumen-consolidado";
import { obtenerResumenOperativo } from "../../src/server/consultas/reportes/resumen-operativo";

/**
 * O.38 (docs/pureza-integracion.md): el Consolidado armaba un resumen operativo COMPLETO por sucursal (~26 consultas cada una) para mostrar 5 números. Ahora
 * lee una vez lo común (clasificación, catálogo, y las alertas de stock de todas las sucursales en bloque) y, por sucursal, solo lo que es de ella (líneas
 * del período, su Precio Local y su disponibilidad, sus recetas y su costo de reposición). Este test fija esa forma con 2 y con 5 sucursales:
 *  - lo común aparece UNA vez, sean 2 o 5 (si alguien vuelve a leer el catálogo o los saldos por sucursal, se pone en rojo);
 *  - lo propio de cada sucursal aparece exactamente una vez POR sucursal (7 lecturas: lo que todavía crece, porque esos cargadores no tienen versión en
 *    bloque), y nada del reporte del período que el Consolidado no muestra (IPC, objetivos de margen, auditoría de precios, margen Real…);
 *  - y cada fila da lo MISMO que el resumen operativo de esa sucursal (la fuente de verdad de esos números).
 */

async function contarConsultas<T>(f: (db: Db) => Promise<T>): Promise<{ resultado: T; porTipo: Map<string, number>; total: number }> {
  const porTipo = new Map<string, number>();
  let total = 0;
  const db = prisma.$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        const clave = model ? `${model}.${operation}` : operation;
        porTipo.set(clave, (porTipo.get(clave) ?? 0) + 1);
        total += 1;
        return query(args);
      },
    },
  }) as unknown as Db;
  const resultado = await f(db);
  return { resultado, porTipo, total };
}

/** `n` sucursales, cada una con una sección, un plato con receta, una compra de su insumo, una venta y un mínimo de stock (así hay saldos y alertas). */
async function sembrar(n: number) {
  await limpiarBaseDeTest();
  __setCookieDeTestParaSucursal(undefined);
  const base = await sembrarBase();
  const { kg } = await sembrarCatalogoBase();
  const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
  await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  const sucursales = [{ id: base.sucursal.id, nombre: base.sucursal.nombre }];
  for (let i = 1; i < n; i++) {
    const s = await prisma.sucursal.create({ data: { nombre: `Sucursal ${i}` } });
    await crearMembresia({ usuarioId: admin.id, sucursalId: s.id, rolId: base.admin.id, activo: true });
    sucursales.push({ id: s.id, nombre: s.nombre });
  }
  for (const [i, s] of sucursales.entries()) {
    const seccion = await sembrarSeccion(s.id);
    const harina = await sembrarProductoDisponible({ codigo: `MP_${i}`, nombre: `Harina ${i}`, tipo: "MP", unidadStockId: kg.id }, s.id);
    const pan = await sembrarProductoDisponible({ codigo: `PV_${i}`, nombre: `Pan ${i}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 + i }, s.id);
    await prisma.recetaVersion.create({ data: { productoId: pan.id, version: 1, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 0.5, unidadId: kg.id }] } } });
    await prisma.stockMinimoProducto.create({ data: { sucursalId: s.id, productoId: harina.id, minimo: 50 } });
    __setCookieDeTestParaSucursal(s.id);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccion.id, items: [{ productoId: harina.id, cantidad: 10, precioTotal: 200 }] });
    await registrarVenta({ fecha: new Date(), seccionId: seccion.id, ventas: [{ productoId: pan.id, cantidadVendida: 2 + i }] });
  }
  __setCookieDeTestParaSucursal(undefined);
  return sucursales;
}

/** Lo que se lee UNA vez para todas las sucursales, y lo que se lee una vez por sucursal. */
const COMUNES = ["Grupo.findMany", "Producto.findMany", "MovimientoStock.groupBy", "Seccion.findMany", "StockMinimoProducto.findMany"];
const POR_SUCURSAL = ["MovimientoStock.findMany", "CapacidadSucursal.findMany", "PrecioLocalProducto.findMany", "DisponibilidadProducto.findMany", "RecetaSucursal.findMany", "RecetaVersion.findMany", "$queryRaw"];

describe("Consolidado: lo común se lee una vez y por sucursal solo lo suyo (O.38)", () => {
  it("con 2 y con 5 sucursales: lo común una vez, lo propio una vez por sucursal, nada más — y los mismos números que el resumen operativo", async () => {
    for (const n of [2, 5]) {
      const sucursales = await sembrar(n);
      const { resultado, porTipo, total } = await contarConsultas((db) => obtenerResumenConsolidado(sucursales, db, AHORA_DE_LA_CORRIDA));

      for (const clave of COMUNES) expect(porTipo.get(clave), `${clave} con ${n} sucursales`).toBe(1);
      for (const clave of POR_SUCURSAL) expect(porTipo.get(clave), `${clave} con ${n} sucursales`).toBe(n);
      expect(total, `total con ${n} sucursales: ${JSON.stringify([...porTipo])}`).toBe(COMUNES.length + POR_SUCURSAL.length * n);

      // Los mismos números que el resumen operativo de cada sucursal (el que el Consolidado armaba entero antes).
      expect(resultado).toHaveLength(n);
      for (const [i, s] of sucursales.entries()) {
        const operativo = await obtenerResumenOperativo(s.id, prisma, AHORA_DE_LA_CORRIDA);
        expect(resultado[i]).toEqual({
          sucursalId: s.id,
          sucursalNombre: s.nombre,
          ventasTotal: operativo.financiero.ventasTotal,
          margenTotal: operativo.financiero.margenTotal,
          gastadoTotal: operativo.financiero.gastadoTotal,
          alertasCriticas: operativo.alertas.criticos,
          alertasBajas: operativo.alertas.bajos,
        });
        // Y el escenario no es trivial: hubo ventas, compras y una alerta en cada sucursal.
        expect(resultado[i].ventasTotal).toBe((100 + i) * (2 + i));
        expect(resultado[i].gastadoTotal).toBe(200);
        expect(resultado[i].alertasBajas + resultado[i].alertasCriticas).toBe(1);
      }
    }
  }, 120_000);
});
