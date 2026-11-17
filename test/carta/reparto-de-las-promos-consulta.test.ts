import { beforeEach, describe, expect, it } from "vitest";
import { cargarRepartoDeLasPromos } from "../../src/server/consultas/carta/reparto-de-las-promos";
import { actorDeCombos, sembrarCombosAjenos, sembrarCombosGo3b, type EscenarioDeCombosGo3b } from "../setup/combos-go3b";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

/**
 * La lectura del «Reparto del precio» (`cargarRepartoDeLasPromos`) contra Postgres real, como `motor2_app` con el alcance de la sucursal A. Fija la regla de «primer producto disponible» (la del POS: selector para las
 * partes de sección, `cargarEntradasDePromoParaVender` para los lugares de lista) y el AISLAMIENTO: nada de otra empresa ni de otra sucursal.
 */
describe("lo que la pantalla lee para el reparto del precio de las promos", () => {
  let e: EscenarioDeCombosGo3b;
  const actor = () => actorDeCombos(e.usuarioId, e.sucursalA);
  const leer = () => cargarRepartoDeLasPromos(actor().db, e.sucursalA, AHORA_DE_LA_CORRIDA);
  const ejemplos = async () => (await leer())[e.promoId]!.map((p) => [p.nombre, p.cantidadMinima, p.cantidadMaxima, p.ejemplo]);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarCombosGo3b();
  });

  it("parte de LISTA: la primera entrada elegible HOY y su precio de lista; las que no se pueden elegir (inactiva, producto no disponible) se saltean; sin entradas, sin ejemplo", async () => {
    const cupoEntrada = await prisma.entradaDeCupo.create({ data: { cupoId: e.cupoEntradaId, productoId: e.guisoId, orden: 0 } });
    await prisma.entradaDeCupo.create({ data: { cupoId: e.cupoEntradaId, productoId: e.sopaId, orden: 1 } });
    // El DEL_DIA (retirado) no es una parte: no aparece. «Postre» sin entradas: sin ejemplo.
    expect(await ejemplos()).toEqual([["Entrada", 1, 1, { nombre: "Guiso de lentejas", precioLista: 7000 }], ["Postre", 1, 1, null]]);
    // La primera pasa a inactiva: el ejemplo es la siguiente.
    await prisma.entradaDeCupo.update({ where: { id: cupoEntrada.id }, data: { activa: false } });
    expect((await ejemplos())[0]).toEqual(["Entrada", 1, 1, { nombre: "Sopa de calabaza", precioLista: 3000 }]);
    // El producto de la que queda deja de estar disponible en la sucursal: sin ejemplo.
    await prisma.disponibilidadProducto.updateMany({ where: { productoId: e.sopaId, sucursalId: e.sucursalA }, data: { disponible: false } });
    expect((await ejemplos())[0]).toEqual(["Entrada", 1, 1, null]);
  });

  it("parte de SECCIÓN: el primer pedible de la sección en la carta de ESTA sucursal; lo ubicado en otra sucursal o fuera de la carta no cuenta", async () => {
    const bebidas = await prisma.seccionCarta.create({ data: { nombre: "Bebidas" } });
    await prisma.promoCartaCupo.create({ data: { promoCartaId: e.promoId, seccionCartaId: bebidas.id, cantidadMinima: 0, cantidadMaxima: 2, orden: 0 } });
    // Sin nada ubicado en la sección: sin ejemplo.
    expect((await ejemplos()).find((p) => p[0] === "Bebidas")).toEqual(["Bebidas", 0, 2, null]);
    // Ubicado en la OTRA sucursal: no cuenta para la A.
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: e.sucursalB, productoId: e.flanId, visibleEnCarta: true, seccionCartaId: bebidas.id } });
    expect((await ejemplos()).find((p) => p[0] === "Bebidas")![3]).toBeNull();
    // Ubicado en la A: cuenta, con su precio de lista.
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: e.sucursalA, productoId: e.flanId, visibleEnCarta: true, seccionCartaId: bebidas.id } });
    expect((await ejemplos()).find((p) => p[0] === "Bebidas")).toEqual(["Bebidas", 0, 2, { nombre: "Flan", precioLista: 2500 }]);
  });

  it("AISLAMIENTO: la promo de otra empresa no aparece ni deja rastro", async () => {
    const ajenos = await sembrarCombosAjenos();
    expect(await ajenos.testigo.promoCarta.count()).toBe(1);
    const todo = await leer();
    expect(Object.keys(todo)).toEqual([e.promoId]);
    expect(JSON.stringify(todo)).not.toContain("Plato testigo");
  });
});
