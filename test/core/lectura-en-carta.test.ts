import { describe, expect, it } from "vitest";
import { LARGO_MAXIMO_DEL_PREFIJO_EN_CARTA, leerOpcionEnCarta, ordenarPorRol, primeraEnMinuscula, rolDelGrupo, unirConO, type GrupoParaRol } from "../../src/core/opciones/public";

/** Fase 4 de la ola «precio y carta» (ADR-035, DEC-34): cómo lee la carta una opción con «se lee en la carta como». */
describe("leerOpcionEnCarta", () => {
  const op = (nombre: string, esNinguna = false) => ({ nombre, esNinguna });

  it("con prefijo: prefijo + la opción con la primera letra en minúscula", () => {
    expect(leerOpcionEnCarta("De", op("Carne"))).toBe("De carne");
    expect(leerOpcionEnCarta("De", op("Pollo"))).toBe("De pollo");
    expect(leerOpcionEnCarta("Con", op("Salsa de tomate"))).toBe("Con salsa de tomate");
  });

  it("la primera letra Unicode con es-AR (tildes, eñe), sin excepción para siglas ni nombres propios", () => {
    expect(leerOpcionEnCarta("De", op("Ñandú"))).toBe("De ñandú");
    expect(leerOpcionEnCarta("De", op("Ángus"))).toBe("De ángus");
    expect(leerOpcionEnCarta("Con", op("BBQ"))).toBe("Con bBQ");
    expect(leerOpcionEnCarta("De", op("Angus"))).toBe("De angus");
    expect(leerOpcionEnCarta("Con", op("3 quesos"))).toBe("Con 3 quesos");
    expect(leerOpcionEnCarta("Con", op("🥑 palta"))).toBe("Con 🥑 palta");
  });

  it("sin prefijo (null o vacío), la opción tal cual; la «ninguna», siempre tal cual", () => {
    expect(leerOpcionEnCarta(null, op("Pizza muzzarella"))).toBe("Pizza muzzarella");
    expect(leerOpcionEnCarta("", op("Pizza muzzarella"))).toBe("Pizza muzzarella");
    expect(leerOpcionEnCarta("Con", op("Sin nada", true))).toBe("Sin nada");
  });

  it("el tope es el del CHECK de la base: 20", () => {
    expect(LARGO_MAXIMO_DEL_PREFIJO_EN_CARTA).toBe(20);
  });
});

/** Fase 5 («carta pareja»): el papel de cada grupo, el orden en que se leen y se eligen (carta y POS) y los textos de las aclaraciones. */
describe("rolDelGrupo, ordenarPorRol y los textos de las aclaraciones", () => {
  type G = GrupoParaRol & { nombre: string };
  const sinCosto = (n: number) => Array.from({ length: n }, () => ({ esNinguna: false, precioFinal: null, diferencia: 0 }));
  const grupo = (nombre: string, g: Partial<GrupoParaRol>): G => ({ nombre, tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1, prefijoEnCarta: null, opciones: sinCosto(2), ...g });
  const tamanos = (...precios: number[]) => precios.map((p) => ({ esNinguna: false, precioFinal: p, diferencia: 0 }));

  it("un tamaño con precios finales distintos define el precio; con todos iguales, es una aclaración", () => {
    expect(rolDelGrupo(grupo("Tamaño", { tipo: "MEDIDA", opciones: tamanos(4000, 4100, 4300) }))).toBe("define-el-precio");
    expect(rolDelGrupo(grupo("Vaso", { tipo: "MEDIDA", opciones: tamanos(2000, 2000) }))).toBe("aclaracion");
  });

  it("DEC-10: una variante obligatoria de una sola elección va en filas si tiene prefijo o si alguna opción cambia el precio; sin costo y sin prefijo, aclaración", () => {
    expect(rolDelGrupo(grupo("Milanesas de", { prefijoEnCarta: "De" }))).toBe("filas");
    expect(rolDelGrupo(grupo("Terminación", { opciones: [{ esNinguna: false, precioFinal: null, diferencia: 0 }, { esNinguna: false, precioFinal: null, diferencia: 5000 }] }))).toBe("filas");
    expect(rolDelGrupo(grupo("Milanesas de", {}))).toBe("aclaracion");
    expect(rolDelGrupo(grupo("Milanesas de", { prefijoEnCarta: "" }))).toBe("aclaracion");
    // Opcional o de varias: nunca es un eje (se puede no elegir): con costo va a la línea de extras.
    expect(rolDelGrupo(grupo("Preparación", { cantidadMinima: 0, prefijoEnCarta: "De", opciones: [{ esNinguna: false, precioFinal: null, diferencia: 200 }] }))).toBe("adicional");
    expect(rolDelGrupo(grupo("Preparación", { cantidadMinima: 0, prefijoEnCarta: "De" }))).toBe("aclaracion");
  });

  it("una incluida es aclaración y un adicional, adicional (aunque no sume nada)", () => {
    expect(rolDelGrupo(grupo("Guarnición", { tipo: "INCLUIDA" }))).toBe("aclaracion");
    expect(rolDelGrupo(grupo("Extras", { tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 3 }))).toBe("adicional");
  });

  it("primero el grupo que define el precio aunque el producto lo tenga después de uno obligatorio; dentro de cada papel, los obligatorios primero y el orden del producto", () => {
    const guarnicion = grupo("Guarnición", { tipo: "INCLUIDA" });
    const tamano = grupo("Tamaño", { tipo: "MEDIDA", opciones: tamanos(1000, 2000) });
    const extras = grupo("Extras", { tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 3, opciones: [{ esNinguna: false, precioFinal: null, diferencia: 600 }] });
    const nota = grupo("Nota", { cantidadMinima: 0 });
    const punto = grupo("Punto", {});
    const de = grupo("Rellenas de", { prefijoEnCarta: "De" });
    const orden = ordenarPorRol([guarnicion, extras, nota, tamano, punto, de], rolDelGrupo).map((g) => g.nombre);
    expect(orden).toEqual(["Tamaño", "Rellenas de", "Guarnición", "Punto", "Nota", "Extras"]);
  });

  it("la primera letra en minúscula (es-AR, sin excepción para siglas) y la lista unida con «o», con «u» delante del sonido «o»", () => {
    expect(primeraEnMinuscula("Papas fritas")).toBe("papas fritas");
    expect(primeraEnMinuscula("Ñoquis")).toBe("ñoquis");
    expect(primeraEnMinuscula("BBQ")).toBe("bBQ");
    expect(unirConO([])).toBe("");
    expect(unirConO(["solo"])).toBe("solo");
    expect(unirConO(["ensalada", "papas fritas", "puré"])).toBe("ensalada, papas fritas o puré");
    expect(unirConO(["carne", "hongos"])).toBe("carne u hongos");
    expect(unirConO(["pollo", "orégano"])).toBe("pollo u orégano");
    expect(unirConO(["papas", "huevo"])).toBe("papas o huevo");
  });
});
