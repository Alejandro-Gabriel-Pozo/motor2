import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ARMADO_DE_PROMO_COMO_PEDERNAL, comoLoVeElCliente, estadoDeLaPromo, loQueLlevaLaPromo, renglonDeLaLista, type ParteDeLaPromoParaLeer } from "../../src/core/carta/public";
import { textoDeLaParte } from "../../src/core/carta/armado-de-promo-como-pedernal";
import { CamposQueLleva } from "../../src/app/(app)/carta/parametrizacion/promociones/campos-que-lleva";
import { CamposCupos } from "../../src/app/(app)/carta/parametrizacion/formularios";

/**
 * Armado de promos «como Pedernal» (primer paso, solo pantalla; docs/diseno-promociones-igual-a-pedernal-2026-11-17.md). Fija:
 *  - el interruptor nace APAGADO (la pantalla de siempre; el valor por defecto lo decide el dueño viendo la captura);
 *  - las funciones puras que escriben lo que lleva la promo, su estado y «Cómo lo ve el cliente» (oráculo escrito acá, aparte del código);
 *  - que «Qué lleva» manda EXACTAMENTE los mismos campos que el formulario viejo (`incluir_/min_/max_`), con lo que no tilda nada que nadie tildó (todo nace cerrado).
 */
const ENTRADA: ParteDeLaPromoParaLeer = { nombre: "Entrada", cantidadMinima: 0, cantidadMaxima: 2, productoFijo: null };
const BEBIDA: ParteDeLaPromoParaLeer = { nombre: "Bebidas", cantidadMinima: 1, cantidadMaxima: 1, productoFijo: null };
const HAMBURGUESA: ParteDeLaPromoParaLeer = { nombre: "Plato", cantidadMinima: 2, cantidadMaxima: 2, productoFijo: "Hamburguesa Barbacoa" };

describe("interruptor", () => {
  it("nace apagado", () => {
    expect(ARMADO_DE_PROMO_COMO_PEDERNAL).toBe(false);
  });
});

describe("cómo se lee una parte (oráculo)", () => {
  it.each([
    [ENTRADA, "de 0 a 2 de Entrada"],
    [BEBIDA, "1 de Bebidas"],
    [HAMBURGUESA, "2 × Hamburguesa Barbacoa"],
    [{ ...HAMBURGUESA, cantidadMinima: 1 }, "de 1 a 2 de Plato"],
  ])("%j → %s", (parte, esperado) => {
    expect(textoDeLaParte(parte)).toBe(esperado);
  });

  it("la promo sin partes se dice informativa; con partes se unen con «+»", () => {
    expect(loQueLlevaLaPromo([])).toBe("Sin componentes todavía (solo informativa)");
    expect(loQueLlevaLaPromo([HAMBURGUESA, BEBIDA])).toBe("2 × Hamburguesa Barbacoa + 1 de Bebidas");
  });
});

describe("estado Activo / Pausado (todas las combinaciones)", () => {
  it.each([
    [true, true, true, "Activo"],
    [true, false, false, "Pausado en esta sucursal"],
    [false, true, false, "Pausado en toda la empresa"],
    [false, false, false, "Pausado en toda la empresa"],
  ])("empresa %s, sucursal %s → activo %s (%s)", (empresa, sucursal, activo, texto) => {
    expect(estadoDeLaPromo(empresa, sucursal)).toEqual({ activo, texto });
  });
});

describe("renglón de la lista y «Cómo lo ve el cliente»", () => {
  it("el renglón dice qué lleva, el estado y el precio", () => {
    const t = renglonDeLaLista("Menú ejecutivo", 55000, [ENTRADA], true, true);
    expect(t).toContain("Menú ejecutivo — de 0 a 2 de Entrada · Activo — ");
    expect(t).toContain("55.000,00");
  });
  it("«Cómo lo ve el cliente» lleva título, precio y componentes", () => {
    const t = comoLoVeElCliente("Combo Barbacoa", 13500, [HAMBURGUESA, BEBIDA]);
    expect(t).toMatch(/^Combo Barbacoa .*13\.500,00 — 2 × Hamburguesa Barbacoa \+ 1 de Bebidas$/);
  });
});

describe("«Qué lleva»: los mismos campos que el formulario viejo", () => {
  const secciones = [
    { id: "s1", nombre: "Entrada", activa: true },
    { id: "s2", nombre: "Postres", activa: true },
    { id: "s3", nombre: "Vinos", activa: false },
  ];
  const guardados = [{ seccionCartaId: "s1", cantidadMinima: 0, cantidadMaxima: 2 }];
  const nuevo = renderToStaticMarkup(<CamposQueLleva secciones={secciones} guardados={guardados} />);
  const viejo = renderToStaticMarkup(<CamposCupos secciones={secciones} guardados={guardados} />);
  const nombres = (html: string) => [...html.matchAll(/name="((?:incluir|min|max)_[^"]+)"/g)].map((m) => m[1]).sort();

  it("manda los mismos nombres de campo (también los de lo plegado)", () => {
    expect(nombres(nuevo)).toEqual(nombres(viejo));
    expect(nombres(nuevo)).toHaveLength(9);
  });

  it("lo que ya lleva va arriba, tildado y con su rango; el resto, plegado en «Agregar un componente» y sin tildar", () => {
    const [arriba, plegado] = nuevo.split("data-agregar-componente");
    expect(arriba).toContain("data-que-lleva");
    expect(arriba).toContain('data-cupo-seccion="Entrada"');
    expect(arriba).not.toContain('data-cupo-seccion="Postres"');
    expect(arriba).toMatch(/name="incluir_s1"[^>]*checked=""|checked=""[^>]*name="incluir_s1"/);
    expect(plegado).toContain("Agregar un componente");
    expect(plegado).toContain('data-cupo-seccion="Postres"');
    expect(plegado).toContain('data-cupo-seccion="Vinos"');
    expect(plegado).not.toContain('checked=""');
  });

  it("promo sin componentes: nada tildado y no se dibuja el bloque «Qué lleva»", () => {
    const vacio = renderToStaticMarkup(<CamposQueLleva secciones={secciones} guardados={[]} />);
    expect(vacio).not.toContain("data-que-lleva");
    expect(vacio).not.toContain('checked=""');
  });
});
