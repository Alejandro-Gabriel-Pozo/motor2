import { describe, expect, it } from "vitest";
import { armarFilasDeLaPromo, borradorCerrado, comandoDeLaFila, platosParaTildar, NOMBRE_DE_LA_PARTE_FUERA_DE_LA_CARTA, type LugarDeCombo, type ProductoParaEntrada } from "../../src/core/carta/public";

/**
 * E2b, lo puro: las filas de una promo (todo nace cerrado, el enganche por nombre de «Solo estos platos», «No está en la carta» y las «otras partes») y el comando que manda cada fila (el conjunto final de platos). Sin base ni pantalla.
 */
const SECCIONES = [
  { id: "s1", nombre: "Entradas", activa: true },
  { id: "s2", nombre: "Postres", activa: true },
];
const entrada = (id: string, productoId: string, activa = true) => ({ id, activa, productoId, nombre: `Plato ${productoId}`, modoDeOpciones: "FIJAS" as const, opciones: [{ opcionId: "o1", cantidad: 1 }] });
const lista = (id: string, nombre: string, entradas: LugarDeCombo["entradas"] = [], min = 1, max = 1): LugarDeCombo => ({ id, tipo: "LISTA", nombre, cantidadMinima: min, cantidadMaxima: max, orden: 0, entradas });
const plato = (productoId: string, over: Partial<ProductoParaEntrada> = {}): ProductoParaEntrada => ({ productoId, nombre: productoId, nombreParaMostrar: productoId, grupos: [], seccionCartaId: "s1", categoria: null, gruposAElegir: [], ...over });

describe("armarFilasDeLaPromo", () => {
  it("todo nace cerrado: sin nada guardado ninguna fila entra", () => {
    const f = armarFilasDeLaPromo({ secciones: SECCIONES, cuposDeSeccion: [], lugares: [] });
    expect(f.deSecciones.map((x) => x.modo)).toEqual(["NO_ENTRA", "NO_ENTRA"]);
    expect(f.fueraDeLaCarta).toMatchObject({ modo: "NO_ENTRA", nombre: NOMBRE_DE_LA_PARTE_FUERA_DE_LA_CARTA, origen: "FUERA" });
    expect(f.otras).toEqual([]);
  });

  it("un cupo de sección es «Toda la sección»; una lista con el nombre de la sección (sin importar mayúsculas) es «Solo estos platos»; los dados de baja no cuentan", () => {
    const f = armarFilasDeLaPromo({
      secciones: SECCIONES,
      cuposDeSeccion: [{ seccionCartaId: "s1", cantidadMinima: 1, cantidadMaxima: 2 }],
      lugares: [lista("l2", "postres", [entrada("e1", "p1"), entrada("e2", "p2", false)])],
    });
    expect(f.deSecciones[0]).toMatchObject({ modo: "TODA", cantidadMinima: 1, cantidadMaxima: 2, entradas: [] });
    expect(f.deSecciones[1]).toMatchObject({ modo: "SOLO_ESTOS", entradas: [expect.objectContaining({ id: "e1" })] });
    expect(f.deSecciones[1]!.entradas).toHaveLength(1);
  });

  it("una lista con el nombre de una sección que ya entra entera NO se esconde: sale entre las otras partes", () => {
    const f = armarFilasDeLaPromo({ secciones: SECCIONES, cuposDeSeccion: [{ seccionCartaId: "s1", cantidadMinima: 1, cantidadMaxima: 1 }], lugares: [lista("l1", "Entradas")] });
    expect(f.deSecciones[0]!.modo).toBe("TODA");
    expect(f.otras.map((x) => x.nombre)).toEqual(["Entradas"]);
  });

  it("«No está en la carta» engancha su lista; el resto de las listas (cargadas con «Sumar un lugar») son «otras partes» con origen «no está en la carta»", () => {
    const f = armarFilasDeLaPromo({ secciones: SECCIONES, cuposDeSeccion: [], lugares: [lista("l1", "No está en la carta", [entrada("e1", "p9")]), lista("l2", "Bebida", [], 0, 2)] });
    expect(f.fueraDeLaCarta).toMatchObject({ modo: "SOLO_ESTOS", entradas: [expect.objectContaining({ id: "e1" })] });
    expect(f.otras).toEqual([expect.objectContaining({ nombre: "Bebida", modo: "SOLO_ESTOS", cantidadMinima: 0, cantidadMaxima: 2, origen: "FUERA", lugar: { tipo: "LISTA", nombre: "Bebida" } })]);
  });

  it("una sección apagada se ve rotulada como apagada", () => {
    const f = armarFilasDeLaPromo({ secciones: [{ id: "s9", nombre: "Vinos", activa: false }], cuposDeSeccion: [], lugares: [] });
    expect(f.deSecciones[0]).toMatchObject({ apagada: true, modo: "NO_ENTRA" });
  });
});

