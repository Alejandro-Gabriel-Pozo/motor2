import { describe, expect, it } from "vitest";
import { leerCantidadTecleada, unidadesDeLectura, type UnidadDeLectura } from "@/core/catalogo/public";

// Sin base de datos: la lectura es pura. El catálogo es el que se siembra en toda empresa (src/core/features/empresa/siembra-de-empresa.ts).
const CATALOGO = [
  { id: "kg", nombre: "kg", magnitud: "PESO" },
  { id: "g", nombre: "g", magnitud: "PESO" },
  { id: "l", nombre: "l", magnitud: "VOLUMEN" },
  { id: "ml", nombre: "ml", magnitud: "VOLUMEN" },
  { id: "unidad", nombre: "unidad", magnitud: "CANTIDAD" },
];
const UNIDADES = unidadesDeLectura(CATALOGO);
const KG = UNIDADES.kg;
const LITRO = UNIDADES.l;

function leer(texto: string, unidad: UnidadDeLectura | null = KG) {
  return leerCantidadTecleada(texto, unidad);
}

function valor(texto: string, unidad: UnidadDeLectura | null = KG) {
  const r = leer(texto, unidad);
  if (r.tipo !== "valor") throw new Error(`esperaba un valor para ${JSON.stringify(texto)}, vino ${r.tipo}`);
  return r;
}

describe("unidadesDeLectura — solo convierte entre unidades que existen en el catálogo", () => {
  it("kg pasa a g y l pasa a ml (los pares que siembra el sistema)", () => {
    expect(UNIDADES.kg).toEqual({ nombre: "kg", menor: { nombre: "g", factor: 1000 } });
    expect(UNIDADES.l).toEqual({ nombre: "l", menor: { nombre: "ml", factor: 1000 } });
  });

  it("las unidades menores y las que no tienen par se muestran tal cual", () => {
    expect(UNIDADES.g).toEqual({ nombre: "g", menor: null });
    expect(UNIDADES.ml).toEqual({ nombre: "ml", menor: null });
    expect(UNIDADES.unidad).toEqual({ nombre: "unidad", menor: null });
  });

  it("sin la unidad menor en el catálogo (desactivada o nunca creada), no inventa la conversión", () => {
    const sinGramos = unidadesDeLectura(CATALOGO.filter((u) => u.id !== "g"));
    expect(sinGramos.kg).toEqual({ nombre: "kg", menor: null });
  });

  it("exige la misma magnitud: una «g» que no es de PESO no cuenta", () => {
    const raro = unidadesDeLectura([
      { id: "kg", nombre: "kg", magnitud: "PESO" },
      { id: "g", nombre: "g", magnitud: "CANTIDAD" },
    ]);
    expect(raro.kg.menor).toBeNull();
  });

  it("reconoce mayúsculas y espacios, y muestra el nombre como está en el catálogo", () => {
    const enMayuscula = unidadesDeLectura([
      { id: "L", nombre: "L", magnitud: "VOLUMEN" },
      { id: "mL", nombre: " mL", magnitud: "VOLUMEN" },
    ]);
    expect(enMayuscula.L).toEqual({ nombre: "L", menor: { nombre: " mL", factor: 1000 } });
  });

  it("un «kg» de otra magnitud no se convierte", () => {
    expect(unidadesDeLectura([{ id: "x", nombre: "kg", magnitud: "CANTIDAD" }, ...CATALOGO.slice(1)]).x.menor).toBeNull();
  });
});

