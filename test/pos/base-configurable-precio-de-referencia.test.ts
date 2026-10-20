import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { GrupoParaVender, OpcionParaVender } from "../../src/core/pos/linea-configurada";
import { resumenDePrecios, vistaPreviaDeConfiguracion } from "../../src/core/pos/precio-de-configuracion";
import { componerPrecioDeLinea, type DiferenciaDePrecio } from "../../src/core/opciones/public";
import { opcionParaPrecio } from "../../src/core/pos/opcion-para-precio";

/**
 * Fase 4 de la ola «precio y carta», C3 (ADR-035): un producto que se vende POR OPCIÓN (base configurable) NO depende de su precio guardado. El resumen de precios (lo que muestran la carta, el
 * selector del POS, la vista previa del panel y el diálogo de opciones) compone cada opción sobre el PRECIO DE REFERENCIA de la base (su medida en ABSOLUTO más barata, con la grilla de la sucursal),
 * y la vista previa y la composición de la venta ya no lo usaban (la medida en ABSOLUTO reemplaza al precio base; una base no admite porcentajes).
 *
 * Propiedad: para configuraciones de base generadas (solo MONTO), el resumen, la vista previa y `componerPrecioDeLinea` dan EXACTAMENTE lo mismo con cualquier valor guardado (0, 1, 18.000, 999.999).
 * Caso de la milanesa (producción: «Tipo de Milanesa» ABSOLUTO Simple 20.000 / Napolitana 25.000 y «Milanesas de» VARIANTE sin costo): con el guardado en 0 HOY (sin marcarla base) la variante sin
 * costo se cae y el producto no se vende; marcada base, se vende, el «desde» es 20.000 y el cobro es Simple+Carne 20.000 y Napolitana+Pollo 25.000.
 *
 * Mutación: usar `entrada.precioBase` en lugar de la referencia cuando `esBase` → con el guardado en 0 la variante sin costo desaparece y este test da rojo.
 */

const monto = (m: number): DiferenciaDePrecio => ({ tipo: "MONTO", monto: m });

function opcion(opcionId: string, extra: Partial<OpcionParaVender> = {}): OpcionParaVender {
  return {
    opcionId,
    nombre: opcionId,
    orden: 0,
    activa: true,
    admitida: true,
    apagadaEnSucursal: false,
    cantidadMaxima: 3,
    versionVigenteId: `v-${opcionId}`,
    esNinguna: false,
    productoAnclaId: null,
    diferenciaDeLaVersion: monto(0),
    factorEscala: null,
    consumos: [],
    precioAbsoluto: null,
    diferenciaDelProducto: null,
    precioDeSucursal: null,
    ...extra,
  };
}

function grupo(grupoId: string, tipo: GrupoParaVender["tipo"], opciones: OpcionParaVender[], extra: Partial<GrupoParaVender> = {}): GrupoParaVender {
  return { grupoId, nombre: grupoId, tipo, activo: true, admitido: true, cantidadMinima: tipo === "MEDIDA" || tipo === "INCLUIDA" ? 1 : 0, cantidadMaxima: tipo === "ADICIONAL" ? 3 : 1, orden: 0, modoPrecio: tipo === "MEDIDA" ? "ABSOLUTO" : null, opciones, ...extra };
}

/** La milanesa de producción, como base: «Tipo de Milanesa» (precio final de cada una) y «Milanesas de» (variante obligatoria, sin costo). */
const milanesas = (): GrupoParaVender[] => [
  grupo("Tipo de Milanesa", "MEDIDA", [opcion("simple", { precioAbsoluto: 20000 }), opcion("napolitana", { precioAbsoluto: 25000 })]),
  grupo("Milanesas de", "VARIANTE", [opcion("carne"), opcion("pollo")], { cantidadMinima: 1 }),
];

const GUARDADOS = [0, 1, 18000, 999999] as const;

