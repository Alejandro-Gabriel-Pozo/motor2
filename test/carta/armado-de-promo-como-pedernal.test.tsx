import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARMADO_DE_PROMO_COMO_PEDERNAL, cantidadesDelFormulario, comoLoVeElCliente, esCantidadExacta, estadoDeLaPromo, loQueLlevaLaPromo, renglonDeLaLista, type ParteDeLaPromoParaLeer } from "../../src/core/carta/public";
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
  const nombres = (html: string) => [...html.matchAll(/name="((?:incluir|min|max|cantidad)_[^"]+)"/g)].map((m) => m[1]).sort();

  it("manda el mismo «incluir» de cada sección (también las plegadas) y, de la cantidad, o la exacta o mín./máx. (el rango heredado)", () => {
    const incluir = (html: string) => nombres(html).filter((n) => n.startsWith("incluir_"));
    expect(incluir(nuevo)).toEqual(incluir(viejo));
    expect(incluir(nuevo)).toHaveLength(3);
    // s1 es un rango heredado (0 a 2): mín. y máx.; s2 y s3 no tienen rango: una cantidad exacta.
    expect(nombres(nuevo).filter((n) => !n.startsWith("incluir_"))).toEqual(["cantidad_s2", "cantidad_s3", "max_s1", "min_s1"]);
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

describe("cantidad exacta (dueño 2026-11-17): se guarda como mín = máx = N", () => {
  const leerDe = (campos: Record<string, string>) => (campo: string) => (campo in campos ? campos[campo] : null);

  it("con el campo de cantidad, mín y máx son esa cantidad", () => {
    expect(cantidadesDelFormulario(leerDe({ cantidad_s1: "2" }), "cantidad_s1", "min_s1", "max_s1")).toEqual({ cantidadMinima: "2", cantidadMaxima: "2" });
  });
  it("sin el campo de cantidad (pantalla de siempre o parte heredada con rango), salen de mín. y máx. tal cual", () => {
    expect(cantidadesDelFormulario(leerDe({ min_s1: "0", max_s1: "2" }), "cantidad_s1", "min_s1", "max_s1")).toEqual({ cantidadMinima: "0", cantidadMaxima: "2" });
  });
  it("si no vino nada, texto vacío (lo rechaza el servidor, no se inventa un valor)", () => {
    expect(cantidadesDelFormulario(leerDe({}), "cantidad_s1", "min_s1", "max_s1")).toEqual({ cantidadMinima: "", cantidadMaxima: "" });
  });
  it.each([
    [1, 1, true],
    [2, 2, true],
    [0, 2, false],
    [1, 3, false],
  ])("esCantidadExacta(%i, %i) → %s", (min, max, esperado) => {
    expect(esCantidadExacta(min, max)).toBe(esperado);
  });
});

describe("«Qué lleva» con cantidad exacta", () => {
  const secciones = [
    { id: "s1", nombre: "Entrada", activa: true },
    { id: "s2", nombre: "Bebidas", activa: true },
    { id: "s3", nombre: "Postres", activa: true },
  ];
  const guardados = [
    { seccionCartaId: "s1", cantidadMinima: 0, cantidadMaxima: 2 },
    { seccionCartaId: "s2", cantidadMinima: 1, cantidadMaxima: 1 },
  ];
  const html = renderToStaticMarkup(<CamposQueLleva secciones={secciones} guardados={guardados} />);

  it("la parte que ya era exacta muestra UNA cantidad con su valor; el rango heredado se sigue mostrando con mín. y máx.", () => {
    expect(html).toContain('name="cantidad_s2"');
    expect(html).not.toContain('name="min_s2"');
    expect(html).toContain('name="min_s1"');
    expect(html).toContain('name="max_s1"');
    expect(html).not.toContain('name="cantidad_s1"');
  });

  it("un componente nuevo (plegado) nace con cantidad 1 y sin tildar", () => {
    const plegado = html.split("data-agregar-componente")[1];
    expect(plegado).toContain('name="cantidad_s3"');
    expect(plegado).not.toContain('checked=""');
  });
});

describe("lugares de lista: la cantidad exacta aparece solo con el interruptor encendido (los dos estados)", () => {
  const LUGARES = [
    { id: "l1", tipo: "LISTA" as const, nombre: "Bebida", cantidadMinima: 1, cantidadMaxima: 1, orden: 1, entradas: [] },
    { id: "l2", tipo: "LISTA" as const, nombre: "Postre", cantidadMinima: 0, cantidadMaxima: 2, orden: 2, entradas: [] },
  ];
  const dibujar = async (encendido: boolean) => {
    vi.resetModules();
    vi.doMock("../../src/core/carta/armado-de-promo-como-pedernal", async (original) => ({ ...(await original<typeof import("../../src/core/carta/armado-de-promo-como-pedernal")>()), ARMADO_DE_PROMO_COMO_PEDERNAL: encendido }));
    const { CamposLugares } = await import("../../src/app/(app)/carta/parametrizacion/formularios");
    return renderToStaticMarkup(<CamposLugares lugares={LUGARES} />);
  };
  afterEach(() => {
    vi.doUnmock("../../src/core/carta/armado-de-promo-como-pedernal");
    vi.resetModules();
  });

  it("ENCENDIDO: el lugar exacto muestra una cantidad, el de rango sigue con mín. y máx., y el lugar nuevo nace con una cantidad", async () => {
    const html = await dibujar(true);
    expect(html).toContain('name="lugar_cantidad_l1"');
    expect(html).not.toContain('name="lugar_min_l1"');
    expect(html).toContain('name="lugar_min_l2"');
    expect(html).toContain('name="lugar_max_l2"');
    expect(html).toContain('name="nuevo_lugar_cantidad"');
    expect(html).not.toContain('name="nuevo_lugar_min"');
  });

  it("APAGADO: la pantalla de siempre (mín. y máx. en todos, y en el lugar nuevo)", async () => {
    const html = await dibujar(false);
    expect(html).not.toContain("lugar_cantidad_");
    expect(html).toContain('name="lugar_min_l1"');
    expect(html).toContain('name="lugar_max_l1"');
    expect(html).toContain('name="nuevo_lugar_min"');
    expect(html).toContain('name="nuevo_lugar_max"');
    expect(html).not.toContain("nuevo_lugar_cantidad");
  });
});

describe("lugaresDelFormulario: manda la cantidad exacta como mín = máx, y respeta el rango heredado", () => {
  it("un lugar con cantidad exacta, uno heredado con rango y uno nuevo", async () => {
    const { lugaresDelFormulario } = await import("../../src/app/(app)/carta/parametrizacion/promociones/lugares-del-formulario");
    const fd = new FormData();
    for (const [k, v] of Object.entries({ lugar_id: "l1", lugar_incluir_l1: "on", lugar_nombre_l1: "Bebida", lugar_cantidad_l1: "2", nuevo_lugar_nombre: "Postre", nuevo_lugar_tipo: "LISTA", nuevo_lugar_cantidad: "1" })) fd.append(k, v);
    fd.append("lugar_id", "l2");
    for (const [k, v] of Object.entries({ lugar_incluir_l2: "on", lugar_nombre_l2: "Entrada", lugar_min_l2: "0", lugar_max_l2: "2" })) fd.append(k, v);
    expect(lugaresDelFormulario(fd)).toEqual([
      { tipo: "LISTA", nombre: "Bebida", cantidadMinima: "2", cantidadMaxima: "2" },
      { tipo: "LISTA", nombre: "Entrada", cantidadMinima: "0", cantidadMaxima: "2" },
      { tipo: "LISTA", nombre: "Postre", cantidadMinima: "1", cantidadMaxima: "1" },
    ]);
  });
});
