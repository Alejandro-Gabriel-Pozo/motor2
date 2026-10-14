import { diaDeCalendario, ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";
import { beforeEach, describe, expect, it } from "vitest";
import { cargarPromoCartaParaAgregar } from "../../src/server/lecturas/pos/promo-para-agregar";
import { cargarSelectorCartaPos } from "../../src/server/lecturas/pos/selector-carta";
import { cuposDeSeccionActivos, tieneCupoActivoDeTipoNuevo } from "../../src/core/carta/cupos-de-promo";
import { pisoDePrecioDePromo } from "../../src/core/carta/piso-de-promo";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { sembrarSalon } from "../pos/salon-fixture";

/**
 * GO-3 (ADR-032), paso D2: los lectores TOLERANTES del primer despliegue («expandir y contraer»). Con GO-3d en la base, un cupo puede ser LISTA o DEL_DIA (sin sección) o estar dado de baja.
 * El código de este despliegue solo arma cupos de SECCIÓN activos y NO ofrece una promo con un cupo activo de un tipo nuevo (nunca un combo a medias por su precio entero). El reemplazo de
 * cupos de la administración de hoy solo toca los de sección. Con solo cupos de sección activos (todo lo de hoy), nada cambia: lo fijan los tests de siempre (`promo-combo-consulta`,
 * `selector-carta-consulta`, `cupos-promo-auditados`, `huella-del-pos`).
 *
 * Mutaciones demostradas: sacar el `tieneCupoActivoDeTipoNuevo` de `promo-para-agregar.ts` (la promo con un cupo LISTA se ofrece armada a medias) y sacar el `tipo: "SECCION"` del `deleteMany` de
 * `reemplazarCuposDePromo` (borraría el cupo LISTA).
 *
 * GO-3b (D3): el reemplazo que borraba (`reemplazarCuposDePromo`) ya no existe: guardar los cupos los lleva al estado pedido sin borrar ninguno (`test/carta/cupos-sin-borrar-go3.test.ts`).
 * El caso «el reemplazo solo toca los de sección» se mudó allá, con la semántica nueva (la lista es la final, de todos los tipos, y lo que no viene se da de baja).
 */
describe("los lectores de cupos del primer despliegue de GO-3", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let seccionId: string;
  let promoCartaId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Postres" } })).id;
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.flan.id, visibleEnCarta: true, seccionCartaId: seccionId } });
    promoCartaId = (await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: s.sucursalId } }, seccionCartaId: seccionId, titulo: "Menú del día", precio: 2000 } })).id;
    await prisma.promoCartaCupo.create({ data: { promoCartaId, seccionCartaId: seccionId, cantidadMinima: 1, cantidadMaxima: 1 } });
  });

  const promosDelSelector = async () =>
    (await cargarSelectorCartaPos(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA)).seccionesCarta.flatMap((sec) => sec.entradas).filter((e) => e.tipo === "promo");

  it("con solo cupos de sección activos, la promo se ofrece como siempre (en el selector y para agregar)", async () => {
    expect((await promosDelSelector()).map((p) => (p.tipo === "promo" ? p.promoCartaId : null))).toEqual([promoCartaId]);
    expect((await cargarPromoCartaParaAgregar(s.sucursalId, promoCartaId, prisma, AHORA_DE_LA_CORRIDA))?.cupos.map((c) => ("seccionCartaId" in c ? c.seccionCartaId : c.cupoId))).toEqual([seccionId]);
  });

  // GO-3b (I2, el segundo despliegue): la lectura para AGREGAR ya arma los cupos LISTA y DEL_DIA (con sus entradas de hoy: `test/pos/agregar-combo-go3.test.ts`). El selector del POS los sigue sin
  // ofrecer hasta su paso de pantalla (U5): nunca ofrece lo que no sabe mostrar.
  it("con un cupo LISTA o DEL_DIA ACTIVO: el selector todavía no la ofrece; para agregar se arma con sus cupos (un DEL_DIA necesita el día); dado de baja, no cuenta", async () => {
    const lista = await prisma.promoCartaCupo.create({ data: { promoCartaId, tipo: "LISTA", nombre: "Entrada", cantidadMinima: 1, cantidadMaxima: 1, orden: 1 } });
    expect(await promosDelSelector()).toEqual([]);
    expect((await cargarPromoCartaParaAgregar(s.sucursalId, promoCartaId, prisma, AHORA_DE_LA_CORRIDA))?.cupos.map((c) => ("cupoId" in c ? c.cupoId : c.seccionCartaId))).toEqual([seccionId, lista.id]);
    await prismaAdmin.promoCartaCupo.update({ where: { id: lista.id }, data: { activo: false } });
    expect(await promosDelSelector()).toHaveLength(1);
    expect((await cargarPromoCartaParaAgregar(s.sucursalId, promoCartaId, prisma, AHORA_DE_LA_CORRIDA))?.cupos).toHaveLength(1);
    await prisma.promoCartaCupo.create({ data: { promoCartaId, tipo: "DEL_DIA", nombre: "Plato del día", cantidadMinima: 1, cantidadMaxima: 1, orden: 2 } });
    expect(await cargarPromoCartaParaAgregar(s.sucursalId, promoCartaId, prisma, AHORA_DE_LA_CORRIDA)).toBeNull();
    expect((await cargarPromoCartaParaAgregar(s.sucursalId, promoCartaId, prisma, AHORA_DE_LA_CORRIDA, undefined, diaDeCalendario(AHORA_DE_LA_CORRIDA, ZONA_ARGENTINA)))?.cupos).toHaveLength(2);
  });

  it("un cupo de sección dado de baja no se lee: si era el único, la promo vuelve a ser informativa", async () => {
    await prismaAdmin.promoCartaCupo.updateMany({ where: { promoCartaId }, data: { activo: false } });
    expect(await promosDelSelector()).toEqual([]);
    expect(await cargarPromoCartaParaAgregar(s.sucursalId, promoCartaId, prisma, AHORA_DE_LA_CORRIDA)).toBeNull();
  });
});

