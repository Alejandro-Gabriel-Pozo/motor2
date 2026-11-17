import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARMADO_DE_PROMO_COMO_PEDERNAL, armarFilasDeLaPromo, cantidadesDelFormulario, componentesDeLaFicha, filasParaAgregar, comoLoVeElCliente, esCantidadExacta, estadoDeLaPromo, loQueLlevaLaPromo, renglonDeLaLista, type LugarDeCombo, type ParteDeLaPromoParaLeer } from "../../src/core/carta/public";
import { textoDeLaParte } from "../../src/core/carta/armado-de-promo-como-pedernal";

/**
 * Armado de promos «como Pedernal» (primer paso, solo pantalla; docs/diseno-promociones-igual-a-pedernal-2026-11-17.md). Fija:
 *  - el interruptor nace APAGADO (la pantalla de siempre; el valor por defecto lo decide el dueño viendo la captura);
 *  - las funciones puras que escriben lo que lleva la promo, su estado y «Cómo lo ve el cliente» (oráculo escrito acá, aparte del código);
 *  - que «Qué lleva» dibuja una tarjeta por componente con `ComponentesDelCombo` (sustituye a `PartesDeLaPromo` y a `CamposQueLleva`), sin tildar nada que nadie tildó (todo nace cerrado).
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
    [BEBIDA, "1 de Bebidas a elección"],
    [HAMBURGUESA, "2 × Hamburguesa Barbacoa"],
    [{ ...HAMBURGUESA, cantidadMinima: 1 }, "de 1 a 2 de Plato"],
  ])("%j → %s", (parte, esperado) => {
    expect(textoDeLaParte(parte)).toBe(esperado);
  });

  it("la promo sin partes se dice informativa; con partes se unen con «+»", () => {
    expect(loQueLlevaLaPromo([])).toBe("Sin componentes todavía (solo informativa)");
    expect(loQueLlevaLaPromo([HAMBURGUESA, BEBIDA])).toBe("2 × Hamburguesa Barbacoa + 1 de Bebidas a elección");
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
    expect(t).toMatch(/^Combo Barbacoa .*13\.500,00 — 2 × Hamburguesa Barbacoa \+ 1 de Bebidas a elección$/);
  });
});

/** «Qué lleva» de la ficha (E2b + maqueta): una tarjeta por componente con «Quitar»; lo que todavía no entra se ofrece en «Agregar componente»; nada viene tildado ni elegido (todo nace cerrado). */
const SECCIONES = [
  { id: "s1", nombre: "Entrada", activa: true },
  { id: "s2", nombre: "Bebidas", activa: true },
  { id: "s3", nombre: "Postres", activa: true },
  { id: "s4", nombre: "Vinos", activa: false },
];
const PRODUCTOS = [
  { productoId: "p1", nombre: "Bife", nombreParaMostrar: "Bife", grupos: [], seccionCartaId: "s1", categoria: null, gruposAElegir: [] },
  { productoId: "p2", nombre: "Gaseosa", nombreParaMostrar: "Gaseosa", grupos: [], seccionCartaId: "s2", categoria: null, gruposAElegir: [] },
];
const entrada = (id: string, productoId: string, nombre: string) => ({ id, activa: true, productoId, nombre, modoDeOpciones: "FIJAS" as const, opciones: [] });
const armar = (cuposDeSeccion: { seccionCartaId: string; cantidadMinima: number; cantidadMaxima: number }[], lugares: LugarDeCombo[] = []) => armarFilasDeLaPromo({ secciones: SECCIONES, cuposDeSeccion, lugares });
/** Se dibuja con el interruptor ENCENDIDO (los componentes toman sus textos de `textosDeLaPantallaDePromos`). */
const dibujarQueLleva = async (cuposDeSeccion: { seccionCartaId: string; cantidadMinima: number; cantidadMaxima: number }[], lugares: LugarDeCombo[] = [], sinGuardar = false) => {
  vi.resetModules();
  vi.doMock("../../src/core/carta/armado-de-promo-como-pedernal", async (original) => ({ ...(await original<typeof import("../../src/core/carta/armado-de-promo-como-pedernal")>()), ARMADO_DE_PROMO_COMO_PEDERNAL: true }));
  const { ComponentesDelCombo } = await import("../../src/app/(app)/carta/parametrizacion/promociones/componentes-del-combo");
  const filas = armar(cuposDeSeccion, lugares);
  return renderToStaticMarkup(
    <ComponentesDelCombo componentes={componentesDeLaFicha(filas, PRODUCTOS)} paraAgregar={filasParaAgregar(filas)} productos={PRODUCTOS} puedeEditar sinGuardar={sinGuardar} guardar={async () => ({ ok: true, mensaje: "" })} />
  );
};
afterEach(() => {
  vi.doUnmock("../../src/core/carta/armado-de-promo-como-pedernal");
  vi.resetModules();
});

