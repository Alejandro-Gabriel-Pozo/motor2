import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { generarReporteVentasPorCategoria } from "../../src/core/reportes/periodo";
import { generarReporteVentasPorSeccion, reagruparPorSeccion, SIN_SECCION, type VentasParaSeccion } from "../../src/core/carta/reporte-secciones";
import type { Db } from "../../src/core/reportes/comun";

/**
 * Ventas por sección de carta (docs/plan-carta-catalogo-2026-09-24.md, M4; a nivel de PRODUCTO desde
 * docs/plan-carta-seccion-directa-2026-09-25.md, M5): las mismas ventas que "Ventas por categoría", agrupadas por la sección donde
 * se ve CADA producto (la de su ítem agrupado si es una opción; si no, la de su contenido visible; si no, "Sin sección"). Los
 * totales cierran con los del reporte por categoría y la única consulta extra es la de dónde se ve cada producto.
 */
const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("reagruparPorSeccion (pura)", () => {
  const rep: VentasParaSeccion = {
    desde: d("2026-08-01"),
    hasta: d("2026-08-31"),
    totalFacturado: 1000.3,
    aviso: "Importe real registrado en cada venta (no una estimación).",
    porProducto: [
      { productoId: "bife", producto: "Bife", categoria: "Bife", cantidad: 3, importe: 600 },
      { productoId: "flan", producto: "Flan", categoria: "Postres", cantidad: 2, importe: 200 },
      { productoId: "agua", producto: "Agua", categoria: null, cantidad: 1, importe: 100 },
      { productoId: "emp", producto: "Empanada", categoria: "Empanadas", cantidad: 0.1, importe: 0.2 },
      { productoId: "bondiola", producto: "Bondiola", categoria: "Cerdo", cantidad: 0.2, importe: 0.1 },
      // Misma categoría que el bife, pero se ve en Entradas.
      { productoId: "provoleta", producto: "Provoleta", categoria: "Bife", cantidad: 1, importe: 100 },
    ],
    pvSinCategoria: ["Agua"],
  };

  const mapa = new Map([
    ["bife", { nombre: "Platos Principales", orden: 2 }],
    ["bondiola", { nombre: "Platos Principales", orden: 2 }],
    ["emp", { nombre: "Entradas", orden: 1 }],
    ["provoleta", { nombre: "Entradas", orden: 1 }],
  ]);

  it("agrupa por la sección de CADA producto en el orden de la carta, con 'Sin sección' al final; dentro, por categoría", () => {
    const r = reagruparPorSeccion(rep, mapa);
    expect(r.porSeccion.map((s) => s.seccion)).toEqual(["Entradas", "Platos Principales", SIN_SECCION]);
    // Una categoría ("Bife") puede aparecer en dos secciones, con la parte de sus ventas que cae en cada una.
    expect(r.porSeccion[0].categorias.map((c) => [c.categoria, c.importe])).toEqual([
      ["Bife", 100],
      ["Empanadas", 0.2],
    ]);
    expect(r.porSeccion[1].categorias.map((c) => [c.categoria, c.importe])).toEqual([
      ["Bife", 600],
      ["Cerdo", 0.1],
    ]);
    expect(r.porSeccion[2].categorias.map((c) => c.categoria)).toEqual(["Postres", "Sin categoría"]);
  });

  it("las sumas por sección cierran contra las ventas por producto (y se redondean)", () => {
    const r = reagruparPorSeccion(rep, mapa);
    expect(r.porSeccion.find((s) => s.seccion === "Platos Principales")).toMatchObject({ cantidad: 3.2, importe: 600.1 });
    const total = (xs: readonly { importe: number; cantidad: number }[]) => xs.reduce((a, x) => ({ importe: a.importe + x.importe, cantidad: a.cantidad + x.cantidad }), { importe: 0, cantidad: 0 });
    expect(total(r.porSeccion).importe).toBeCloseTo(total(rep.porProducto).importe, 6);
    expect(total(r.porSeccion).cantidad).toBeCloseTo(total(rep.porProducto).cantidad, 6);
  });

  it("lista los productos sin sección y copia el resto del encabezado", () => {
    const r = reagruparPorSeccion(rep, mapa);
    expect(r.productosSinSeccion).toEqual(["Agua", "Flan"]);
    expect(r.pvSinCategoria).toEqual(["Agua"]);
    expect({ desde: r.desde, hasta: r.hasta, totalFacturado: r.totalFacturado, aviso: r.aviso }).toEqual({
      desde: rep.desde,
      hasta: rep.hasta,
      totalFacturado: 1000.3,
      aviso: rep.aviso,
    });
  });

  it("sin ventas: sin secciones", () => {
    expect(reagruparPorSeccion({ ...rep, porProducto: [] }, mapa).porSeccion).toEqual([]);
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

    const [cBife, cEmp, cPostre, cGas] = await Promise.all(["Bife", "Empanadas", "Postres", "Gaseosas"].map(async (nombre) => (await prisma.categoriaProducto.create({ data: { nombre } })).id));
    const platos = await prisma.seccionCarta.create({ data: { nombre: "Platos Principales", orden: 2 } });
    const entradas = await prisma.seccionCarta.create({ data: { nombre: "Entradas", orden: 1 } });
    const bebidas = await prisma.seccionCarta.create({ data: { nombre: "Bebidas", orden: 3 } });

    const pv = (codigo: string, nombre: string, categoriaId: string | null, precioVenta: number) =>
      sembrarProductoDisponible({ codigo, nombre, tipo: "PV", categoriaId, precioVenta, unidadStockId: u.id }, sucursalId);
    const bife = await pv("PV_BIFE", "Bife", cBife, 1000);
    const provoleta = await pv("PV_PROVO", "Provoleta", cBife, 500);
    const emp = await pv("PV_EMP", "Empanada", cEmp, 150);
    const flan = await pv("PV_FLAN", "Flan", cPostre, 300);
    const agua = await pv("PV_AGUA", "Agua", null, 80);
    const coca = await pv("PV_COCA", "Coca", cGas, 100);

    await prisma.contenidoCartaProducto.createMany({
      data: [
        { productoId: bife.id, visibleEnCarta: true, seccionCartaId: platos.id },
        // Misma categoría que el bife, en otra sección: sus ventas van a Entradas.
        { productoId: provoleta.id, visibleEnCarta: true, seccionCartaId: entradas.id },
        { productoId: emp.id, visibleEnCarta: true, seccionCartaId: entradas.id },
        // Oculto (aunque tenga sección): no se ve en la carta → "Sin sección".
        { productoId: agua.id, visibleEnCarta: false, seccionCartaId: entradas.id },
        // Tiene contenido visible propio, pero está agrupado: se ve (y vende) en la sección del ítem agrupado (D3).
        { productoId: coca.id, visibleEnCarta: true, seccionCartaId: entradas.id },
      ],
    });
    const gaseosa = await prisma.itemAgrupadoCarta.create({ data: { nombre: "Gaseosa", seccionCartaId: bebidas.id } });
    await prisma.opcionItemAgrupadoCarta.create({ data: { itemAgrupadoCartaId: gaseosa.id, productoId: coca.id } });

    const r = await registrarVenta({
      fecha: d("2026-08-04"),
      seccionId,
      ventas: [
        { productoId: bife.id, cantidadVendida: 2 },
        { productoId: provoleta.id, cantidadVendida: 1 },
        { productoId: emp.id, cantidadVendida: 6 },
        { productoId: flan.id, cantidadVendida: 1 },
        { productoId: agua.id, cantidadVendida: 3 },
        { productoId: coca.id, cantidadVendida: 4 },
      ],
    });
    expect(r.ok, r.mensaje).toBe(true);
  });

  it("agrupa por la sección real de cada producto; los totales cierran con el reporte por categoría", async () => {
    const porCategoria = await generarReporteVentasPorCategoria(sucursalId, d("2026-08-01"), d("2026-08-31"), prisma);
    const porSeccion = await generarReporteVentasPorSeccion(sucursalId, d("2026-08-01"), d("2026-08-31"), prisma);

    const suma = (xs: readonly { importe: number; cantidad: number }[], k: "importe" | "cantidad") => xs.reduce((a, x) => a + x[k], 0);
    expect(suma(porSeccion.porSeccion, "importe")).toBeCloseTo(suma(porCategoria.porCategoria, "importe"), 6);
    expect(suma(porSeccion.porSeccion, "cantidad")).toBeCloseTo(suma(porCategoria.porCategoria, "cantidad"), 6);
    expect(porSeccion.totalFacturado).toBe(porCategoria.totalFacturado);

    expect(porSeccion.porSeccion.map((s) => [s.seccion, s.importe])).toEqual([
      ["Entradas", 1400],
      ["Platos Principales", 2000],
      ["Bebidas", 400],
      [SIN_SECCION, 540],
    ]);
    // "Bife" aparece en dos secciones: la provoleta en Entradas, el bife en Platos.
    expect(porSeccion.porSeccion[0].categorias.map((c) => [c.categoria, c.importe])).toEqual([
      ["Empanadas", 900],
      ["Bife", 500],
    ]);
    expect(porSeccion.porSeccion[1].categorias.map((c) => [c.categoria, c.importe])).toEqual([["Bife", 2000]]);
    // Sumando la categoría en todas las secciones, da lo mismo que su fila en el reporte por categoría.
    const bifeEnSecciones = porSeccion.porSeccion.flatMap((s) => s.categorias).filter((c) => c.categoria === "Bife");
    expect(suma(bifeEnSecciones, "importe")).toBe(porCategoria.porCategoria.find((c) => c.categoria === "Bife")!.importe);

    expect(porSeccion.productosSinSeccion).toEqual(["Agua", "Flan"]);
    expect(porSeccion.pvSinCategoria).toEqual(porCategoria.pvSinCategoria);
  });

  it("hace exactamente UNA consulta más que el reporte por categoría: dónde se ve cada producto", async () => {
    const contando = () => {
      const cuenta = { total: 0, productoFindMany: 0 };
      const db = prisma.$extends({
        query: {
          $allModels: {
            $allOperations({ model, operation, args, query }) {
              cuenta.total++;
              if (model === "Producto" && operation === "findMany") cuenta.productoFindMany++;
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
    expect(rollup.cuenta.productoFindMany - base.cuenta.productoFindMany).toBe(1);
    expect(rollup.cuenta.total - base.cuenta.total).toBe(1);
  });
});
