import { describe, expect, it } from "vitest";
import { detalleDelBloque, incluyeDeLaSeccion, textoDeIncluye, textoDeLasOpciones, textoDeVaCon, textoDelBloque, textoDelTitulo, vaConDelBloque, type AclaracionParaIncluye } from "../../src/core/carta/incluye-en-carta";

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
    expect(lineas([[G], [S], [G, S], [S, G]])).toEqual(["Incluye 1 guarnición", "Incluye 1 salsa", "Incluye 1 guarnición y 1 salsa", "Incluye 1 salsa y 1 guarnición"]);
  });

  it("tres grupos: comas y una «y» al final (siempre «y»: el número va delante de la palabra)", () => {
    const platos = [[eleccion("Guarnición", ["a", "b"]), eleccion("Salsa", ["a", "b"]), eleccion("Postre", ["a", "b"])]];
    expect(lineas(platos)).toEqual(["Incluye 1 guarnición, 1 salsa y 1 postre"]);
    expect(lineas([[eleccion("Salsa", ["a", "b"]), eleccion("Ingredientes", ["a", "b"])]])).toEqual(["Incluye 1 salsa y 1 ingredientes"]);
    expect(lineas([[eleccion("Salsa", ["a", "b"]), eleccion("Hielo", ["a", "b"])]])).toEqual(["Incluye 1 salsa y 1 hielo"]);
  });

  it("un plato con SOLO algunas de las opciones del bloque las nombra («puré o ensalada»); el que ofrece todas, no", () => {
    const todas = eleccion("Guarnición", ["puré", "ensalada", "papas fritas"]);
    const algunas = eleccion("Guarnición", ["puré", "ensalada"]);
    const r = incluyeDeLaSeccion([[todas], [algunas]]);
    expect(r.platos.map(textoDeIncluye)).toEqual(["Incluye 1 guarnición", "Incluye 1 guarnición: puré o ensalada"]);
    expect(r.bloques).toHaveLength(1);
    expect(textoDeLasOpciones(r.bloques[0]!)).toBe("puré · ensalada · papas fritas");
  });

  it("«u» delante de una opción que empieza con el sonido «o» al nombrar un subconjunto", () => {
    expect(lineas([[eleccion("Salsa", ["ajo", "oliva", "tomate"])], [eleccion("Salsa", ["ajo", "oliva"])]])).toEqual(["Incluye 1 salsa", "Incluye 1 salsa: ajo u oliva"]);
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
    expect(r.bloques[0]!.paraLosPlatos).toBe("Con los platos que incluyen guarnición");
  });

  it("«elegís N» sale de los límites: lo dice el título del bloque si todos los platos coinciden", () => {
    const r = incluyeDeLaSeccion([[eleccion("Guarnición", ["a", "b"], 1, 1)], [eleccion("Guarnición", ["a", "b"], 1, 1)]]);
    expect(textoDelTitulo(r.bloques[0]!)).toBe("Guarnición · elegís 1");
    expect(r.platos.map(textoDeIncluye)).toEqual(["Incluye 1 guarnición", "Incluye 1 guarnición"]);
    expect(textoDelTitulo(incluyeDeLaSeccion([[eleccion("Salsa", ["a", "b"], 2, 2)]]).bloques[0]!)).toBe("Salsa · elegís 2");
    expect(textoDelTitulo(incluyeDeLaSeccion([[eleccion("Salsa", ["a", "b"], 0, 2)]]).bloques[0]!)).toBe("Salsa · opcional, hasta 2");
    expect(textoDelTitulo(incluyeDeLaSeccion([[eleccion("Salsa", ["a", "b", "c"], 1, 3)]]).bloques[0]!)).toBe("Salsa · elegís de 1 a 3");
  });

  it("I17: si algún plato del bloque tiene límites distintos, el bloque NO dice N y CADA plato dice cuántas lleva (y con 2 o más, la palabra en plural)", () => {
    const r = incluyeDeLaSeccion([[eleccion("Guarnición", ["a", "b"], 1, 1)], [eleccion("Guarnición", ["a", "b"], 1, 2)], [eleccion("Salsa", ["x", "y"], 1, 1)]]);
    expect(r.bloques.map(textoDelTitulo)).toEqual(["Guarnición", "Salsa · elegís 1"]);
    expect(r.platos.map(textoDeIncluye)).toEqual(["Incluye 1 guarnición", "Incluye de 1 a 2 guarniciones", "Incluye 1 salsa"]);
  });

  it("un grupo sin opciones (o una lista vacía) no tiene línea ni bloque", () => {
    expect(incluyeDeLaSeccion([[eleccion("Guarnición", [])]])).toEqual({ platos: [[]], bloques: [] });
  });

  it("el texto de un bloque entero, para «Va a mostrar»", () => {
    const r = incluyeDeLaSeccion([[eleccion("Guarnición", ["puré", "ensalada"])]]);
    expect(textoDelBloque(r.bloques[0]!)).toBe("Guarnición · elegís 1: puré · ensalada. Con los platos que incluyen guarnición");
  });

  it("idempotente y sin efectos: llamarla dos veces con la misma entrada da lo mismo y no cambia la entrada", () => {
    const entrada = [[eleccion("Guarnición", ["puré", "ensalada"])], [eleccion("Guarnición", ["puré"], 1, 2)]];
    const copia = structuredClone(entrada);
    expect(incluyeDeLaSeccion(entrada)).toEqual(incluyeDeLaSeccion(entrada));
    expect(entrada).toEqual(copia);
  });

  describe("descripción de la opción (E3)", () => {
    const con = (...d: (string | null)[]) => eleccion("Guarnición", ["puré", "ensalada", "papas fritas"], 1, 1, d);

    it("el bloque lleva la descripción de cada opción, alineada con sus nombres; sin ninguna no hay detalle", () => {
      const b = incluyeDeLaSeccion([[con(null, "lechuga, tomate, cebolla", null)]]).bloques[0]!;
      expect(b.descripciones).toEqual([null, "lechuga, tomate, cebolla", null]);
      expect(detalleDelBloque(b)).toEqual([{ nombre: "ensalada", descripcion: "lechuga, tomate, cebolla" }]);
      expect(detalleDelBloque(incluyeDeLaSeccion([[con(null, null, null)]]).bloques[0]!)).toEqual([]);
    });

    it("la descripción es de la OPCIÓN: si dos platos traen la misma, vale la que no es null y el orden del bloque se mantiene", () => {
      const platos = [[eleccion("Guarnición", ["puré", "papas fritas"], 1, 1, [null, null])], [eleccion("Guarnición", ["puré", "ensalada", "papas fritas"], 1, 1, [null, "lechuga", "rústicas"])]];
      const b = incluyeDeLaSeccion(platos).bloques[0]!;
      expect(b.opciones).toEqual(["puré", "ensalada", "papas fritas"]);
      expect(b.descripciones).toEqual([null, "lechuga", "rústicas"]);
      expect(detalleDelBloque(b).map((d) => d.nombre)).toEqual(["ensalada", "papas fritas"]);
    });

    it("«Va a mostrar» las lleva al final del bloque; nunca en la línea del plato", () => {
      const r = incluyeDeLaSeccion([[con(null, "lechuga, tomate, cebolla", null)]]);
      expect(textoDelBloque(r.bloques[0]!)).toBe("Guarnición · elegís 1: puré · ensalada · papas fritas. Con los platos que incluyen guarnición. Ver detalle: ensalada: lechuga, tomate, cebolla");
      expect(textoDeIncluye(r.platos[0]!)).toBe("Incluye 1 guarnición");
    });
  });

  describe("invitación «5+2» (E2): qué platos marca y qué dice «Va con»", () => {
    const nombres = ["Bife a la criolla", "Bife con chimichurri", "Chivo del norte", "Estofado de chivo", "Pechuga grille"];
    const G = eleccion("Guarnición", ["puré", "ensalada", "papas fritas"]);
    const S = eleccion("Salsa", ["filetto", "crema"]);
    const platos = [[G, S], [G], [S], [], [eleccion("Guarnición", ["puré", "ensalada"])]];
    const r = incluyeDeLaSeccion(platos);
    const va = (grupo: string) => vaConDelBloque(r.bloques.find((b) => b.titulo === grupo)!, nombres.map((nombre, i) => ({ nombre, partes: r.platos[i]! })));

    it("marca exactamente los platos que incluyen el grupo (el que no lo incluye, nunca)", () => {
      expect(r.bloques.find((b) => b.titulo === "Guarnición")!.platos).toEqual([0, 1, 4]);
      expect(r.bloques.find((b) => b.titulo === "Salsa")!.platos).toEqual([0, 2]);
    });

    it("«Va con»: los platos del bloque en el orden de la sección, y el que admite un subconjunto lo dice", () => {
      expect(va("Guarnición")).toEqual(["Bife a la criolla", "Bife con chimichurri", "Pechuga grille (solo puré o ensalada)"]);
      expect(textoDeVaCon(va("Salsa"))).toBe("Va con: Bife a la criolla · Chivo del norte");
    });

    it("sin platos no hay «Va con»; una posición que no existe se ignora", () => {
      expect(textoDeVaCon([])).toBeNull();
      expect(vaConDelBloque({ ...r.bloques[0]!, platos: [9] }, [])).toEqual([]);
    });
  });
});

