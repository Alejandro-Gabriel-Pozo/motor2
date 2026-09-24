import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { generarReporteVentasPorCategoria } from "../../src/core/reportes/periodo";
import { generarReporteVentasPorSeccion, reagruparPorSeccion, SIN_SECCION, type ReporteVentasPorCategoria } from "../../src/core/carta/reporte-secciones";
import type { Db } from "../../src/core/reportes/comun";

/**
 * Ventas por sección de carta (docs/plan-carta-catalogo-2026-09-24.md, M4): un rollup de "Ventas por categoría" que no
 * cambia sus números — las filas de categoría salen idénticas, los totales por sección suman lo mismo y la única consulta
 * extra es la de la tabla puente.
 */
const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("reagruparPorSeccion (pura)", () => {
  const rep: ReporteVentasPorCategoria = {
    desde: "2026-08-01",
    hasta: "2026-08-31",
    totalFacturado: 1000,
    aviso: null,
    porCategoria: [
      { categoria: "Bife", cantidad: 3, importe: 600, productos: [{ producto: "Bife", cantidad: 3, importe: 600 }] },
      { categoria: "Postres", cantidad: 2, importe: 200, productos: [{ producto: "Flan", cantidad: 2, importe: 200 }] },
      { categoria: "Sin categoría", cantidad: 1, importe: 100, productos: [{ producto: "Agua", cantidad: 1, importe: 100 }] },
      { categoria: "Empanadas", cantidad: 0.1, importe: 0.2, productos: [{ producto: "Empanada", cantidad: 0.1, importe: 0.2 }] },
      { categoria: "Cerdo", cantidad: 0.2, importe: 0.1, productos: [{ producto: "Bondiola", cantidad: 0.2, importe: 0.1 }] },
    ],
    pvSinCategoria: ["Agua"],
  } as unknown as ReporteVentasPorCategoria;

  const mapa = new Map([
    ["Bife", { nombre: "Platos Principales", orden: 2 }],
    ["Cerdo", { nombre: "Platos Principales", orden: 2 }],
    ["Empanadas", { nombre: "Entradas", orden: 1 }],
  ]);

  it("agrupa por sección en el orden de la carta, con 'Sin sección' al final", () => {
    const r = reagruparPorSeccion(rep, mapa);
    expect(r.porSeccion.map((s) => s.seccion)).toEqual(["Entradas", "Platos Principales", SIN_SECCION]);
    expect(r.porSeccion[1].categorias.map((c) => c.categoria)).toEqual(["Bife", "Cerdo"]);
    expect(r.porSeccion[2].categorias.map((c) => c.categoria)).toEqual(["Postres", "Sin categoría"]);
  });

  it("las sumas por sección cierran contra porCategoria (y se redondean)", () => {
    const r = reagruparPorSeccion(rep, mapa);
    expect(r.porSeccion.find((s) => s.seccion === "Platos Principales")).toMatchObject({ cantidad: 3.2, importe: 600.1 });
    const total = (xs: { importe: number; cantidad: number }[]) => xs.reduce((a, x) => ({ importe: a.importe + x.importe, cantidad: a.cantidad + x.cantidad }), { importe: 0, cantidad: 0 });
    expect(total(r.porSeccion).importe).toBeCloseTo(total(rep.porCategoria).importe, 6);
    expect(total(r.porSeccion).cantidad).toBeCloseTo(total(rep.porCategoria).cantidad, 6);
  });

  it("lista las categorías sin sección (no 'Sin categoría', que ya está en pvSinCategoria) y copia el resto del encabezado", () => {
    const r = reagruparPorSeccion(rep, mapa);
    expect(r.categoriasSinSeccion).toEqual(["Postres"]);
    expect(r.pvSinCategoria).toEqual(["Agua"]);
    expect({ desde: r.desde, hasta: r.hasta, totalFacturado: r.totalFacturado, aviso: r.aviso }).toEqual({ desde: rep.desde, hasta: rep.hasta, totalFacturado: 1000, aviso: null });
  });

  it("sin ventas: sin secciones", () => {
    expect(reagruparPorSeccion({ ...rep, porCategoria: [] }, mapa).porSeccion).toEqual([]);
  });
});

