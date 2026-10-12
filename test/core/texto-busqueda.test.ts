import { describe, expect, it } from "vitest";
import { escaparComodinesLike, quitarCaracteresInadmisibles, texto, textoDeBusqueda } from "../../src/core/texto";
import { unicosDeUrl } from "../../src/core/datos/parametros-de-url";

/**
 * Postgres no guarda ni compara un NUL (`\u0000`, error 22021), y un sustituto UTF-16 suelto no es texto válido (Prisma lo rechaza al serializar la consulta): ambos llegaban a una
 * búsqueda y daban 500. `textoDeBusqueda` es EL lugar donde se sacan; `unicosDeUrl` lo aplica a todo parámetro de URL. Lo que se guarda (`texto()`) no se toca.
 */
describe("quitarCaracteresInadmisibles", () => {
  it("quita el NUL, en cualquier posición", () => {
    expect(quitarCaracteresInadmisibles("\u0000")).toBe("");
    expect(quitarCaracteresInadmisibles("nul\u0000byte")).toBe("nulbyte");
    expect(quitarCaracteresInadmisibles("\u0000\u0000a\u0000")).toBe("a");
  });

  it("quita los sustitutos sueltos (alto sin bajo, bajo sin alto, dos altos seguidos) y deja los pares completos", () => {
    expect(quitarCaracteresInadmisibles("ñandú\uD83D")).toBe("ñandú"); // alto al final
    expect(quitarCaracteresInadmisibles("a\uDE00b")).toBe("ab"); // bajo suelto
    expect(quitarCaracteresInadmisibles("\uD83D😀")).toBe("😀"); // el primer alto sobra, el par queda
    expect(quitarCaracteresInadmisibles("\uDE00\uDE00")).toBe("");
    expect(quitarCaracteresInadmisibles("😀\uDE00")).toBe("😀"); // par + bajo suelto
    expect(quitarCaracteresInadmisibles("😀 café 🍰")).toBe("😀 café 🍰");
  });

  it("no altera el texto normal: acentos, ñ, ü, símbolos, CJK, saltos de línea, espacios y los caracteres de control que Postgres sí acepta", () => {
    for (const t of ["Ñandú café", "pingüino", "Harina 000 (1 kg) & Cía.", "日本語", "línea1\nlínea2\t", "  espacios  ", "‮override", "a'b\"c\\d%_"]) {
      expect(quitarCaracteresInadmisibles(t)).toBe(t);
    }
    expect(quitarCaracteresInadmisibles("")).toBe("");
  });

  it("aguanta un texto enorme", () => {
    const enorme = `${"a".repeat(1_000_000)}\u0000${"b".repeat(10)}\uD83D`;
    expect(quitarCaracteresInadmisibles(enorme)).toBe(`${"a".repeat(1_000_000)}${"b".repeat(10)}`);
  });
});

describe("textoDeBusqueda", () => {
  it("es `texto()` sin los caracteres inadmisibles: recorta los blancos DESPUÉS de sacarlos", () => {
    expect(textoDeBusqueda("  harina \u0000 ")).toBe("harina");
    expect(textoDeBusqueda("\u0000 \uD83D")).toBe("");
    expect(textoDeBusqueda("ñandú\uD83D")).toBe("ñandú");
  });

  it("acepta lo que acepta `texto()`: undefined, null, números y objetos se vuelven texto", () => {
    expect(textoDeBusqueda(undefined)).toBe("");
    expect(textoDeBusqueda(null)).toBe("");
    expect(textoDeBusqueda(7)).toBe("7");
    expect(textoDeBusqueda(" x ")).toBe(texto(" x "));
  });

  it("`texto()` (lo que se GUARDA) no cambia: conserva el NUL, para que una validación lo vea y lo rechace", () => {
    expect(texto("a\u0000b")).toBe("a\u0000b");
  });
});

describe("escaparComodinesLike", () => {
  it("escapa la barra invertida, el % y el _ (la barra primero, sin duplicar lo que agrega)", () => {
    expect(escaparComodinesLike("%")).toBe("\\%");
    expect(escaparComodinesLike("_")).toBe("\\_");
    expect(escaparComodinesLike("\\")).toBe("\\\\");
    expect(escaparComodinesLike("100% de a_b\\c")).toBe("100\\% de a\\_b\\\\c");
    expect(escaparComodinesLike("\\%")).toBe("\\\\\\%");
  });

  it("no toca el resto: letras, acentos, espacios, comillas, signos", () => {
    for (const t of ["Ñandú café", "Harina 000 (1 kg) & Cía.", "' OR '1'='1", "a-b.c,d/e", ""]) expect(escaparComodinesLike(t)).toBe(t);
  });
});

describe("unicosDeUrl", () => {
  it("saca los caracteres inadmisibles de cada parámetro (q, ids, cursores) y conserva el resto", () => {
    expect(unicosDeUrl({ q: "ñand\u0000ú", cursor: "abc\uD83D", id: "x" })).toEqual({ q: "ñandú", cursor: "abc", id: "x" });
  });

  it("con un arreglo se queda con el primer valor, ya limpio; sin valor, no hay clave", () => {
    expect(unicosDeUrl({ q: ["a\u0000b", "otro"], vacio: undefined })).toEqual({ q: "ab" });
  });

  it("un valor vacío o solo de inadmisibles queda como texto vacío (la página lo trata como «sin filtro», igual que antes con un valor vacío)", () => {
    expect(unicosDeUrl({ q: "\u0000" })).toEqual({ q: "" });
    expect(unicosDeUrl({ q: "" })).toEqual({ q: "" });
  });
});