describe("cuántas lleva cada plato (2026-11-04, opción A confirmada por el dueño)", () => {
  const e = (rotulo: string, min: number, max: number) => eleccion(rotulo, ["a", "b", "c"], min, max);

  it("1, 2, «hasta N» (mínimo 0) y «de N a M»: el número y la palabra en singular o plural, según SUS límites", () => {
    expect(lineas([[e("Guarnición", 1, 1)], [e("Guarnición", 2, 2)], [e("Guarnición", 0, 2)], [e("Guarnición", 0, 1)], [e("Guarnición", 1, 3)]])).toEqual([
      "Incluye 1 guarnición",
      "Incluye 2 guarniciones",
      "Incluye hasta 2 guarniciones",
      "Incluye hasta 1 guarnición",
      "Incluye de 1 a 3 guarniciones",
    ]);
  });

  it("un plato con solo guarnición y otro con las dos: cada uno dice lo suyo; el título del bloque sigue como estaba", () => {
    const r = incluyeDeLaSeccion([[e("Guarnición", 1, 1), e("Salsa", 1, 1)], [e("Guarnición", 1, 1)]]);
    expect(r.platos.map(textoDeIncluye)).toEqual(["Incluye 1 guarnición y 1 salsa", "Incluye 1 guarnición"]);
    expect(r.bloques.map(textoDelTitulo)).toEqual(["Guarnición · elegís 1", "Salsa · elegís 1"]);
  });

  it("el plural del nombre del grupo: vocal + s, consonante + es, «ción» sin tilde, «z» → «ces», «de» al medio, ya plural queda igual", () => {
    const plural = (rotulo: string) => textoDeIncluye(incluyeDeLaSeccion([[e(rotulo, 2, 2)]]).platos[0]!);
    expect(plural("Salsa")).toBe("Incluye 2 salsas");
    expect(plural("Preparación")).toBe("Incluye 2 preparaciones");
    expect(plural("Sabor")).toBe("Incluye 2 sabores");
    expect(plural("Pez")).toBe("Incluye 2 peces");
    expect(plural("Tipo de leche")).toBe("Incluye 2 tipos de leche");
    expect(plural("Acompañamientos")).toBe("Incluye 2 acompañamientos");
  });
});