describe("el núcleo de la lectura tolerante (puro)", () => {
  const cupo = (tipo: string, activo: boolean, seccionCartaId: string | null) => ({ tipo, activo, seccionCartaId, seccionCarta: seccionCartaId ? { nombre: seccionCartaId } : null });

  it("cuposDeSeccionActivos deja solo los de sección activos con sección, en el orden recibido", () => {
    const cupos = [cupo("SECCION", true, "a"), cupo("LISTA", true, null), cupo("SECCION", false, "b"), cupo("SECCION", true, "c"), cupo("SECCION", true, null)];
    expect(cuposDeSeccionActivos(cupos).map((c) => c.seccionCarta.nombre)).toEqual(["a", "c"]);
  });

  it("tieneCupoActivoDeTipoNuevo mira solo los activos de un tipo que no es SECCION", () => {
    expect(tieneCupoActivoDeTipoNuevo([cupo("SECCION", true, "a"), cupo("LISTA", false, null)])).toBe(false);
    expect(tieneCupoActivoDeTipoNuevo([cupo("SECCION", true, "a"), cupo("DEL_DIA", true, null)])).toBe(true);
    expect(tieneCupoActivoDeTipoNuevo([])).toBe(false);
  });

  it("el piso de la promo no cambia con la forma de los cupos nuevos: $0,01 por unidad del peor caso (un componente fijo cuenta como su máximo)", () => {
    expect(pisoDePrecioDePromo([{ cantidadMaxima: 1 }, { cantidadMaxima: 2 }, { cantidadMaxima: 1 }])).toEqual({ minimo: 0.04, unidades: 4 });
    expect(pisoDePrecioDePromo([])).toBeNull();
  });
});
