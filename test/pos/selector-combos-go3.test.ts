import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { sembrarSalon } from "./salon-fixture";
import { cargarSelectorCartaDeLaMesa } from "../../src/server/consultas/pos/selector-carta";
import { cargarPromoCartaParaAgregar } from "../../src/server/lecturas/pos/promo-para-agregar";
import type { CupoDeEntradasSelectorCarta, EntradaPromoSelectorCarta, SelectorCartaPos } from "../../src/core/pos/public";
import type { CupoDeEntradasDefinicion } from "../../src/core/pos/promo-combo";
import { claveDeConfiguracion } from "../../src/core/pos/promo-combo";
import { ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";

/**
 * GO-3b (ADR-032, F6 paso U5), contra Postgres real: lo que el SELECTOR del POS ofrece de los combos con cupos de entradas (la pantalla de la mesa, con la zona de la empresa). Fija:
 *  - el menú se ofrece con sus platos, el postre FIJO y el café con su configuración por nombre y precio de lista; sin la zona (lo de siempre) no aparece;
 *  - PARIDAD con la venta: las entradas que el selector ofrece en cada cupo son EXACTAMENTE las elegibles con que `cargarPromoCartaParaAgregar` valida (la misma lectura);
 * (El caso de las combinaciones del café con ejes se retiró con GO-3a en la Fase 3 de la ola «precio y carta».)
 *
 * Mutación demostrada (roja y revertida): no filtrar por la vigencia en el selector (rojo: «vigencia»).
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let c: CafeDelSalon;
const ahora = () => new Date();

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  c = await sembrarCafeDelSalon(s);
});

async function menuConPlatos() {
  // La promo vive en una sección de la carta de la sucursal (si no, el selector no la ubica).
  const seccion = await prisma.seccionCarta.create({ data: { nombre: "Menús" } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.flan.id, visibleEnCarta: true, seccionCartaId: seccion.id } });
  const promoCartaId = (await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: s.sucursalId } }, seccionCartaId: seccion.id, titulo: "Menú de la casa", precio: "10000.00" } })).id;
  const cupo = (tipo: "LISTA", nombre: string, orden: number) => prisma.promoCartaCupo.create({ data: { promoCartaId, tipo, nombre, orden, cantidadMinima: 1, cantidadMaxima: 1 } });
  const plato = await cupo("LISTA", "Plato", 0);
  const postre = await cupo("LISTA", "Postre", 1);
  const bebida = await cupo("LISTA", "Bebida", 2);
  const milanesa = await prisma.entradaDeCupo.create({ data: { cupoId: plato.id, productoId: s.milanesa.id, orden: 0 } });
  const pizza = await prisma.entradaDeCupo.create({ data: { cupoId: plato.id, productoId: s.pizza.id, orden: 1 } });
  const flan = await prisma.entradaDeCupo.create({ data: { cupoId: postre.id, productoId: s.flan.id } });
  const opciones = [{ opcionId: c.medianoId, cantidad: 1 }, { opcionId: c.almendrasId, cantidad: 1 }];
  const cafe = await prisma.entradaDeCupo.create({ data: { cupoId: bebida.id, productoId: c.cafeId, claveConfiguracion: claveDeConfiguracion(opciones)!, opciones: { create: opciones } } });
  return { promoCartaId, plato, postre, bebida, milanesa, pizza, flan, cafe };
}

const promoDe = (selector: SelectorCartaPos, promoCartaId: string) =>
  selector.seccionesCarta.flatMap((sec) => sec.entradas).find((e): e is EntradaPromoSelectorCarta => e.tipo === "promo" && e.promoCartaId === promoCartaId) ?? null;

describe("el selector del POS con combos de entradas (GO-3b, U5)", () => {
  it("con la zona: el menú con sus platos, el postre fijo y el café configurado por nombre y precio de lista; sin ella, no aparece", async () => {
    const m = await menuConPlatos();
    const promo = promoDe(await cargarSelectorCartaDeLaMesa(s.sucursalId, prisma, ahora(), ZONA_ARGENTINA), m.promoCartaId);
    expect(promo).not.toBeNull();
    const cupos = promo!.cupos as CupoDeEntradasSelectorCarta[];
    expect(cupos.map((x) => [x.cupoId, x.tipo, x.fijo, x.entradas.map((e) => [e.entradaId, e.nombre, e.precioLista])])).toEqual([
      [m.plato.id, "LISTA", false, [[m.milanesa.id, "Milanesa", 9000], [m.pizza.id, "Pizza", 12000]]],
      [m.postre.id, "LISTA", true, [[m.flan.id, "Flan", 3000]]],
      [m.bebida.id, "LISTA", true, [[m.cafe.id, "Café · Mediano · Almendras", 1150]]],
    ]);
    expect(promoDe(await cargarSelectorCartaDeLaMesa(s.sucursalId, prisma, ahora()), m.promoCartaId)).toBeNull();
  });

  it("PARIDAD: lo que el selector ofrece en cada cupo es exactamente lo que la venta acepta", async () => {
    const m = await menuConPlatos();
    await prisma.opcionApagadaEnSucursal.create({ data: { sucursalId: s.sucursalId, opcionId: c.almendrasId, apagada: true, actualizadoPorId: s.admin.id } });
    const [promo, def] = await Promise.all([
      cargarSelectorCartaDeLaMesa(s.sucursalId, prisma, ahora(), ZONA_ARGENTINA).then((sel) => promoDe(sel, m.promoCartaId)),
      cargarPromoCartaParaAgregar(s.sucursalId, m.promoCartaId, prisma, ahora()),
    ]);
    const delSelector = (promo!.cupos as CupoDeEntradasSelectorCarta[]).map((x) => [x.cupoId, x.entradas.map((e) => e.entradaId)]);
    const deLaVenta = (def!.cupos as CupoDeEntradasDefinicion[]).map((x) => [x.cupoId, [...x.entradas.keys()]]);
    expect(delSelector).toEqual(deLaVenta);
    // Las almendras apagadas dejan al café afuera en los dos lados.
    expect(delSelector[2]).toEqual([m.bebida.id, []]);
  });
});
