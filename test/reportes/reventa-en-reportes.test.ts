import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { entrarComo, sembrarSalon } from "../pos/salon-fixture";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { calcularCostosYMargenes, calcularImpactoRecetasPorPeriodo } from "../../src/server/lecturas/reportes/costos";
import { generarReporteVentasSinReceta } from "../../src/server/consultas/reportes/ventas-sin-receta";
import { generarReporteHuecosCatalogo } from "../../src/server/consultas/reportes/huecos-catalogo";
import { generarReporteInsumosSinRecetaVinculada } from "../../src/server/consultas/reportes/insumos-sin-receta";
import { generarReporteDiferenciasAjustes } from "../../src/server/consultas/reportes/diferencias-ajustes";
import { calcularValuacionInventario } from "../../src/server/consultas/reportes/valuacion";
import { obtenerHistorialProducto } from "../../src/server/consultas/reportes/historial-producto";
import { obtenerReportePorPeriodo } from "../../src/server/consultas/reportes/periodo";
import { detalleDeLaLista } from "../../src/server/consultas/catalogo/detalle-de-la-lista";
import { hechosDelProducto, leerProductoDelEspacio } from "../../src/server/consultas/catalogo/espacio-del-producto";
import { listarProductosPagina } from "../../src/server/actions/catalogo/productos";
import { pasosDelEspacio, pendientesDelProducto, type AccesoAlEspacio } from "../../src/core/catalogo/public";
import { comprobanteDePrueba } from "../setup/comprobante-de-prueba";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";

