import { describe, expect, it } from "vitest";
import type { ProductoParaEntrada } from "@/core/carta/public";
import { ORIGEN_FUERA_DE_LA_CARTA, borradorInicial, categoriasDe, comandoDeProducto, origenInferido, productosDelOrigen, tieneOpciones } from "@/core/carta/public";

/** El bife real de la promo: una base configurable con Proteína (obligatoria, de 1), Preparación (obligatoria) y Guarniciones (de 1 a 2), más un adicional. */
const bife: ProductoParaEntrada = {
  productoId: "bife",
  nombre: "BIFE-",
  grupos: [],
  seccionCartaId: "sec-principales",
  categoria: { id: "cat-carnes", nombre: "Carnes" },
  gruposAElegir: [
    { grupoId: "g-prot", nombre: "Proteína", adicional: false, cantidadMinima: 1, cantidadMaxima: 1, opciones: [{ opcionId: "nalga", nombre: "Nalga" }, { opcionId: "chorizo", nombre: "Bife de chorizo" }] },
    { grupoId: "g-prep", nombre: "Preparación", adicional: false, cantidadMinima: 1, cantidadMaxima: 1, opciones: [{ opcionId: "criolla", nombre: "Bife a la criolla" }, { opcionId: "chimi", nombre: "Bife con chimichurri" }] },
    { grupoId: "g-guar", nombre: "Guarniciones", adicional: false, cantidadMinima: 1, cantidadMaxima: 2, opciones: [{ opcionId: "pure", nombre: "Puré de papa" }, { opcionId: "ensalada", nombre: "Ensalada" }, { opcionId: "fritas", nombre: "Papas fritas" }] },
    { grupoId: "g-extra", nombre: "Extras", adicional: true, cantidadMinima: 0, cantidadMaxima: 2, opciones: [{ opcionId: "huevo", nombre: "Huevo frito" }] },
  ],
};
const agua: ProductoParaEntrada = { productoId: "agua", nombre: "Agua", grupos: [], seccionCartaId: null, categoria: { id: "cat-bebidas", nombre: "Bebidas" }, gruposAElegir: [] };
const cafe: ProductoParaEntrada = {
  productoId: "cafe",
  nombre: "Café",
  grupos: [{ grupoId: "g-tam", nombre: "Tamaño", obligatorio: true, opciones: [{ opcionId: "chico", nombre: "Chico" }, { opcionId: "grande", nombre: "Grande" }] }],
  seccionCartaId: "sec-bebidas",
  categoria: { id: "cat-bebidas", nombre: "Bebidas" },
  gruposAElegir: [{ grupoId: "g-tam", nombre: "Tamaño", adicional: false, cantidadMinima: 1, cantidadMaxima: 1, opciones: [{ opcionId: "chico", nombre: "Chico" }, { opcionId: "grande", nombre: "Grande" }] }],
};
const todos = [bife, agua, cafe];

describe("armar el lugar de una promo: origen y productos", () => {
  it("los productos de un origen son solo los de esa sección o los que no están en la carta; sin origen, ninguno", () => {
    expect(productosDelOrigen(todos, "sec-principales").map((p) => p.productoId)).toEqual(["bife"]);
    expect(productosDelOrigen(todos, ORIGEN_FUERA_DE_LA_CARTA).map((p) => p.productoId)).toEqual(["agua"]);
    expect(productosDelOrigen(todos, "")).toEqual([]);
    expect(productosDelOrigen(todos, "sec-que-no-existe")).toEqual([]);
  });

  it("un lugar con opciones abre en su origen solo si TODAS vienen del mismo; si no, queda sin elegir", () => {
    expect(origenInferido(["bife"], todos)).toBe("sec-principales");
    expect(origenInferido(["agua"], todos)).toBe(ORIGEN_FUERA_DE_LA_CARTA);
    expect(origenInferido(["bife", "agua"], todos)).toBe("");
    expect(origenInferido([], todos)).toBe("");
    expect(origenInferido(["desconocido"], todos)).toBe("");
  });

  it("el atajo de categorías cuenta los productos con categoría y los ordena por nombre", () => {
    expect(categoriasDe(todos)).toEqual([
      { id: "cat-bebidas", nombre: "Bebidas", cantidad: 2 },
      { id: "cat-carnes", nombre: "Carnes", cantidad: 1 },
    ]);
    expect(categoriasDe([{ ...agua, categoria: null }])).toEqual([]);
  });
});

describe("armar el lugar de una promo: qué se define de cada producto tildado", () => {
  it("un producto con grupo obligatorio abre en «el mozo elige» con todo tildado salvo el adicional; sin grupos obligatorios, fijo", () => {
    const b = borradorInicial(bife);
    expect(b.modo).toBe("A_ELEGIR");
    expect(Object.keys(b.permitidas).sort()).toEqual(["chimi", "chorizo", "criolla", "ensalada", "fritas", "nalga", "pure"]);
    expect(b.permitidas["huevo"]).toBeUndefined();
    expect(borradorInicial(agua).modo).toBe("FIJAS");
    expect(tieneOpciones(agua)).toBe(false);
    expect(tieneOpciones(bife)).toBe(true);
  });

  it("«el mozo elige»: manda las opciones tildadas con el tope de la base y nunca un adicional", () => {
    const b = borradorInicial(bife);
    b.permitidas["huevo"] = true;
    const c = comandoDeProducto(bife, b);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.modoDeOpciones).toBe("A_ELEGIR");
    expect(c.opciones.map((o) => o.opcionId).sort()).toEqual(["chimi", "chorizo", "criolla", "ensalada", "fritas", "nalga", "pure"]);
    expect(c.opciones.every((o) => o.cantidad === 10)).toBe(true);
  });

  it("«el mozo elige» no se puede mandar sin ninguna opción ni dejando un grupo obligatorio sin ninguna", () => {
    const vacio = { ...borradorInicial(bife), permitidas: {} };
    expect(comandoDeProducto(bife, vacio)).toEqual({ ok: false, motivo: "Tildá al menos una opción que pueda elegir el mozo." });
    const sinGuarnicion = { ...borradorInicial(bife) };
    sinGuarnicion.permitidas = { ...sinGuarnicion.permitidas, pure: false, ensalada: false, fritas: false };
    const c = comandoDeProducto(bife, sinGuarnicion);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.motivo).toContain("Guarniciones");
  });

  it("fijo: una opción por grupo; un grupo obligatorio sin elegir lo frena; sin grupos va sin opciones", () => {
    expect(comandoDeProducto(agua, borradorInicial(agua))).toEqual({ ok: true, modoDeOpciones: "FIJAS", opciones: [] });
    const sinElegir = comandoDeProducto(cafe, { modo: "FIJAS", fijas: {}, permitidas: {} });
    expect(sinElegir).toEqual({ ok: false, motivo: "Falta elegir: Tamaño." });
    expect(comandoDeProducto(cafe, { modo: "FIJAS", fijas: { "g-tam": "grande" }, permitidas: {} })).toEqual({ ok: true, modoDeOpciones: "FIJAS", opciones: [{ opcionId: "grande", cantidad: 1 }] });
  });
});
