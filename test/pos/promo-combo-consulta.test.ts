import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { sembrarSalon } from "./salon-fixture";
import { cargarPromoCartaParaAgregar } from "../../src/core/pos/promo-combo-consulta";
import { cargarSelectorCartaPos } from "../../src/core/pos/selector-carta-consulta";
import { pediblesDeEntrada } from "../../src/core/pos/selector-carta";

/**
 * Task #16 (promo-combo, docs/plan-promo-combo-2026-09-26.md, paso 8a): `cargarPromoCartaParaAgregar` tiene que dar EXACTO los
 * mismos elegibles por sección que el selector del POS (D5, paridad) — la fuente que usa `agregarItems` para validar la
 * elección del mozo.
 */
describe("cargarPromoCartaParaAgregar", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let seccionEntradasId: string;
  let seccionPostresId: string;
  let promoCartaId: string;
  let empanadaId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    const entradas = await prisma.seccionCarta.create({ data: { nombre: "Entradas" } });
    const postres = await prisma.seccionCarta.create({ data: { nombre: "Postres" } });
    seccionEntradasId = entradas.id;
    seccionPostresId = postres.id;

    empanadaId = (await prisma.producto.create({ data: { codigo: "PV_EMPA", nombre: "Empanada de carne", tipo: "PV", unidadStockId: s.unidad.id, precioVenta: 700 } })).id;
    await prisma.disponibilidadProducto.create({ data: { sucursalId: s.sucursalId, productoId: empanadaId, disponible: true } });
    await prisma.contenidoCartaProducto.create({ data: { productoId: empanadaId, visibleEnCarta: true, seccionCartaId: seccionEntradasId } });
    // Flan (de sembrarSalon) visible en Postres.
    await prisma.contenidoCartaProducto.create({ data: { productoId: s.flan.id, visibleEnCarta: true, seccionCartaId: seccionPostresId } });

    const promo = await prisma.promoCarta.create({ data: { sucursalId: s.sucursalId, seccionCartaId: seccionEntradasId, titulo: "Menú del día", precio: 2000 } });
    promoCartaId = promo.id;
    await prisma.promoCartaCupo.createMany({
      data: [
        { promoCartaId, seccionCartaId: seccionEntradasId, cantidadMinima: 1, cantidadMaxima: 2, orden: 0 },
        { promoCartaId, seccionCartaId: seccionPostresId, cantidadMaxima: 1, orden: 1 },
      ],
    });
  });

  it("null si la promo no existe, es de otra sucursal, está apagada, o no tiene cupos", async () => {
    expect(await cargarPromoCartaParaAgregar(s.sucursalId, "no-existe", prisma)).toBeNull();
    const otra = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    expect(await cargarPromoCartaParaAgregar(otra, promoCartaId, prisma)).toBeNull();
    await prisma.promoCarta.update({ where: { id: promoCartaId }, data: { activa: false } });
    expect(await cargarPromoCartaParaAgregar(s.sucursalId, promoCartaId, prisma)).toBeNull();
    await prisma.promoCarta.update({ where: { id: promoCartaId }, data: { activa: true } });
    const sinCupos = await prisma.promoCarta.create({ data: { sucursalId: s.sucursalId, seccionCartaId: seccionEntradasId, titulo: "Informativa", precio: 100 } });
    expect(await cargarPromoCartaParaAgregar(s.sucursalId, sinCupos.id, prisma)).toBeNull();
  });

  it("trae los dos cupos con nombre, mínimo y máximo", async () => {
    const def = await cargarPromoCartaParaAgregar(s.sucursalId, promoCartaId, prisma);
    expect(def).not.toBeNull();
    if (!def) return;
    expect(def).toMatchObject({ id: promoCartaId, titulo: "Menú del día", precio: 2000 });
    expect(def.cupos).toHaveLength(2);
    expect(def.cupos[0]).toMatchObject({ seccionCartaId: seccionEntradasId, nombreSeccion: "Entradas", cantidadMinima: 1, cantidadMaximaCupo: 2 });
    expect(def.cupos[1]).toMatchObject({ seccionCartaId: seccionPostresId, nombreSeccion: "Postres", cantidadMinima: 0, cantidadMaximaCupo: 1 });
  });

  it("PARIDAD: los elegibles de cada cupo son EXACTO los mismos que el selector del POS ofrece en esa sección (D5)", async () => {
    const [def, selector] = await Promise.all([cargarPromoCartaParaAgregar(s.sucursalId, promoCartaId, prisma), cargarSelectorCartaPos(s.sucursalId, prisma)]);
    expect(def).not.toBeNull();
    if (!def) return;
    const pediblesPorSeccion = new Map(selector.seccionesCarta.map((sec) => [sec.seccionCartaId, new Set(sec.entradas.flatMap(pediblesDeEntrada).map((p) => p.productoId))]));
    for (const cupo of def.cupos) {
      expect(cupo.elegibles).toEqual(pediblesPorSeccion.get(cupo.seccionCartaId));
    }
    expect(def.cupos[0].elegibles).toEqual(new Set([empanadaId]));
    expect(def.cupos[1].elegibles).toEqual(new Set([s.flan.id]));
  });

  it("un producto oculto, apagado o sin sección de carta NO es elegible, igual que en el selector", async () => {
    await prisma.contenidoCartaProducto.updateMany({ where: { productoId: empanadaId }, data: { visibleEnCarta: false } });
    const def = await cargarPromoCartaParaAgregar(s.sucursalId, promoCartaId, prisma);
    expect(def?.cupos[0].elegibles).toEqual(new Set());
  });

  it("precioCartaPorProducto trae el precio de carta (Precio Local si lo hay) de cada elegible", async () => {
    await prisma.precioLocalProducto.create({ data: { sucursalId: s.sucursalId, productoId: empanadaId, precio: 750, habilitado: true } });
    const def = await cargarPromoCartaParaAgregar(s.sucursalId, promoCartaId, prisma);
    expect(def?.precioCartaPorProducto.get(empanadaId)).toBe(750);
    expect(def?.precioCartaPorProducto.get(s.flan.id)).toBe(3000);
  });
});