/**
 * E4-4 de la Reventa (docs/diseno-reventa-e4-2026-11-17.md §7, R9: «los reportes no cambian de resultado»). Contra Postgres real: tres Reventas sembradas con el cliente administrador (nadie las crea desde la app
 * hasta E4-5):
 *  - «Gaseosa lata»: comprada (10 a $600 la unidad) y vendida, con precio;
 *  - «Alfajor»: con precio y SIN ninguna compra (sin costo: pendiente de completar);
 *  - «Agua»: comprada y SIN precio de venta.
 * Se afirma dónde APARECE (costos y margen, historial, valuación, diferencias de ajuste, nunca vendida, lista y ficha) y dónde NO (ventas sin receta, insumos sin receta, «falta receta» de la lista y de la ficha), con los
 * números correctos, y que lo de siempre (el par MP+PV de la fixture del salón) sigue igual.
 *
 * Mutaciones (cada una pone una prueba en rojo): volver `ingredientesParaCostear` a `recetaPorProducto.get(...)` (costos: «sin receta», sin costo ni margen); sacar el filtro de `capacidadesEnReportes` de
 * ventas-sin-receta (la Reventa vendida aparece como «venta sin receta»); volver el filtro de insumos sin receta a `tipo === "MP"` no cambia nada para una Reventa PV (por eso hay un caso con una Reventa
 * en un esquema MP: ver la tabla pura) y volverlo a «se compra» (sin `!seVende`) la mete; volver `claseDelProducto` a los literales la rotula «venta»; volver `pasoCorrespondeAlProducto` a «PV: true» le pide receta.
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let gaseosaId: string, alfajorId: string, aguaId: string;

const AHORA = new Date("2026-11-18T12:00:00Z");
const FECHA = new Date("2026-11-17T15:00:00Z");
const compra = async (productoId: string, cantidad: number, precioTotal: number) =>
  registrarMovimiento({ proceso: "COMPRA", ...(await comprobanteDePrueba()), fecha: FECHA, seccionId: s.seccion.id, items: [{ productoId, cantidad, precioTotal, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: randomUUID() });
const vender = (productoId: string, cantidadVendida: number) => registrarVenta({ fecha: FECHA, seccionId: s.seccion.id, ventas: [{ productoId, cantidadVendida }] });
const sembrarReventa = async (codigo: string, nombre: string, precioVenta: number) => {
  const p = await prismaAdmin.producto.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, codigo, nombre, tipo: "PV", seProduce: false, claseDeUso: "REVENTA", precioVenta, alicuotaIvaVenta: "IVA_21", unidadStockId: s.unidad.id } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId: s.sucursalId, productoId: p.id, disponible: true } });
  return p.id;
};

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  await entrarComo(s.admin);
  gaseosaId = await sembrarReventa("PV_GASEOSA_R", "Gaseosa lata", 1500);
  alfajorId = await sembrarReventa("PV_ALFAJOR_R", "Alfajor", 800);
  aguaId = await sembrarReventa("PV_AGUA_R", "Agua", 0);
  expect((await compra(gaseosaId, 10, 6000)).ok).toBe(true);
  expect((await compra(aguaId, 4, 1200)).ok).toBe(true);
  expect((await vender(gaseosaId, 2)).ok).toBe(true);
});

describe("costos y margen", () => {
  it("el costo de una Reventa es el de su COMPRA vigente: margen y food cost contra su precio; nunca «sin receta»", async () => {
    const filas = await calcularCostosYMargenes(s.sucursalId, prisma);
    const gaseosa = filas.find((f) => f.productoId === gaseosaId)!;
    expect([gaseosa.costo, gaseosa.margen, gaseosa.margenPct, gaseosa.foodCostPct, gaseosa.costoIncompleto, gaseosa.estado]).toEqual([600, 900, 60, 40, false, "OK"]);
    expect(gaseosa.componentes.map((c) => [c.insumoNombre, c.costoUnitario, c.sinPrecio])).toEqual([["Gaseosa lata", 600, false]]);
    expect(filas.filter((f) => [gaseosaId, alfajorId, aguaId].includes(f.productoId)).map((f) => f.estado)).not.toContain("SIN_RECETA");
  });

  it("la compra más reciente manda: un costo nuevo cambia el costo y el margen", async () => {
    expect((await compra(gaseosaId, 5, 4000)).ok).toBe(true); // $800 la unidad
    const gaseosa = (await calcularCostosYMargenes(s.sucursalId, prisma)).find((f) => f.productoId === gaseosaId)!;
    expect([gaseosa.costo, gaseosa.margen]).toEqual([800, 700]);
  });

  it("SIN compra queda «costo incompleto» (pendiente de completar): ni costo ni margen, y nunca cero", async () => {
    const alfajor = (await calcularCostosYMargenes(s.sucursalId, prisma)).find((f) => f.productoId === alfajorId)!;
    expect([alfajor.costo, alfajor.margen, alfajor.costoIncompleto, alfajor.estado]).toEqual([null, null, true, "COSTO_INCOMPLETO"]);
    expect(alfajor.componentes[0].sinPrecio).toBe(true);
  });

  it("SIN precio de venta queda «sin precio de venta», con su costo conocido", async () => {
    const agua = (await calcularCostosYMargenes(s.sucursalId, prisma)).find((f) => f.productoId === aguaId)!;
    expect([agua.estado, agua.costo, agua.margen]).toEqual(["SIN_PRECIO_VENTA", 300, null]);
  });

  it("lo de siempre no cambia: el par MP+PV de la fixture (Milanesa, con su receta de un ingrediente) sigue costeándose por su receta", async () => {
    const mp = (await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: s.milanesa.id }, include: { ingredientes: true } })).ingredientes[0].insumoProductoId;
    expect((await compra(mp, 10, 1000)).ok).toBe(true);
    const milanesa = (await calcularCostosYMargenes(s.sucursalId, prisma)).find((f) => f.productoId === s.milanesa.id)!;
    expect(milanesa.costo).toBe(100);
    expect(milanesa.componentes).toHaveLength(1);
    expect(milanesa.componentes[0].insumoProductoId).toBe(mp);
  });

  it("el costo congelado al vender es el de compra de la Reventa y el margen del período la muestra con su margen real", async () => {
    const [venta] = await prisma.movimientoStock.findMany({ where: { productoId: gaseosaId, proceso: "VENTA" } });
    expect(Number(venta.costoUnitarioVenta)).toBe(600);
    const rep = await obtenerReportePorPeriodo(s.sucursalId, new Date("2026-11-16T00:00:00Z"), new Date("2026-11-18T00:00:00Z"), {}, prisma, AHORA);
    const fila = rep.margen.porProducto.find((p) => p.productoId === gaseosaId)!;
    expect([fila.cantidad, fila.ingreso, fila.costoUnitario, fila.costo, fila.margen, fila.costoIncompleto]).toEqual([2, 3000, 600, 1200, 1800, false]);
    expect(fila.margenReal).toBe(1800);
    expect(fila.margenRealCompleto).toBe(true);
  });

  it("el impacto de un cambio de precio de compra llega a la Reventa, como al par", async () => {
    // Una compra anterior al período a $500 la unidad; la de hoy (la del beforeEach) es a $600.
    const anterior = await comprobanteDePrueba();
    expect((await registrarMovimiento({ proceso: "COMPRA", ...anterior, fecha: new Date("2026-11-05T12:00:00Z"), seccionId: s.seccion.id, items: [{ productoId: gaseosaId, cantidad: 10, precioTotal: 5000, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: randomUUID() })).ok).toBe(true);
    const filas = await calcularImpactoRecetasPorPeriodo(s.sucursalId, new Date("2026-11-10T00:00:00Z"), prisma);
    expect(filas.find((f) => f.productoId === gaseosaId)).toMatchObject({ costoAntes: 500, costoActual: 600, deltaCosto: 100 });
  });
});

describe("dónde aparece y dónde no", () => {
  it("una Reventa vendida NO es una «venta sin receta»", async () => {
    expect((await generarReporteVentasSinReceta(s.sucursalId, prisma)).map((f) => f.productoId)).not.toContain(gaseosaId);
  });

  it("no es un «insumo sin receta» (se vende tal cual) pero SÍ aparece como producto de venta que nunca se vendió", async () => {
    expect((await generarReporteInsumosSinRecetaVinculada(s.sucursalId, prisma)).filter((f) => [gaseosaId, alfajorId, aguaId].includes(f.productoId))).toEqual([]);
    const huecos = await generarReporteHuecosCatalogo(s.sucursalId, prisma);
    expect(huecos.pvSinVentaNunca.map((f) => f.productoId).filter((id) => [gaseosaId, alfajorId, aguaId].includes(id)).sort()).toEqual([alfajorId, aguaId].sort());
  });

  it("una Reventa que entra en una receta y no tiene ningún proveedor es un hueco de catálogo (se compra, como una MP); con compra a un proveedor, no", async () => {
    await prisma.recetaVersion.create({ data: { productoId: s.pizza.id, version: 2, ingredientes: { create: [{ insumoProductoId: alfajorId, cantidad: 1, unidadId: s.unidad.id, mermaPorcentaje: 0 }, { insumoProductoId: gaseosaId, cantidad: 1, unidadId: s.unidad.id, mermaPorcentaje: 0 }] } } });
    const huecos = await generarReporteHuecosCatalogo(s.sucursalId, prisma);
    expect(huecos.insumosConRecetaSinProveedor.map((f) => f.productoId)).toContain(alfajorId);
    expect(huecos.insumosConRecetaSinProveedor.map((f) => f.productoId)).not.toContain(gaseosaId);
  });

  it("una Reventa con ajustes o conteos entra en «diferencias de ajuste» (lleva stock propio)", async () => {
    expect((await registrarMovimiento({ proceso: "AJUSTE", fecha: FECHA, seccionId: s.seccion.id, items: [{ productoId: gaseosaId, cantidad: -1 }], claveIdempotencia: randomUUID() })).ok).toBe(true);
    const fila = (await generarReporteDiferenciasAjustes(s.sucursalId, prisma, AHORA)).find((f) => f.productoId === gaseosaId);
    expect(fila).toMatchObject({ grupo: "a", estado: "REVISAR", sumaAjustesManuales: -1 });
  });

  it("valuación: la comprada vale saldo × costo; con stock pero sin costo de compra queda «sin costo» (no se valúa en cero)", async () => {
    expect((await registrarMovimiento({ proceso: "AJUSTE", fecha: FECHA, seccionId: s.seccion.id, items: [{ productoId: alfajorId, cantidad: 3 }], claveIdempotencia: randomUUID() })).ok).toBe(true);
    const v = await calcularValuacionInventario(s.sucursalId, prisma);
    expect(v.filas.find((f) => f.productoId === gaseosaId)).toMatchObject({ saldo: 8, costoUnitario: 600, valor: 4800, sinCosto: false });
    expect(v.filas.find((f) => f.productoId === alfajorId)).toMatchObject({ saldo: 3, costoUnitario: null, valor: null, sinCosto: true });
  });

  it("historial: la Reventa lleva stock propio, saldo y sus compras y ventas en el Kardex (la página le muestra «Cómo se compró» y «Cómo se vendió»: ver la tabla de capacidades)", async () => {
    const h = await obtenerHistorialProducto(s.sucursalId, gaseosaId, undefined, undefined, undefined, prisma);
    expect(h?.tieneStockPropio).toBe(true);
    expect(h?.saldoActual).toBe(8);
    expect(h?.eventos.map((e) => e.proceso).sort()).toEqual(["COMPRA", "VENTA"]);
  });
});

describe("la lista de productos y la ficha", () => {
  it("la fila de una Reventa dice «Reventa»; el resto, lo de siempre", async () => {
    const d = await detalleDeLaLista(prisma, s.sucursalId, [gaseosaId, alfajorId, aguaId, s.milanesa.id, s.muzzarella.id]);
    expect(d.get(gaseosaId)).toEqual({ precio: "$\u00a01.500,00", clase: "reventa" });
    expect(d.get(aguaId)).toEqual({ precio: "Sin precio", clase: "reventa" });
    expect(d.get(s.milanesa.id)?.clase).toBe("venta");
    expect(d.get(s.muzzarella.id)?.clase).toBe("materia-prima");
  });

  it("el chip «Reventa» lista las Reventas y el chip «Producto vendible» ya no las repite", async () => {
    const nombres = async (filtros: object) => (await listarProductosPagina(undefined, undefined, filtros)).items.map((i) => i.nombre).sort();
    expect(await nombres({ tipo: "reventa" })).toEqual(["Agua", "Alfajor", "Gaseosa lata"]);
    const vendibles = await nombres({ tipo: "venta" });
    expect(vendibles).toEqual(expect.arrayContaining(["Milanesa", "Flan", "Pizza"]));
    for (const reventa of ["Agua", "Alfajor", "Gaseosa lata"]) expect(vendibles).not.toContain(reventa);
  });

  it("«le falta: receta» no lista a una Reventa; «sin precio» sí lista la que no tiene precio", async () => {
    const sinReceta = (await listarProductosPagina(undefined, undefined, { falta: "sin-receta" })).items.map((i) => i.nombre);
    for (const reventa of ["Agua", "Alfajor", "Gaseosa lata"]) expect(sinReceta).not.toContain(reventa);
    const sinPrecio = (await listarProductosPagina(undefined, undefined, { falta: "sin-precio" })).items.map((i) => i.nombre);
    expect(sinPrecio).toContain("Agua");
    expect(sinPrecio).not.toContain("Gaseosa lata");
  });

  it("la ficha de una Reventa no tiene el paso de receta ni lo pide, y conserva los de venta; la de un PV común sí lo tiene", async () => {
    const ACCESO: AccesoAlEspacio = { datos: true, ver: true, opciones: true, receta: "si", carta: "si" };
    const pasosDe = async (id: string) => {
      const producto = (await leerProductoDelEspacio(prisma, id))!;
      const hechos = await hechosDelProducto(prisma, producto, s.sucursalId, { opciones: false, receta: true, carta: false });
      return { hechos, pasos: pasosDelEspacio(id, hechos, ACCESO, pendientesDelProducto(hechos)).map((p) => p.paso) };
    };
    const reventa = await pasosDe(alfajorId);
    expect(reventa.pasos).not.toContain("receta");
    expect(reventa.hechos.receta).toBeNull(); // ni se lee: no le corresponde
    const pv = await pasosDe(s.milanesa.id);
    expect(pv.pasos).toContain("receta");
    expect(pv.hechos.receta).not.toBeNull();
  });
});
