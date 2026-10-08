import { describe, expect, it } from "vitest";
import { armarComparativaDePrecios } from "../../src/core/catalogo/public";

/**
 * El armado PURO de la comparativa de precios por insumo (Hito 4, paso A5, O.8a: vivía en la Server Action `obtenerComparativaPreciosPorInsumo`). Sin base: ofertas, insumo de
 * cada producto y nombre de cada proveedor armados a mano.
 */
describe("armarComparativaDePrecios", () => {
  const fecha = new Date("2026-09-10T00:00:00Z");
  const oferta = (productoId: string, proveedorId: string, precioPorUnidadStock: number) => ({ productoId, proveedorId, precioPorUnidadStock, unidadCompraNombre: "kg", ultimaCompra: fecha });
  type Insumo = { id: string; nombre: string; grupo: { nombre: string } | null };
  const harina: Insumo = { id: "i-harina", nombre: "Harina", grupo: { nombre: "Secos" } };
  const aceite: Insumo = { id: "i-aceite", nombre: "Aceite", grupo: null };
  const insumoDe = new Map<string, Insumo | null>([
    ["p-000", harina],
    ["p-0000", harina],
    ["p-aceite", aceite],
    ["p-sin-insumo", null],
  ]);
  const nombreDe = new Map([
    ["v-a", "Proveedor A"],
    ["v-b", "Proveedor B"],
    ["v-c", "Proveedor C"],
  ]);
  const fila = (p: string, precio: number) => ({ proveedorNombre: p, precioPorUnidadStock: precio, unidadCompraNombre: "kg", ultimaCompra: fecha });

  it("una fila por insumo (sus productos juntos): con precio de la más barata a la más cara, después las de 0; el 0 nunca es el más barato", () => {
    const filas = armarComparativaDePrecios([oferta("p-000", "v-a", 0), oferta("p-000", "v-b", 500), oferta("p-0000", "v-c", 450)], insumoDe, nombreDe);
    expect(filas).toEqual([
      { insumo: "Harina", grupo: "Secos", masBarato: fila("Proveedor C", 450), todas: [fila("Proveedor C", 450), fila("Proveedor B", 500), fila("Proveedor A", 0)] },
    ]);
  });

  it("todas en 0: sin «más barato»; un producto sin insumo (o que no está) no entra", () => {
    const filas = armarComparativaDePrecios([oferta("p-aceite", "v-a", 0), oferta("p-sin-insumo", "v-b", 10), oferta("p-desconocido", "v-b", 10)], insumoDe, nombreDe);
    expect(filas).toEqual([{ insumo: "Aceite", grupo: null, masBarato: null, todas: [fila("Proveedor A", 0)] }]);
  });

  it("las filas van por grupo (sin grupo primero) y por insumo", () => {
    const filas = armarComparativaDePrecios([oferta("p-000", "v-a", 5), oferta("p-aceite", "v-a", 7)], insumoDe, nombreDe);
    expect(filas.map((f) => [f.grupo, f.insumo])).toEqual([
      [null, "Aceite"],
      ["Secos", "Harina"],
    ]);
  });

  it("sin ofertas, sin filas", () => {
    expect(armarComparativaDePrecios([], insumoDe, nombreDe)).toEqual([]);
  });
});