describe("generarReporteVentasPorSeccion (contra Postgres)", () => {
  let sucursalId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const u = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    const seccionId = (await sembrarSeccion(sucursalId, "Salón")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const [cBife, cEmp, cPostre] = await Promise.all(["Bife", "Empanadas", "Postres"].map(async (nombre) => (await prisma.categoriaProducto.create({ data: { nombre } })).id));
    const platos = await prisma.seccionCarta.create({ data: { nombre: "Platos Principales", orden: 2 } });
    const entradas = await prisma.seccionCarta.create({ data: { nombre: "Entradas", orden: 1 } });
    await prisma.categoriaSeccionCarta.createMany({ data: [{ categoriaId: cBife, seccionCartaId: platos.id }, { categoriaId: cEmp, seccionCartaId: entradas.id }] });

    const pv = (codigo: string, nombre: string, categoriaId: string | null, precioVenta: number) =>
      sembrarProductoDisponible({ codigo, nombre, tipo: "PV", categoriaId, precioVenta, unidadStockId: u.id }, sucursalId);
    const bife = await pv("PV_BIFE", "Bife", cBife, 1000);
    const emp = await pv("PV_EMP", "Empanada", cEmp, 150);
    const flan = await pv("PV_FLAN", "Flan", cPostre, 300);
    const agua = await pv("PV_AGUA", "Agua", null, 80);

    const r = await registrarVenta({
      fecha: d("2026-08-04"),
      seccionId,
      ventas: [
        { productoId: bife.id, cantidadVendida: 2 },
        { productoId: emp.id, cantidadVendida: 6 },
        { productoId: flan.id, cantidadVendida: 1 },
        { productoId: agua.id, cantidadVendida: 3 },
      ],
    });
    expect(r.ok, r.mensaje).toBe(true);
  });

  it("cada fila de categoría sale idéntica a la del reporte por categoría, y los totales cierran", async () => {
    const porCategoria = await generarReporteVentasPorCategoria(sucursalId, d("2026-08-01"), d("2026-08-31"));
    const porSeccion = await generarReporteVentasPorSeccion(sucursalId, d("2026-08-01"), d("2026-08-31"));

    expect(porCategoria.porCategoria.length).toBe(4);
    const filasReagrupadas = porSeccion.porSeccion.flatMap((s) => s.categorias);
    expect([...filasReagrupadas].sort((a, b) => a.categoria.localeCompare(b.categoria))).toEqual([...porCategoria.porCategoria].sort((a, b) => a.categoria.localeCompare(b.categoria)));

    const suma = (xs: { importe: number; cantidad: number }[], k: "importe" | "cantidad") => xs.reduce((a, x) => a + x[k], 0);
    expect(suma(porSeccion.porSeccion, "importe")).toBeCloseTo(suma(porCategoria.porCategoria, "importe"), 6);
    expect(suma(porSeccion.porSeccion, "cantidad")).toBeCloseTo(suma(porCategoria.porCategoria, "cantidad"), 6);
    expect(porSeccion.totalFacturado).toBe(porCategoria.totalFacturado);

    expect(porSeccion.porSeccion.map((s) => [s.seccion, s.importe])).toEqual([
      ["Entradas", 900],
      ["Platos Principales", 2000],
      [SIN_SECCION, 540],
    ]);
    expect(porSeccion.categoriasSinSeccion).toEqual(["Postres"]);
    expect(porSeccion.pvSinCategoria).toEqual(porCategoria.pvSinCategoria);
  });

  it("hace exactamente UNA consulta más que el reporte por categoría: la de la tabla puente", async () => {
    const contando = () => {
      const cuenta = { total: 0, puente: 0 };
      const db = prisma.$extends({
        query: {
          $allModels: {
            $allOperations({ model, operation, args, query }) {
              cuenta.total++;
              if (model === "CategoriaSeccionCarta" && operation === "findMany") cuenta.puente++;
              return query(args);
            },
          },
        },
      }) as unknown as Db;
      return { cuenta, db };
    };

    const base = contando();
    await generarReporteVentasPorCategoria(sucursalId, d("2026-08-01"), d("2026-08-31"), base.db);
    const rollup = contando();
    await generarReporteVentasPorSeccion(sucursalId, d("2026-08-01"), d("2026-08-31"), rollup.db);

    expect(base.cuenta.total).toBeGreaterThan(0);
    expect(rollup.cuenta.puente).toBe(1);
    expect(rollup.cuenta.total - base.cuenta.total).toBe(1);
  });
});
