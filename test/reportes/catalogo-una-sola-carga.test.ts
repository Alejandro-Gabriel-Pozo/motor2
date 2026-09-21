import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { generarReporteVentasPorCategoria, obtenerReportePorPeriodo } from "../../src/core/reportes/periodo";
import { obtenerReportePromociones } from "../../src/core/reportes/promociones";
import type { Db } from "../../src/core/reportes/comun";

/**
 * El catálogo de productos se carga UNA sola vez por corrida de `obtenerReportePorPeriodo`.
 *
 * `periodo.ts` decía "una sola carga del catálogo para todo el reporte", pero tres funciones (impacto de recetas, margen nominal y margen
 * Real reconstruido) volvían a llamar a `construirMapaProductos` por su cuenta: el benchmark midió 4 consultas `producto.findMany` por
 * reporte (scripts/benchmark-reportes.ts, Plan 6), y el Consolidado lo repite una vez por sucursal. Este test es la barrera: mismo mecanismo
 * de medición (una extensión del cliente Prisma que cuenta las llamadas), pero dentro de `npm test`. Sin él, pasar el mapa como parámetro
 * opcional (con fallback) sería silencioso: una función nueva que se olvide de recibirlo reintroduciría la regresión sin que nada avise.
 *
 * Los números del reporte NO cambian con esto: los fija test/reportes/carga-unica-catalogo.test.ts, que no se edita.
 *
 * El fixture (duplicado a propósito de ese archivo, para no tocarlo) pasa por las TRES rutas: la harina se compró a $5 antes del período y a
 * $8 dentro (hay impacto de receta), hay un plato vendido con receta y una de las dos ventas se guardó sin costo (margen Real reconstruido).
 */
const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("obtenerReportePorPeriodo — una sola carga del catálogo", () => {
  let sucursalId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const { kg } = await sembrarCatalogoBase();
    const seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const harina = await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id } });
    const pan = await prisma.producto.create({ data: { codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
    await prisma.recetaVersion.create({ data: { productoId: pan.id, version: 1, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 2, unidadId: kg.id }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: d("2026-08-01"), seccionId, items: [{ productoId: harina.id, cantidad: 10, precioTotal: 50 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: d("2026-08-03"), seccionId, items: [{ productoId: harina.id, cantidad: 10, precioTotal: 80 }] });
    for (const dia of ["2026-08-04", "2026-08-05"]) {
      const r = await registrarVenta({ fecha: d(dia), seccionId, ventas: [{ productoId: pan.id, cantidadVendida: 1 }] });
      expect(r.ok, r.mensaje).toBe(true);
    }
    await prisma.movimientoStock.updateMany({ where: { productoId: pan.id, proceso: "VENTA", operacion: { fecha: d("2026-08-05") } }, data: { costoUnitarioVenta: null } });
  });

  it("una corrida del reporte hace UNA consulta de productos, no una por cada función que lo necesita", async () => {
    let llamadas = 0;
    // `$extends` devuelve un cliente DERIVADO: solo se cuentan las consultas que pasan por él (las del fixture, hechas arriba con el
    // cliente normal, no).
    const dbContado = prisma.$extends({
      query: {
        producto: {
          findMany({ args, query }) {
            llamadas++;
            return query(args);
          },
        },
      },
    }) as unknown as Db;

    llamadas = 0;
    const rep = await obtenerReportePorPeriodo(sucursalId, d("2026-08-02"), d("2026-08-10"), {}, dbContado);

    // Guardianes del fixture: si alguna de las tres rutas no se ejercitara, el contador daría 1 sin probar nada.
    expect(rep.impactoRecetas.length, "no corrió el impacto de recetas").toBeGreaterThan(0);
    expect(rep.margen.costoTotal, "no corrió el margen nominal").toBeGreaterThan(0);
    expect(rep.margen.ingresoRealReconstruido, "no corrió el margen Real reconstruido").toBeGreaterThan(0);

    expect(llamadas).toBe(1);
  });

  // Promociones y Categorías se apoyan en `obtenerReportePorPeriodo` y necesitan el MISMO catálogo: antes lo leían de nuevo (2 consultas por
  // reporte); ahora lo toman del propio reporte (`obtenerReportePorPeriodoConCatalogo`).
  const contando = () => {
    const cuenta = { llamadas: 0 };
    const db = prisma.$extends({
      query: {
        producto: {
          findMany({ args, query }) {
            cuenta.llamadas++;
            return query(args);
          },
        },
      },
    }) as unknown as Db;
    return { cuenta, db };
  };

  it("Promociones hace UNA consulta de productos, no dos", async () => {
    await prisma.sucursal.update({ where: { id: sucursalId }, data: { promocionesHabilitadas: true } });
    const { cuenta, db } = contando();

    const rep = await obtenerReportePromociones(sucursalId, d("2026-08-02"), d("2026-08-10"), db);

    expect(rep.habilitado, "la pantalla no llegó a calcular (el guardián del fixture)").toBe(true);
    expect(cuenta.llamadas).toBe(1);
  });

  it("Categorías hace UNA consulta de productos, no dos", async () => {
    const { cuenta, db } = contando();

    const rep = await generarReporteVentasPorCategoria(sucursalId, d("2026-08-02"), d("2026-08-10"), db);

    expect(rep.porCategoria.length, "no había ventas que agrupar (el guardián del fixture)").toBeGreaterThan(0);
    expect(cuenta.llamadas).toBe(1);
  });
});