describe("C3: la base no depende de su precio guardado", () => {
  it("la milanesa con el guardado en 0: HOY (directo) no se vende; marcada base se vende, «desde» 20.000 y la variante sin costo se ofrece", () => {
    const hoy = resumenDePrecios({ grupos: milanesas(), precioBase: 0, descuentoDeProducto: null });
    expect(hoy, "caracterización: sin marcarla base, la variante sin costo se cae (0 + 0 < 0,01)").toMatchObject({ vendible: false, desde: null });
    expect(hoy.grupos.find((g) => g.tipo === "VARIANTE")!.opciones).toEqual([]);
    const base = resumenDePrecios({ grupos: milanesas(), precioBase: 0, descuentoDeProducto: null, esBase: true });
    expect(base).toMatchObject({ vendible: true, desde: 20000, hayVariacion: true });
    expect(base.grupos.find((g) => g.tipo === "VARIANTE")!.opciones.map((o) => [o.nombre, o.diferencia])).toEqual([["carne", 0], ["pollo", 0]]);
    expect(base.grupos.find((g) => g.tipo === "MEDIDA")!.opciones.map((o) => [o.nombre, o.precioFinal])).toEqual([["simple", 20000], ["napolitana", 25000]]);
    for (const [medida, variante, total] of [["simple", "carne", 20000], ["napolitana", "pollo", 25000]] as const) {
      const v = vistaPreviaDeConfiguracion({ grupos: milanesas(), elegidas: [{ opcionId: medida, cantidad: 1 }, { opcionId: variante, cantidad: 1 }], precioBase: 0, descuentoDeProducto: null, cantidad: 1 });
      expect(v, `${medida}+${variante}`).toMatchObject({ ok: true, precioUnitario: total, total });
    }
  });

  it("con el guardado igual a la opción más barata (producción: Milanesas 20.000), marcarla base no cambia NADA del resumen", () => {
    expect(resumenDePrecios({ grupos: milanesas(), precioBase: 20000, descuentoDeProducto: 10, esBase: true })).toEqual(resumenDePrecios({ grupos: milanesas(), precioBase: 20000, descuentoDeProducto: 10 }));
  });

  it("la referencia usa la grilla de la sucursal (como el cobro) y solo las opciones disponibles", () => {
    const grupos = milanesas();
    grupos[0] = { ...grupos[0]!, opciones: [opcion("simple", { precioAbsoluto: 20000, precioDeSucursal: 21000 }), opcion("napolitana", { precioAbsoluto: 25000 }), opcion("agotada", { precioAbsoluto: 100, apagadaEnSucursal: true })] };
    expect(resumenDePrecios({ grupos, precioBase: 0, descuentoDeProducto: null, esBase: true })).toMatchObject({ vendible: true, desde: 21000 });
  });

  it("una base SIN grupo de precio (archivado, quitado o sin opciones con precio) no se vende: falla cerrado, nunca cae al precio guardado", () => {
    const sinMedida = [milanesas()[1]!];
    expect(resumenDePrecios({ grupos: sinMedida, precioBase: 18000, descuentoDeProducto: null, esBase: true })).toMatchObject({ vendible: false, desde: null });
    const archivada = milanesas();
    archivada[0] = { ...archivada[0]!, activo: false };
    expect(resumenDePrecios({ grupos: archivada, precioBase: 18000, descuentoDeProducto: null, esBase: true })).toMatchObject({ vendible: false, desde: null });
    const sinPrecio = milanesas();
    sinPrecio[0] = { ...sinPrecio[0]!, opciones: sinPrecio[0]!.opciones.map((o) => ({ ...o, precioAbsoluto: null })) };
    expect(resumenDePrecios({ grupos: sinPrecio, precioBase: 18000, descuentoDeProducto: null, esBase: true })).toMatchObject({ vendible: false, desde: null });
    // Directo, el mismo producto sin grupos se sigue vendiendo a su precio (no cambia).
    expect(resumenDePrecios({ grupos: [], precioBase: 18000, descuentoDeProducto: null })).toMatchObject({ vendible: true, desde: 18000 });
  });

  it("PROPIEDAD: para una base (solo MONTO), resumen, vista previa y composición dan lo mismo con cualquier valor guardado", () => {
    const centavos = (min: number, max: number) => fc.integer({ min, max }).map((c) => c / 100);
    const arbMedida = fc.array(fc.record({ precio: centavos(1, 5_000_000), grilla: fc.option(centavos(1, 5_000_000), { nil: null }), agotada: fc.boolean() }), { minLength: 1, maxLength: 4 });
    const arbVariante = fc.record({
      obligatoria: fc.boolean(),
      opciones: fc.array(fc.record({ diferencia: fc.option(centavos(-50_000, 500_000), { nil: null }), delProducto: fc.option(centavos(0, 300_000), { nil: null }) }), { minLength: 1, maxLength: 3 }),
    });
    const arbConfig = fc.record({
      medida: arbMedida,
      variantes: fc.array(arbVariante, { maxLength: 2 }),
      conIncluida: fc.boolean(),
      adicional: fc.option(centavos(1, 200_000), { nil: null }),
      descuento: fc.option(fc.integer({ min: 1, max: 50 }), { nil: null }),
      eleccion: fc.array(fc.nat(), { minLength: 4, maxLength: 4 }),
    });
    fc.assert(
      fc.property(arbConfig, (c) => {
        const grupos: GrupoParaVender[] = [
          grupo("medida", "MEDIDA", c.medida.map((m, i) => opcion(`m${i}`, { precioAbsoluto: m.precio, precioDeSucursal: m.grilla, apagadaEnSucursal: m.agotada && i > 0 }))),
          ...c.variantes.map((v, j) =>
            grupo(`var${j}`, "VARIANTE", v.opciones.map((o, i) => opcion(`v${j}-${i}`, { diferenciaDeLaVersion: o.diferencia === null ? monto(0) : monto(o.diferencia), diferenciaDelProducto: o.delProducto === null ? null : monto(o.delProducto) })), { cantidadMinima: v.obligatoria ? 1 : 0 }),
          ),
          ...(c.conIncluida ? [grupo("incluida", "INCLUIDA", [opcion("papas"), opcion("pure")])] : []),
          ...(c.adicional === null ? [] : [grupo("adicional", "ADICIONAL", [opcion("huevo", { diferenciaDeLaVersion: monto(c.adicional), productoAnclaId: "ancla" })])]),
        ];
        // Una elección: la medida, una opción de cada variante obligatoria y la incluida.
        const elegidas = grupos.flatMap((g, k) => {
          if (g.tipo === "ADICIONAL" || g.cantidadMinima === 0) return [];
          const disponibles = g.opciones.filter((o) => !o.apagadaEnSucursal);
          return [{ opcionId: disponibles[c.eleccion[k % 4]! % disponibles.length]!.opcionId, cantidad: 1 }];
        });
        const resumenes = GUARDADOS.map((guardado) => resumenDePrecios({ grupos, precioBase: guardado, descuentoDeProducto: c.descuento, esBase: true }));
        const vistas = GUARDADOS.map((guardado) => vistaPreviaDeConfiguracion({ grupos, elegidas, precioBase: guardado, descuentoDeProducto: c.descuento, cantidad: 2 }));
        const composiciones = GUARDADOS.map((guardado) =>
          componerPrecioDeLinea({ precioBase: guardado, cantidad: 2, opciones: elegidas.map((e) => { const g = grupos.find((x) => x.opciones.some((o) => o.opcionId === e.opcionId))!; return opcionParaPrecio(g, g.opciones.find((o) => o.opcionId === e.opcionId)!, 1); }) }),
        );
        for (let i = 1; i < GUARDADOS.length; i++) {
          expect(resumenes[i], `resumen con guardado ${GUARDADOS[i]}`).toEqual(resumenes[0]);
          expect(vistas[i], `vista previa con guardado ${GUARDADOS[i]}`).toEqual(vistas[0]);
          expect(composiciones[i], `composición con guardado ${GUARDADOS[i]}`).toEqual(composiciones[0]);
        }
        // Y la referencia es exactamente la medida disponible más barata (con la grilla).
        const precios = c.medida.flatMap((m, i) => (m.agotada && i > 0 ? [] : [m.grilla ?? m.precio]));
        const r = resumenes[0]!;
        if (r.vendible) expect(r.grupos[0]!.opciones.map((o) => o.precioFinal).filter((p): p is number => p !== null).length).toBe(precios.length);
      }),
      { numRuns: 300 },
    );
  });
});