describe("leerCantidadTecleada — lo que entendió el sistema", () => {
  it.each([
    ["3", "= 3 kg"],
    ["0,30", "= 300 g"],
    ["0.30", "= 300 g"],
    ["0,3", "= 300 g"],
    ["0,07", "= 70 g"], // sin el ruido de 0.07 * 1000 en binario
    ["0,125", "= 125 g"],
    [",5", "= 500 g"],
    ["1,5", "= 1,5 kg"],
    ["1", "= 1 kg"],
    ["12", "= 12 kg"],
    ["1.000.000", "= 1000000 kg"], // miles bien agrupados: sin separador de miles en la lectura
    ["1.234,56", "= 1234,56 kg"],
    ["1,234.56", "= 1234,56 kg"],
    ["0", "= 0 kg"],
    ["-3", "= -3 kg"],
    ["-0,5", "= -0,5 kg"], // un negativo no se pasa a la unidad menor (lo rechaza el servidor igual)
  ])("%j en kg → %j", (texto, esperado) => {
    expect(valor(texto).lectura).toBe(esperado);
  });

  it("litros: 0,5 → 500 ml; 2 → 2 l", () => {
    expect(valor("0,5", LITRO).lectura).toBe("= 500 ml");
    expect(valor("2", LITRO).lectura).toBe("= 2 l");
  });

  it("una unidad sin menor se muestra tal cual, también por debajo de 1", () => {
    expect(valor("3", UNIDADES.unidad).lectura).toBe("= 3 unidad");
    expect(valor("0,5", UNIDADES.g).lectura).toBe("= 0,5 g");
  });

  it("sin unidad conocida (todavía no se eligió la materia prima), solo el número", () => {
    expect(valor("0,30", null).lectura).toBe("= 0,3");
  });

  it("devuelve el valor que interpretó `interpretarNumero`, sin reinterpretarlo", () => {
    expect(valor("3.000").valor).toBe(3);
    expect(valor("1.500").valor).toBe(1.5);
    expect(valor("12.345").valor).toBe(12.345);
    expect(valor("1.000.000").valor).toBe(1_000_000);
    expect(valor("0,300").valor).toBe(0.3);
    expect(valor("0.300").valor).toBe(0.3);
    expect(valor("3,000").valor).toBe(3);
  });

  it("vacío o solo espacios → vacío (no es 0)", () => {
    expect(leer("")).toEqual({ tipo: "vacio" });
    expect(leer("   ")).toEqual({ tipo: "vacio" });
  });

  it.each(["abc", "1e3", "5-3", "1,2,3", "1.23,4", "$100", "1 000"])("%j no es un número → inválido, con el mensaje del parser", (texto) => {
    expect(leer(texto)).toEqual({ tipo: "invalido", mensaje: "No es un número válido." });
  });
});

describe("leerCantidadTecleada — advertencia cuando coma o punto pueden confundir", () => {
  it("«3.000» se lee 3 kg y avisa cómo escribir tres mil", () => {
    expect(valor("3.000")).toEqual({
      tipo: "valor",
      valor: 3,
      lectura: "= 3 kg",
      advertencia: "Se leyó como 3 kg. Si quisiste decir 3000 kg, escribilo sin punto: 3000.",
    });
  });

  it("con coma dice «sin coma»", () => {
    expect(valor("1,500").advertencia).toBe("Se leyó como 1,5 kg. Si quisiste decir 1500 kg, escribilo sin coma: 1500.");
    expect(valor("3,000").advertencia).toBe("Se leyó como 3 kg. Si quisiste decir 3000 kg, escribilo sin coma: 3000.");
  });

  it("la advertencia usa la lectura convertida («0.300» → 300 g)", () => {
    expect(valor("0.300")).toMatchObject({ lectura: "= 300 g", advertencia: "Se leyó como 300 g. Si quisiste decir 300 kg, escribilo sin punto: 300." });
  });

  it("«12.345» (dos dígitos antes) y un negativo también avisan", () => {
    expect(valor("12.345").advertencia).toBe("Se leyó como 12,345 kg. Si quisiste decir 12345 kg, escribilo sin punto: 12345.");
    expect(valor("-1.500").advertencia).toBe("Se leyó como -1,5 kg. Si quisiste decir -1500 kg, escribilo sin punto: -1500.");
  });

  it("sin unidad conocida, la advertencia no inventa una", () => {
    expect(valor("3.000", null).advertencia).toBe("Se leyó como 3. Si quisiste decir 3000, escribilo sin punto: 3000.");
  });

  it("recorta espacios igual que el parser", () => {
    expect(valor("  3.000  ").advertencia).not.toBeNull();
  });

  it.each([
    "3", // sin separador
    "3000",
    "0,30", // dos decimales: no puede ser miles
    "1,5",
    "1.5",
    "0,3",
    "1,2345", // cuatro decimales
    "1.000.000", // miles bien agrupados: no es falsa alarma
    "1,000,000",
    "1.234,56", // los dos separadores
    "1.234.567,5",
    "1234.567", // cuatro dígitos antes: no puede ser un grupo de miles
    ",500", // sin dígitos antes: claramente decimal
    "0",
    "0.000", // se lee 0 de las dos maneras: no hay nada que aclarar
  ])("%j no avisa", (texto) => {
    expect(valor(texto).advertencia).toBeNull();
  });
});
