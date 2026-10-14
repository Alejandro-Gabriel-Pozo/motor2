import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { sembrarSalon } from "./salon-fixture";
import { cargarSelectorCartaDeLaMesa } from "../../src/server/consultas/pos/selector-carta";
import { cargarOpcionesDelSelector } from "../../src/server/consultas/pos/opciones-del-selector";
import { cargarPromoCartaParaAgregar } from "../../src/server/lecturas/pos/promo-para-agregar";
import type { CupoDeEntradasSelectorCarta, EntradaPromoSelectorCarta, SelectorCartaPos } from "../../src/core/pos/public";
import type { CupoDeEntradasDefinicion } from "../../src/core/pos/promo-combo";
import { claveDeConfiguracion } from "../../src/core/pos/promo-combo";
import { diaDeCalendario, fechaDeColumnaDate, sumarDias, ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";

/**
 * GO-3b (ADR-032, F6 paso U5), contra Postgres real: lo que el SELECTOR del POS ofrece de los combos con cupos de entradas (la pantalla de la mesa, con la zona de la empresa) y las combinaciones
 * que llegan al diálogo de opciones. Fija:
 *  - el menú del día se ofrece con su plato de HOY, el postre FIJO y el café con su configuración por nombre y precio de lista; sin la zona (lo de siempre) no aparece;
 *  - PARIDAD con la venta: las entradas que el selector ofrece en cada cupo son EXACTAMENTE las elegibles con que `cargarPromoCartaParaAgregar` valida (la misma lectura);
 *  - la vigencia: una promo que no vale hoy no se ofrece;
 *  - las combinaciones del café con ejes llegan al diálogo en su forma serializable y el «desde» las respeta.
 *
 * Mutación demostrada (roja y revertida): no filtrar por la vigencia en el selector (rojo: «vigencia»).
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let c: CafeDelSalon;
let hoy: string;
const ahora = () => new Date();

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  c = await sembrarCafeDelSalon(s);
  hoy = diaDeCalendario(new Date(), ZONA_ARGENTINA);
});

async function menuDelDia() {
  // La promo vive en una sección de la carta de la sucursal (si no, el selector no la ubica).
  const seccion = await prisma.seccionCarta.create({ data: { nombre: "Menús" } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.flan.id, visibleEnCarta: true, seccionCartaId: seccion.id } });
  const promoCartaId = (await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: s.sucursalId } }, seccionCartaId: seccion.id, titulo: "Menú del día", precio: "10000.00" } })).id;
  const cupo = (tipo: "LISTA" | "DEL_DIA", nombre: string, orden: number) => prisma.promoCartaCupo.create({ data: { promoCartaId, tipo, nombre, orden, cantidadMinima: 1, cantidadMaxima: 1 } });
  const plato = await cupo("DEL_DIA", "Plato del día", 0);
  const postre = await cupo("LISTA", "Postre", 1);
  const bebida = await cupo("LISTA", "Bebida", 2);
  const delDia = (productoId: string, dia: string) => prisma.entradaDelDiaDeCupo.create({ data: { cupoId: plato.id, sucursalId: s.sucursalId, fecha: fechaDeColumnaDate(dia), productoId, actualizadoPorId: s.admin.id } });
  const milanesa = await delDia(s.milanesa.id, hoy);
  await delDia(s.pizza.id, sumarDias(hoy, 1));
  const flan = await prisma.entradaDeCupo.create({ data: { cupoId: postre.id, productoId: s.flan.id } });
  const opciones = [{ opcionId: c.medianoId, cantidad: 1 }, { opcionId: c.almendrasId, cantidad: 1 }];
  const cafe = await prisma.entradaDeCupo.create({ data: { cupoId: bebida.id, productoId: c.cafeId, claveConfiguracion: claveDeConfiguracion(opciones)!, opciones: { create: opciones } } });
  return { promoCartaId, plato, postre, bebida, milanesa, flan, cafe };
}

const promoDe = (selector: SelectorCartaPos, promoCartaId: string) =>
  selector.seccionesCarta.flatMap((sec) => sec.entradas).find((e): e is EntradaPromoSelectorCarta => e.tipo === "promo" && e.promoCartaId === promoCartaId) ?? null;

describe("el selector del POS con combos de entradas (GO-3b, U5)", () => {
  it("con la zona: el menú con el plato de HOY, el postre fijo y el café configurado por nombre y precio de lista; sin ella, no aparece", async () => {
    const m = await menuDelDia();
    const promo = promoDe(await cargarSelectorCartaDeLaMesa(s.sucursalId, prisma, ahora(), ZONA_ARGENTINA), m.promoCartaId);
    expect(promo).not.toBeNull();
    const cupos = promo!.cupos as CupoDeEntradasSelectorCarta[];
    expect(cupos.map((x) => [x.cupoId, x.tipo, x.fijo, x.entradas.map((e) => [e.entradaId, e.nombre, e.precioLista])])).toEqual([
      [m.plato.id, "DEL_DIA", false, [[m.milanesa.id, "Milanesa", 9000]]],
      [m.postre.id, "LISTA", true, [[m.flan.id, "Flan", 3000]]],
      [m.bebida.id, "LISTA", true, [[m.cafe.id, "Café · Mediano · Almendras", 1150]]],
    ]);
    expect(promoDe(await cargarSelectorCartaDeLaMesa(s.sucursalId, prisma, ahora()), m.promoCartaId)).toBeNull();
  });

  it("PARIDAD: lo que el selector ofrece en cada cupo es exactamente lo que la venta acepta", async () => {
    const m = await menuDelDia();
    await prisma.opcionApagadaEnSucursal.create({ data: { sucursalId: s.sucursalId, opcionId: c.almendrasId, apagada: true, actualizadoPorId: s.admin.id } });
    const [promo, def] = await Promise.all([
      cargarSelectorCartaDeLaMesa(s.sucursalId, prisma, ahora(), ZONA_ARGENTINA).then((sel) => promoDe(sel, m.promoCartaId)),
      cargarPromoCartaParaAgregar(s.sucursalId, m.promoCartaId, prisma, ahora(), undefined, hoy),
    ]);
    const delSelector = (promo!.cupos as CupoDeEntradasSelectorCarta[]).map((x) => [x.cupoId, x.entradas.map((e) => e.entradaId)]);
    const deLaVenta = (def!.cupos as CupoDeEntradasDefinicion[]).map((x) => [x.cupoId, [...x.entradas.keys()]]);
    expect(delSelector).toEqual(deLaVenta);
    // Las almendras apagadas dejan al café afuera en los dos lados.
    expect(delSelector[2]).toEqual([m.bebida.id, []]);
  });

  it("la vigencia: una promo que no vale hoy (vencida, o no es su día de la semana) no se ofrece", async () => {
    const m = await menuDelDia();
    await prisma.promoCarta.update({ where: { id: m.promoCartaId }, data: { vigenteHasta: fechaDeColumnaDate(sumarDias(hoy, -1)) } });
    expect(promoDe(await cargarSelectorCartaDeLaMesa(s.sucursalId, prisma, ahora(), ZONA_ARGENTINA), m.promoCartaId)).toBeNull();
    await prismaAdmin.promoCarta.update({ where: { id: m.promoCartaId }, data: { vigenteHasta: null, vigenteDesde: fechaDeColumnaDate(hoy) } });
    expect(promoDe(await cargarSelectorCartaDeLaMesa(s.sucursalId, prisma, ahora(), ZONA_ARGENTINA), m.promoCartaId)).not.toBeNull();
  });

  it("las combinaciones del café con ejes llegan al diálogo y el «desde» las respeta", async () => {
    await prisma.productoAdmiteGrupo.update({ where: { productoId_grupoId: { productoId: c.cafeId, grupoId: c.grupoMedidaId } }, data: { ejeDeCombinacion: 1 } });
    const chico = await prisma.combinacionDeProducto.create({ data: { productoId: c.cafeId, opcionEje1Id: c.chicoId, activa: false } });
    await prisma.combinacionDeProducto.create({ data: { productoId: c.cafeId, opcionEje1Id: c.medianoId, precio: "980.00" } });
    const selector = await cargarSelectorCartaDeLaMesa(s.sucursalId, prisma, ahora(), ZONA_ARGENTINA);
    const conf = (await cargarOpcionesDelSelector(s.sucursalId, prisma, selector))[c.cafeId]!;
    const filas = [...(conf.combinaciones?.filas ?? [])].sort((a, b) => Number(a.activa) - Number(b.activa));
    expect(filas.map((f) => [f.activa ? "mediano" : f.combinacionId, f.activa, f.precio])).toEqual([
      [chico.id, false, null],
      ["mediano", true, 980],
    ]);
    // Chico apagado: el más barato que se puede pedir es el mediano a 980 (el aditivo sería chico a 950).
    expect(conf.desde).toBe(980);
    // Un producto sin ejes no lleva combinaciones.
    expect(Object.values(await cargarOpcionesDelSelector(s.sucursalId, prisma, selector)).filter((x) => x.combinaciones).length).toBe(1);
  });
});