describe("platosParaTildar y borradorCerrado", () => {
  it("los platos del origen que todavía no están en la lista", () => {
    const productos = [plato("p1"), plato("p2"), plato("p3", { seccionCartaId: "s2" }), plato("p4", { seccionCartaId: null })];
    expect(platosParaTildar({ origen: "s1", entradas: [entrada("e1", "p1")] }, productos).map((p) => p.productoId)).toEqual(["p2"]);
    expect(platosParaTildar({ origen: "FUERA", entradas: [] }, productos).map((p) => p.productoId)).toEqual(["p4"]);
  });

  it("todo nace cerrado: un plato con un grupo obligatorio abre en «el mozo elige» SIN ninguna opción tildada (hay que decidir); uno sin grupos, fijo y sin nada", () => {
    const conObligatorio = plato("p5", { gruposAElegir: [{ grupoId: "g1", nombre: "Tamaño", adicional: false, cantidadMinima: 1, cantidadMaxima: 1, opciones: [{ opcionId: "o1", nombre: "Chico" }, { opcionId: "o2", nombre: "Grande" }] }] });
    expect(borradorCerrado(conObligatorio)).toEqual({ modo: "A_ELEGIR", fijas: {}, permitidas: {} });
    expect(borradorCerrado(plato("p6"))).toEqual({ modo: "FIJAS", fijas: {}, permitidas: {} });
  });
});

describe("comandoDeLaFila", () => {
  const fila = { lugar: { tipo: "SECCION" as const, seccionCartaId: "s1" }, entradas: [entrada("e1", "p1"), entrada("e2", "p2")] };
  const base = { fila, cantidadMinima: "1", cantidadMaxima: "1", mantenidas: new Set<string>(), nuevos: [] };

  it("«no entra» no manda cantidades ni platos", () => {
    expect(comandoDeLaFila({ ...base, modo: "NO_ENTRA" })).toEqual({ ok: true, comando: { lugar: fila.lugar, modo: "NO_ENTRA" } });
  });

  it("«Toda la sección» manda solo la cantidad", () => {
    expect(comandoDeLaFila({ ...base, modo: "TODA", cantidadMinima: "2", cantidadMaxima: "2" })).toEqual({ ok: true, comando: { lugar: fila.lugar, modo: "TODA", cantidadMinima: "2", cantidadMaxima: "2" } });
  });

  it("«Solo estos platos» manda el conjunto FINAL: los que siguen tildados tal cual se guardaron más los nuevos con su configuración", () => {
    const nuevo = { producto: plato("p7"), borrador: borradorCerrado(plato("p7")) };
    const r = comandoDeLaFila({ ...base, modo: "SOLO_ESTOS", mantenidas: new Set(["e2"]), nuevos: [nuevo] });
    expect(r).toEqual({
      ok: true,
      comando: {
        lugar: fila.lugar,
        modo: "SOLO_ESTOS",
        cantidadMinima: "1",
        cantidadMaxima: "1",
        entradas: [
          { productoId: "p2", modoDeOpciones: "FIJAS", opciones: [{ opcionId: "o1", cantidad: 1 }] },
          { productoId: "p7", modoDeOpciones: "FIJAS", opciones: [] },
        ],
      },
    });
  });

  it("frena lo que el servidor rechazaría: sin ningún plato y con cantidad (I12b), un plato a medio configurar, una cantidad que no es un entero", () => {
    expect(comandoDeLaFila({ ...base, modo: "SOLO_ESTOS" })).toMatchObject({ ok: false });
    expect(comandoDeLaFila({ ...base, modo: "SOLO_ESTOS", cantidadMinima: "0", cantidadMaxima: "2" })).toMatchObject({ ok: true });
    const conObligatorio = plato("p5", { gruposAElegir: [{ grupoId: "g1", nombre: "Tamaño", adicional: false, cantidadMinima: 1, cantidadMaxima: 1, opciones: [{ opcionId: "o1", nombre: "Chico" }] }] });
    expect(comandoDeLaFila({ ...base, modo: "SOLO_ESTOS", nuevos: [{ producto: conObligatorio, borrador: borradorCerrado(conObligatorio) }] })).toMatchObject({ ok: false, motivo: expect.stringContaining("p5") });
    for (const mala of ["", "abc", "1,5", "-1", "1000"]) expect(comandoDeLaFila({ ...base, modo: "TODA", cantidadMinima: mala, cantidadMaxima: mala }), mala).toMatchObject({ ok: false });
    expect(comandoDeLaFila({ ...base, modo: "TODA", cantidadMinima: "3", cantidadMaxima: "2" })).toMatchObject({ ok: false });
  });
});
