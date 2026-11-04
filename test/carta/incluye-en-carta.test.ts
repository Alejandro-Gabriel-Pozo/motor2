import { describe, expect, it } from "vitest";
import { incluyeDeLaSeccion, textoDeIncluye, textoDeLasOpciones, textoDelBloque, textoDelTitulo, type AclaracionParaIncluye } from "../../src/core/carta/incluye-en-carta";

/**
 * Carta «B» (2026-11-04): la función PURA que dice qué incluye cada plato y arma el bloque del pie de la sección. Acá, los casos de borde de la lógica sola; las COMBINACIONES de dimensiones contra el
 * oráculo escrito a mano están en `incluye-en-carta.oraculo.test.tsx`, y el dibujo en `carta-publica-formas.test.tsx`.
 */

const eleccion = (rotulo: string, opciones: string[], minimo = 1, maximo = 1, descripciones: (string | null)[] = opciones.map(() => null)): AclaracionParaIncluye => ({ tipo: "eleccion", rotulo, opciones, descripciones, cantidadMinima: minimo, cantidadMaxima: maximo });
const extras = (rotulo: string): AclaracionParaIncluye => ({ tipo: "extras", rotulo, opciones: [{ nombre: "queso", recargo: 1000 }] });
const lineas = (platos: readonly (readonly AclaracionParaIncluye[])[]) => incluyeDeLaSeccion(platos).platos.map(textoDeIncluye);

