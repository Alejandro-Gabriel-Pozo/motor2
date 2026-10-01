import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, sembrarProductoDisponible } from "../setup/test-db";
import { resolverMenuCarta } from "../../src/core/carta/menu-consulta";
import { cargarAdminCarta } from "../../src/core/carta/admin-consulta";
import { cargarSelectorCartaPos } from "../../src/core/pos/selector-carta-consulta";

/**
 * CARACTERIZACIÓN — congela cómo se comporta HOY la estructura de la carta: es UNA sola para toda la empresa. Una sección, un género y el
 * contenido de un producto cargados una vez los ven igual todas las sucursales (cambia solo lo que depende de la sucursal: qué productos
 * están disponibles y a qué precio). Cuando la carta pase a ser propia de cada sucursal (decisión del 2026-09-30, modelo A), este archivo se
 * INVIERTE a propósito — cada sucursal ve solo su estructura — en vez de borrarse, para que el cambio de comportamiento quede visible.
 */
describe("Caracterización: la estructura de la carta es compartida entre sucursales", () => {
  let sucursalA: string;
  let sucursalB: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const u = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    sucursalA = (await prisma.sucursal.create({ data: { nombre: "Sucursal A" } })).id;
    sucursalB = (await prisma.sucursal.create({ data: { nombre: "Sucursal B" } })).id;

    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } });
    const genero = await prisma.generoCarta.create({ data: { nombre: "Pizzas", orden: 1 } });
    const pizza = await sembrarProductoDisponible({ codigo: "CARTA_PIZZA", nombre: "Pizza", tipo: "PV", precioVenta: 10000, unidadStockId: u.id }, sucursalA);
    await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursalB, productoId: pizza.id, disponible: true } });
    await prisma.contenidoCartaProducto.create({ data: { productoId: pizza.id, visibleEnCarta: true, seccionCartaId: seccion.id, generoCartaId: genero.id } });
  });

  it("la carta pública de las dos sucursales muestra las mismas secciones e ítems", async () => {
    const [a, b] = await Promise.all([resolverMenuCarta(sucursalA, prisma), resolverMenuCarta(sucursalB, prisma)]);
    const resumen = (c: typeof a) => c!.secciones.map((s) => ({ seccion: s.nombre, items: s.items.map((i) => i.nombre) }));
    expect(resumen(a)).toEqual([{ seccion: "Platos", items: ["Pizza"] }]);
    expect(resumen(b)).toEqual(resumen(a));
  });

  it("el admin de carta de las dos sucursales ve las mismas secciones y géneros (las mismas filas)", async () => {
    const [a, b] = await Promise.all([cargarAdminCarta(sucursalA, prisma), cargarAdminCarta(sucursalB, prisma)]);
    expect(a.secciones.map((s) => s.nombre)).toEqual(["Platos"]);
    expect(a.generos.map((g) => g.nombre)).toEqual(["Pizzas"]);
    expect(b.secciones).toEqual(a.secciones);
    expect(b.generos).toEqual(a.generos);
  });

  it("el selector del POS de las dos sucursales arma la misma estructura de secciones", async () => {
    const [a, b] = await Promise.all([cargarSelectorCartaPos(sucursalA, prisma), cargarSelectorCartaPos(sucursalB, prisma)]);
    expect(a.seccionesCarta.map((s) => s.nombre)).toEqual(["Platos"]);
    expect(b.seccionesCarta.map((s) => ({ id: s.seccionCartaId, nombre: s.nombre }))).toEqual(a.seccionesCarta.map((s) => ({ id: s.seccionCartaId, nombre: s.nombre })));
    expect(a.fueraDeCarta).toEqual([]);
    expect(b.fueraDeCarta).toEqual([]);
  });
});
