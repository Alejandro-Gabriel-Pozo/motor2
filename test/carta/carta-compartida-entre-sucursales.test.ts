import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, sembrarProductoDisponible } from "../setup/test-db";
import { resolverMenuCarta } from "../../src/server/lecturas/carta/menu";
import { cargarAdminCarta } from "../../src/server/consultas/carta/admin";
import { cargarSelectorCartaPos } from "../../src/server/lecturas/pos/selector-carta";

/**
 * Carta PROPIA de cada sucursal (ADR-009, C3/C4; decisión del dueño 2026-10-02). Este archivo era la caracterización «la estructura de la carta
 * es una sola para toda la empresa» y se INVIRTIÓ a propósito: las SECCIONES siguen siendo de la empresa (las ven todas), pero el contenido de
 * cada producto, los géneros, los ítems agrupados y su orden son de cada sucursal. Una sucursal que no armó su carta no muestra nada (familia
 * «opt-in») hasta que la arma o la copia de otra.
 */
describe("La estructura de la carta es propia de cada sucursal", () => {
  let sucursalA: string;
  let sucursalB: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const u = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    sucursalA = (await prisma.sucursal.create({ data: { nombre: "Sucursal A" } })).id;
    sucursalB = (await prisma.sucursal.create({ data: { nombre: "Sucursal B" } })).id;

    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } });
    const genero = await prisma.generoCarta.create({ data: { sucursalId: sucursalA, nombre: "Pizzas", orden: 1 } });
    const pizza = await sembrarProductoDisponible({ codigo: "CARTA_PIZZA", nombre: "Pizza", tipo: "PV", precioVenta: 10000, unidadStockId: u.id }, sucursalA);
    await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursalB, productoId: pizza.id, disponible: true } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: sucursalA, productoId: pizza.id, visibleEnCarta: true, seccionCartaId: seccion.id, generoCartaId: genero.id } });
  });

  it("la carta pública solo muestra items en la sucursal que armó su carta", async () => {
    const [a, b] = await Promise.all([resolverMenuCarta(sucursalA, prisma), resolverMenuCarta(sucursalB, prisma)]);
    const resumen = (c: typeof a) => c!.secciones.map((s) => ({ seccion: s.nombre, items: s.items.map((i) => i.nombre) }));
    expect(resumen(a)).toEqual([{ seccion: "Platos", items: ["Pizza"] }]);
    expect(resumen(b)).toEqual([]);
  });

  it("el admin de carta: las secciones son de la empresa, los géneros y el estado de la carta son de cada sucursal", async () => {
    const [a, b] = await Promise.all([cargarAdminCarta(sucursalA, prisma), cargarAdminCarta(sucursalB, prisma)]);
    expect(a.secciones.map((s) => s.nombre)).toEqual(["Platos"]);
    expect(b.secciones.map((s) => s.id)).toEqual(a.secciones.map((s) => s.id));
    expect(a.secciones.map((s) => s.cantidadItems)).toEqual([1]);
    expect(b.secciones.map((s) => s.cantidadItems)).toEqual([0]);
    expect(a.generos.map((g) => g.nombre)).toEqual(["Pizzas"]);
    expect(b.generos).toEqual([]);
    expect(a.cartaVacia).toBe(false);
    expect(b.cartaVacia).toBe(true);
    expect(a.sucursalesConCarta).toEqual([]);
    expect(b.sucursalesConCarta.map((s) => s.id)).toEqual([sucursalA]);
  });

  it("el selector del POS: la sucursal sin carta propia no arma secciones y deja el producto fuera de carta", async () => {
    const [a, b] = await Promise.all([cargarSelectorCartaPos(sucursalA, prisma), cargarSelectorCartaPos(sucursalB, prisma)]);
    expect(a.seccionesCarta.map((s) => s.nombre)).toEqual(["Platos"]);
    expect(a.fueraDeCarta).toEqual([]);
    expect(b.seccionesCarta).toEqual([]);
    expect(b.fueraDeCarta.map((p) => p.nombre)).toEqual(["Pizza"]);
  });

  it("un MISMO producto armado distinto en cada sucursal: cada carta pública muestra su sección y su descripción", async () => {
    const pizza = await prisma.producto.findFirstOrThrow({ where: { codigo: "CARTA_PIZZA" } });
    const postres = await prisma.seccionCarta.create({ data: { nombre: "Postres", orden: 2 } });
    await prisma.contenidoCartaProducto.update({ where: { sucursalId_productoId: { sucursalId: sucursalA, productoId: pizza.id } }, data: { descripcion: "de A" } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: sucursalB, productoId: pizza.id, visibleEnCarta: true, seccionCartaId: postres.id, descripcion: "de B" } });

    const [a, b] = await Promise.all([resolverMenuCarta(sucursalA, prisma), resolverMenuCarta(sucursalB, prisma)]);
    const resumen = (c: typeof a) => c!.secciones.map((s) => ({ seccion: s.nombre, items: s.items.map((i) => [i.nombre, i.descripcion]) }));
    expect(resumen(a)).toEqual([{ seccion: "Platos", items: [["Pizza", "de A"]] }]);
    expect(resumen(b)).toEqual([{ seccion: "Postres", items: [["Pizza", "de B"]] }]);
  });
});