describe("incluyeDeLaSeccion", () => {
  it("una sección sin platos o sin elecciones libres no dice nada ni arma bloques", () => {
    expect(incluyeDeLaSeccion([])).toEqual({ platos: [], bloques: [] });
    expect(incluyeDeLaSeccion([[], [extras("Extras")]])).toEqual({ platos: [[], []], bloques: [] });
  });

  it("los extras (grupos con precio) no pasan por acá: ni línea ni bloque", () => {
    expect(lineas([[extras("Extras")]])).toEqual([null]);
  });

  it("«Incluye guarnición», «Incluye salsa» e «Incluye guarnición y salsa», en el orden del producto", () => {
    const G = eleccion("Guarnición", ["puré", "ensalada"]);
    const S = eleccion("Salsa", ["filetto", "crema"]);
    expect(lineas([[G], [S], [G, S], [S, G]])).toEqual(["Incluye guarnición", "Incluye salsa", "Incluye guarnición y salsa", "Incluye salsa y guarnición"]);
  });

  it("tres grupos: comas y una «y» al final; «e» delante de un sonido «i»", () => {
    const platos = [[eleccion("Guarnición", ["a", "b"]), eleccion("Salsa", ["a", "b"]), eleccion("Postre", ["a", "b"])]];
    expect(lineas(platos)).toEqual(["Incluye guarnición, salsa y postre"]);
    expect(lineas([[eleccion("Salsa", ["a", "b"]), eleccion("Ingredientes", ["a", "b"])]])).toEqual(["Incluye salsa e ingredientes"]);
    expect(lineas([[eleccion("Salsa", ["a", "b"]), eleccion("Hielo", ["a", "b"])]])).toEqual(["Incluye salsa y hielo"]);
  });

  it("un plato con SOLO algunas de las opciones del bloque las nombra («puré o ensalada»); el que ofrece todas, no", () => {
    const todas = eleccion("Guarnición", ["puré", "ensalada", "papas fritas"]);
    const algunas = eleccion("Guarnición", ["puré", "ensalada"]);
    const r = incluyeDeLaSeccion([[todas], [algunas]]);
    expect(r.platos.map(textoDeIncluye)).toEqual(["Incluye guarnición", "Incluye guarnición: puré o ensalada"]);
    expect(r.bloques).toHaveLength(1);
    expect(textoDeLasOpciones(r.bloques[0]!)).toBe("puré · ensalada · papas fritas");
  });

  it("«u» delante de una opción que empieza con el sonido «o» al nombrar un subconjunto", () => {
    expect(lineas([[eleccion("Salsa", ["ajo", "oliva", "tomate"])], [eleccion("Salsa", ["ajo", "oliva"])]])).toEqual(["Incluye salsa", "Incluye salsa: ajo u oliva"]);
  });

  it("el bloque lista la UNIÓN de las opciones de los platos que incluyen el grupo, sin repetir y en el orden del grupo", () => {
    const platos = [[eleccion("Guarnición", ["puré", "papas fritas"])], [eleccion("Guarnición", ["puré", "ensalada", "papas fritas"])], [eleccion("Guarnición", ["ensalada", "papas fritas", "arroz"])]];
    expect(textoDeLasOpciones(incluyeDeLaSeccion(platos).bloques[0]!)).toBe("puré · ensalada · papas fritas · arroz");
  });

  it("un bloque por grupo, en el orden en que aparecen; el mismo grupo en dos secciones da un bloque en cada una", () => {
    const G = eleccion("Guarnición", ["puré", "ensalada"]);
    const S = eleccion("Salsa", ["filetto", "crema"]);
    expect(incluyeDeLaSeccion([[S], [G, S]]).bloques.map((b) => b.titulo)).toEqual(["Salsa", "Guarnición"]);
    // Cada sección se arma por separado (la función recibe los platos de UNA sección): el mismo grupo en otra sección da su propio bloque, con sus propias opciones.
    const otra = incluyeDeLaSeccion([[eleccion("Guarnición", ["arroz", "ensalada"])]]);
    expect(incluyeDeLaSeccion([[G]]).bloques.map(textoDeLasOpciones)).toEqual(["puré · ensalada"]);
    expect(otra.bloques.map(textoDeLasOpciones)).toEqual(["arroz · ensalada"]);
  });

  it("a qué platos va el bloque: la posición de cada plato que lo incluye (lo que marcará la invitación de E2)", () => {
    const G = eleccion("Guarnición", ["puré", "ensalada"]);
    const r = incluyeDeLaSeccion([[G], [], [G], [extras("Extras")]]);
    expect(r.bloques[0]!.platos).toEqual([0, 2]);
    expect(r.bloques[0]!.paraLosPlatos).toBe("Con los platos que dicen «Incluye guarnición»");
  });

  it("«elegís N» sale de los límites: lo dice el título del bloque si todos los platos coinciden", () => {
    const r = incluyeDeLaSeccion([[eleccion("Guarnición", ["a", "b"], 1, 1)], [eleccion("Guarnición", ["a", "b"], 1, 1)]]);
    expect(textoDelTitulo(r.bloques[0]!)).toBe("Guarnición · elegís 1");
    expect(r.platos.map(textoDeIncluye)).toEqual(["Incluye guarnición", "Incluye guarnición"]);
    expect(textoDelTitulo(incluyeDeLaSeccion([[eleccion("Salsa", ["a", "b"], 2, 2)]]).bloques[0]!)).toBe("Salsa · elegís 2");
    expect(textoDelTitulo(incluyeDeLaSeccion([[eleccion("Salsa", ["a", "b"], 0, 2)]]).bloques[0]!)).toBe("Salsa · opcional, hasta 2");
    expect(textoDelTitulo(incluyeDeLaSeccion([[eleccion("Salsa", ["a", "b", "c"], 1, 3)]]).bloques[0]!)).toBe("Salsa · elegís de 1 a 3");
  });

  it("I17: si algún plato del bloque tiene límites distintos, el bloque NO dice N y CADA plato del bloque lo aclara", () => {
    const r = incluyeDeLaSeccion([[eleccion("Guarnición", ["a", "b"], 1, 1)], [eleccion("Guarnición", ["a", "b"], 1, 2)], [eleccion("Salsa", ["x", "y"], 1, 1)]]);
    expect(r.bloques.map(textoDelTitulo)).toEqual(["Guarnición", "Salsa · elegís 1"]);
    expect(r.platos.map(textoDeIncluye)).toEqual(["Incluye guarnición (elegís 1)", "Incluye guarnición (elegís de 1 a 2)", "Incluye salsa"]);
  });

  it("un grupo sin opciones (o una lista vacía) no tiene línea ni bloque", () => {
    expect(incluyeDeLaSeccion([[eleccion("Guarnición", [])]])).toEqual({ platos: [[]], bloques: [] });
  });

  it("el texto de un bloque entero, para «Va a mostrar»", () => {
    const r = incluyeDeLaSeccion([[eleccion("Guarnición", ["puré", "ensalada"])]]);
    expect(textoDelBloque(r.bloques[0]!)).toBe("Guarnición · elegís 1: puré · ensalada. Con los platos que dicen «Incluye guarnición»");
  });

  it("idempotente y sin efectos: llamarla dos veces con la misma entrada da lo mismo y no cambia la entrada", () => {
    const entrada = [[eleccion("Guarnición", ["puré", "ensalada"])], [eleccion("Guarnición", ["puré"], 1, 2)]];
    const copia = structuredClone(entrada);
    expect(incluyeDeLaSeccion(entrada)).toEqual(incluyeDeLaSeccion(entrada));
    expect(entrada).toEqual(copia);
  });
});