describe("«Qué lleva»: una tarjeta por componente, todo nace cerrado", () => {
  it("combo sin componentes: «Todavía no lleva nada», sin tarjetas ni nada tildado, y «Agregar componente» disponible", async () => {
    const html = await dibujarQueLleva([]);
    expect(html).toContain("Todavía no lleva nada");
    expect(html).not.toContain("data-componente-del-combo");
    expect(html).not.toContain('checked=""');
    expect(html).toMatch(/<button[^>]*data-agregar-componente[^>]*>Agregar componente<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*data-agregar-componente/);
  });

  it("combo sin guardar: el botón «Agregar componente» está apagado", async () => {
    expect(await dibujarQueLleva([], [], true)).toMatch(/<button[^>]*disabled=""[^>]*data-agregar-componente|<button[^>]*data-agregar-componente[^>]*disabled=""/);
  });

  it("lo que ya lleva sale como tarjeta con su tipo y «Quitar»; lo que no, no sale", async () => {
    const html = await dibujarQueLleva([
      { seccionCartaId: "s1", cantidadMinima: 0, cantidadMaxima: 2 },
      { seccionCartaId: "s2", cantidadMinima: 1, cantidadMaxima: 1 },
    ]);
    expect(html).toContain('data-componente-del-combo="de 0 a 2 de Entrada"');
    expect(html).toContain('data-componente-del-combo="1 de Bebidas a elección"');
    expect(html).not.toContain("Postres");
    expect(html).toContain("A elegir en una sección de la carta");
    expect(html).toContain("Lo que el cliente puede elegir: Gaseosa");
    expect(html.match(/>Quitar</g)).toHaveLength(2);
  });

  it("una lista con el nombre de una sección es su «Solo estos platos»; con UN plato fijo y cantidad exacta es «Un producto fijo»", async () => {
    const lugares: LugarDeCombo[] = [
      { id: "l1", tipo: "LISTA", nombre: "Entrada", cantidadMinima: 2, cantidadMaxima: 2, orden: 1, entradas: [entrada("e1", "p1", "Bife")] },
      { id: "l2", tipo: "LISTA", nombre: "Bebida", cantidadMinima: 1, cantidadMaxima: 1, orden: 2, entradas: [entrada("e2", "p2", "Gaseosa"), entrada("e3", "p3", "Jugo")] },
    ];
    const comp = componentesDeLaFicha(armar([], lugares), PRODUCTOS);
    expect(comp.map((c) => [c.nombre, c.tipo, c.elegibles])).toEqual([
      ["2 × Bife", "fijo", []],
      ["1 de Bebida a elección", "seccion", ["Gaseosa", "Jugo"]],
    ]);
    const html = await dibujarQueLleva([], lugares);
    expect(html).toContain("Un producto fijo");
  });

  it("para agregar se ofrecen las secciones que no entran y «No está en la carta»", () => {
    const filas = armar([{ seccionCartaId: "s1", cantidadMinima: 1, cantidadMaxima: 1 }]);
    expect(filasParaAgregar(filas).map((f) => f.nombre)).toEqual(["Bebidas", "Postres", "Vinos", "No está en la carta"]);
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

  it("ENCENDIDO: el lugar exacto muestra una cantidad, el de rango sigue con mín. y máx., y «Sumar un lugar» se retira (E2b: cada sección elige «Solo estos platos» en su fila)", async () => {
    const html = await dibujar(true);
    expect(html).toContain('name="lugar_cantidad_l1"');
    expect(html).not.toContain('name="lugar_min_l1"');
    expect(html).toContain('name="lugar_min_l2"');
    expect(html).toContain('name="lugar_max_l2"');
    expect(html).not.toContain("Sumar un lugar");
    expect(html).not.toContain("nuevo_lugar_");
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
