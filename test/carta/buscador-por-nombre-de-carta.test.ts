import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { buscarProductosSelector } from "../../src/server/actions/catalogo/productos";

/**
 * El buscador del mozo (POS) encuentra por AMBOS nombres: el interno y el «Nombre en la carta» de la sucursal activa (decisión del dueño, 2026-11-04). Solo con el filtro `tambienPorNombreDeCarta` (el buscador
 * de las demás pantallas sigue como siempre), sin distinguir mayúsculas ni tildes, y solo con el nombre de carta de ESTA sucursal. Sigue devolviendo código y nombre interno.
 */
describe("buscador del POS por nombre de carta e interno", () => {
  let sucursalId: string;
  let otraSucursalId: string;
  let napo: string;

  const buscar = async (termino: string, conCarta = true) =>
    (await buscarProductosSelector(termino, { tipo: "PV", soloDisponibles: true, ...(conCarta ? { tambienPorNombreDeCarta: true } : {}) })).map((p) => p.nombre);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const u = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } });
    napo = (await sembrarProductoDisponible({ codigo: "PV_NAPO", nombre: "Milanesa napolitana a la parrilla", tipo: "PV", precioVenta: 9000, unidadStockId: u.id }, sucursalId)).id;
    const flan = (await sembrarProductoDisponible({ codigo: "PV_FLAN", nombre: "Flan", tipo: "PV", precioVenta: 3000, unidadStockId: u.id }, sucursalId)).id;
    await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: napo, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 0, nombreEnCarta: "Milanga especial" } });
    // Un nombre de carta de OTRA sucursal para el flan: no debe encontrarlo acá.
    await prisma.disponibilidadProducto.create({ data: { sucursalId: otraSucursalId, productoId: flan, disponible: true } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: otraSucursalId, productoId: flan, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 0, nombreEnCarta: "Postre de la casa" } });
  });

  it("encuentra por el nombre interno y por el de la carta (sin distinguir mayúsculas ni tildes); devuelve el nombre interno", async () => {
    expect(await buscar("parrilla")).toEqual(["Milanesa napolitana a la parrilla"]);
    expect(await buscar("MILANGA Especial")).toEqual(["Milanesa napolitana a la parrilla"]);
    expect(await buscar("milángá")).toEqual(["Milanesa napolitana a la parrilla"]);
    expect(await buscar("PV_NAPO")).toEqual(["Milanesa napolitana a la parrilla"]);
  });

  it("sin el filtro del POS el nombre de carta no cuenta (las demás pantallas siguen como siempre)", async () => {
    expect(await buscar("Milanga especial", false)).toEqual([]);
    expect(await buscar("parrilla", false)).toEqual(["Milanesa napolitana a la parrilla"]);
  });

  it("el nombre de carta de otra sucursal no se encuentra acá", async () => {
    expect(await buscar("Postre de la casa")).toEqual([]);
  });
});
