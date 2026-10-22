import { describe, expect, it } from "vitest";
import {
  fraseDeLecturaDePrecio,
  formaDelGrupoPorRespuesta,
  leerPrecioDeOpcion,
  respuestaDelGrupo,
  validarGrupo,
  type ComoCambiaElPrecio,
  type FormaDelGrupo,
  type LecturaDePrecio,
} from "@/core/opciones/public";

/**
 * Fase 6, paso 6.9a: la lectura del precio de una opción. Con los casos de la demo (Pizzas, Milanesas y Café) y la tabla «respuesta ↔ forma del grupo». El total sale del compositor
 * (`componerPrecioDeLinea`): su equivalencia, en miles de valores, está en `lectura-de-precio.propiedades.test.ts`.
 */

/** El formateador de la prueba: el de la pantalla (`formatearMonto`, es-AR) vive en `core/pos`, que `core/opciones` no puede importar. */
const pesos = (n: number) => `$ ${n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const PRECIO_FINAL = formaDelGrupoPorRespuesta("PRECIO_FINAL");
const SUMA = formaDelGrupoPorRespuesta("SUMA");
const INCLUIDO = formaDelGrupoPorRespuesta("INCLUIDO");
const opcion = (nombre: string, esNinguna = false) => ({ nombre, esNinguna });
/** La frase de la prueba: siempre pasa por el tipo `LecturaDePrecio` de la fachada. */
const frase = (l: LecturaDePrecio) => fraseDeLecturaDePrecio(l, pesos);

describe("formaDelGrupoPorRespuesta y respuestaDelGrupo (la tabla de «¿Cambia el precio?»)", () => {
  const TABLA: readonly [ComoCambiaElPrecio, FormaDelGrupo][] = [
    ["INCLUIDO", { tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 1, modoPrecio: null }],
    ["SUMA", { tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1, modoPrecio: null }],
    ["PRECIO_FINAL", { tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, modoPrecio: "ABSOLUTO" }],
  ];

  it.each(TABLA)("%s ⇒ %j", (respuesta, forma) => {
    expect(formaDelGrupoPorRespuesta(respuesta)).toEqual(forma);
  });

  it.each(TABLA)("%s: la forma es un grupo válido y la respuesta vuelve a salir de ella", (respuesta, forma) => {
    expect(validarGrupo({ tipo: forma.tipo, cantidadMinima: forma.cantidadMinima, cantidadMaxima: forma.cantidadMaxima }).ok).toBe(true);
    expect(respuestaDelGrupo(forma.tipo, forma.modoPrecio)).toBe(respuesta);
  });

  it("lo que no es una de las tres respuestas devuelve null: el ADICIONAL y la MEDIDA que se cobra por diferencia", () => {
    expect(respuestaDelGrupo("ADICIONAL", null)).toBeNull();
    expect(respuestaDelGrupo("MEDIDA", "DIFERENCIA")).toBeNull();
    expect(respuestaDelGrupo("MEDIDA", null)).toBeNull();
  });
});

describe("leerPrecioDeOpcion: Pizzas (se vende por opción: los tamaños fijan el precio y los extras suman)", () => {
  it("el grupo «Tipos de Pizza» define el precio final: la lectura es el precio tecleado", () => {
    const l = leerPrecioDeOpcion({ forma: PRECIO_FINAL, opcion: opcion("Napolitana"), tecleado: 25000, precioBase: 0, referencia: null });
    expect(l).toEqual({ tipo: "precio-final", opcion: "Napolitana", total: 25000 });
    expect(frase(l)).toBe("Napolitana = $ 25.000");
  });

  it("un extra que suma se lee contra la opción más barata guardada del grupo que fija el precio", () => {
    const l = leerPrecioDeOpcion({ forma: SUMA, opcion: opcion("Trucha"), tecleado: 3000, precioBase: 0, referencia: { opcion: "Napolitana", precio: 25000 } });
    expect(l).toEqual({ tipo: "suma", opcion: "Trucha", referencia: { opcion: "Napolitana", precio: 25000 }, base: 25000, diferencia: 3000, total: 28000 });
    expect(frase(l)).toBe("Napolitana con Trucha = $ 25.000 + $ 3.000 = $ 28.000");
  });

  it("sin el importe del precio final dice qué falta", () => {
    const l = leerPrecioDeOpcion({ forma: PRECIO_FINAL, opcion: opcion("Napolitana"), tecleado: null, precioBase: 0, referencia: null });
    expect(l).toEqual({ tipo: "falta", opcion: "Napolitana" });
    expect(frase(l)).toBe("Falta el precio final de «Napolitana»");
  });

  it.each([0, -5])("un precio final de %s no se acepta: lo dice el compositor", (tecleado) => {
    const l = leerPrecioDeOpcion({ forma: PRECIO_FINAL, opcion: opcion("Napolitana"), tecleado, precioBase: 0, referencia: null });
    expect(l.tipo).toBe("invalido");
    if (l.tipo === "invalido") expect(l.mensaje).toContain("«Napolitana»");
  });
});

describe("leerPrecioDeOpcion: Milanesas (producto directo: la suma parte de su precio)", () => {
  it("sin referencia, la base es el precio de lista del producto", () => {
    const l = leerPrecioDeOpcion({ forma: SUMA, opcion: opcion("Huevo"), tecleado: 1200, precioBase: 8500, referencia: null });
    expect(l).toEqual({ tipo: "suma", opcion: "Huevo", referencia: null, base: 8500, diferencia: 1200, total: 9700 });
    expect(frase(l)).toBe("Con Huevo = $ 8.500 + $ 1.200 = $ 9.700");
  });

  it("los centavos no se pierden: 8.500,10 + 1.200,20 = 9.700,30", () => {
    const l = leerPrecioDeOpcion({ forma: SUMA, opcion: opcion("Huevo"), tecleado: 1200.2, precioBase: 8500.1, referencia: null });
    expect(l).toMatchObject({ tipo: "suma", base: 8500.1, diferencia: 1200.2, total: 9700.3 });
  });

  it("un importe vacío suma 0: el total es la base", () => {
    const l = leerPrecioDeOpcion({ forma: SUMA, opcion: opcion("Simple"), tecleado: null, precioBase: 8500, referencia: null });
    expect(l).toMatchObject({ tipo: "suma", diferencia: 0, total: 8500 });
  });

  it("la opción «ninguna» no suma nada aunque tenga un importe tecleado", () => {
    const l = leerPrecioDeOpcion({ forma: SUMA, opcion: opcion("Ninguna", true), tecleado: 999, precioBase: 8500, referencia: null });
    expect(l).toMatchObject({ tipo: "suma", diferencia: 0, total: 8500 });
  });

  it("un producto sin precio y sin nada que sumar no tiene un precio válido: lo dice el compositor", () => {
    const l = leerPrecioDeOpcion({ forma: SUMA, opcion: opcion("Huevo"), tecleado: 0, precioBase: 0, referencia: null });
    expect(l.tipo).toBe("invalido");
  });
});

describe("leerPrecioDeOpcion: Café (una opción incluida no cambia el precio)", () => {
  it("INCLUIDA: no cambia, lo que se tecleó no se mira", () => {
    for (const tecleado of [null, 500, "invalido" as const]) {
      const l = leerPrecioDeOpcion({ forma: INCLUIDO, opcion: opcion("Leche entera"), tecleado, precioBase: 3200, referencia: null });
      expect(l).toEqual({ tipo: "no-cambia" });
    }
    expect(frase({ tipo: "no-cambia" })).toBe("Este grupo no cambia el precio");
  });

  it("los tamaños del café fijan el precio final: Doble = $ 4.100", () => {
    const l = leerPrecioDeOpcion({ forma: PRECIO_FINAL, opcion: opcion("Doble"), tecleado: 4100, precioBase: 3200, referencia: null });
    expect(l).toEqual({ tipo: "precio-final", opcion: "Doble", total: 4100 });
  });
});

describe("leerPrecioDeOpcion: lo que no se entiende o todavía no se lee", () => {
  it("un importe que no se entendió es inválido en un grupo que suma y en uno que fija el precio", () => {
    for (const forma of [SUMA, PRECIO_FINAL]) {
      const l = leerPrecioDeOpcion({ forma, opcion: opcion("Trucha"), tecleado: "invalido", precioBase: 100, referencia: null });
      expect(l).toEqual({ tipo: "invalido", mensaje: "Revisá el importe de «Trucha»: no se entendió." });
      expect(frase(l)).toBe("Revisá el importe de «Trucha»: no se entendió.");
    }
  });

  it("«ninguna» en un grupo que fija el precio final es inválida", () => {
    const l = leerPrecioDeOpcion({ forma: PRECIO_FINAL, opcion: opcion("Ninguna", true), tecleado: 100, precioBase: 0, referencia: null });
    expect(l.tipo).toBe("invalido");
  });

  it("«Se cobra aparte» (ADICIONAL) todavía no tiene lectura", () => {
    const adicional: FormaDelGrupo = { tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 3, modoPrecio: null };
    expect(leerPrecioDeOpcion({ forma: adicional, opcion: opcion("Extra"), tecleado: 500, precioBase: 100, referencia: null }).tipo).toBe("invalido");
  });

  it("una MEDIDA que se cobra por diferencia se lee como una suma sobre el precio base", () => {
    const porDiferencia: FormaDelGrupo = { tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, modoPrecio: "DIFERENCIA" };
    const l = leerPrecioDeOpcion({ forma: porDiferencia, opcion: opcion("Grande"), tecleado: 700, precioBase: 3200, referencia: null });
    expect(l).toMatchObject({ tipo: "suma", base: 3200, diferencia: 700, total: 3900 });
  });

  it("una MEDIDA sin modo de precio es inválida", () => {
    const sinModo: FormaDelGrupo = { tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, modoPrecio: null };
    expect(leerPrecioDeOpcion({ forma: sinModo, opcion: opcion("Grande"), tecleado: 700, precioBase: 3200, referencia: null }).tipo).toBe("invalido");
  });
});
