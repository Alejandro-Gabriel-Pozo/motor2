import { describe, expect, it } from "vitest";
import { contarProhibidosEnCodigo, esPatronDeProhibicion } from "./cerco-lista-de-permitidos-apoyo";

/**
 * Violaciones inyectadas de `cerco-lista-de-permitidos.test.ts`: cada forma de validar por lista de prohibidos tiene su caso. Si se debilita
 * el analizador (`cerco-lista-de-permitidos-apoyo.ts`), el caso correspondiente deja de contar y esta prueba se pone roja. Y lo permitido
 * (la lista de lo que SÍ vale, reemplazar o separar) no cuenta.
 */

const cuenta = (texto: string) => contarProhibidosEnCodigo("x.ts", texto);

describe("lista de permitidos: cada forma de prohibir se cuenta", () => {
  it.each([
    ["controles por categoría", "export const ok = (t: string) => !/\\p{Cc}/u.test(t);"],
    [
      "invisibles por categoría",
      "export const ok = (t: string) => !/[\\p{C}\\p{Zl}\\p{Zp}]/u.test(t);",
    ],
    [
      "controles por rango hexadecimal",
      "export const ok = (t: string) => !/[\\x00-\\x1f]/.test(t);",
    ],
    [
      "controles por rango unicode",
      "export const ok = (t: string) => !/[\\u0000-\\u001f\\u007f]/.test(t);",
    ],
    ["marcado en una clase", "export const ok = (t: string) => !/[<>]/.test(t);"],
    ["clase negada con espacio", "export const ok = (t: string) => /^[^\\s]+$/.test(t);"],
    ["clase negada con arroba", "export const ok = (t: string) => /^[^@]+$/.test(t);"],
    ["clase negada con comillas", 'export const ok = (t: string) => /^[^"]+$/.test(t);'],
    [
      "guardada en una constante",
      "const MALO = /\\p{Cc}/u;\nexport const ok = (t: string) => !MALO.test(t);",
    ],
    ["constante exportada sin uso local", "export const MALO = /\\p{Cc}/u;"],
    ["con búsqueda", "export const ok = (t: string) => t.search(/\\p{Cc}/u) < 0;"],
    ["con coincidencia", "export const ok = (t: string) => t.match(/\\p{Cc}/u) === null;"],
    [
      "constructor con cadena",
      'export const ok = (t: string) => !new RegExp("\\\\p{Cc}", "u").test(t);',
    ],
    [
      "constructor con plantilla",
      "export const ok = (t: string) => !new RegExp(`[\\\\p{C}${'x'}]`, 'u').test(t);",
    ],
    [
      "constructor con cadena sumada",
      'export const ok = (t: string) => !new RegExp("[<" + ">]").test(t);',
    ],
    [
      "constante usada para validar y para reemplazar",
      "const R = /\\p{Cc}/gu;\nexport const a = (t: string) => R.test(t);\nexport const b = (t: string) => t.replace(R, '');",
    ],
  ])("%s", (_, texto) => {
    expect(cuenta(texto)).toBe(1);
  });

  it("cuenta cada una por separado", () => {
    expect(cuenta("export const a = /\\p{Cc}/u;\nexport const b = /[<>]/;")).toBe(2);
  });
});

describe("lista de permitidos: lo que declara lo permitido no se cuenta", () => {
  it.each([
    ["la lista de permitidos", "export const ok = (t: string) => /^[A-Za-z0-9 ]{1,40}$/.test(t);"],
    [
      "una clase negada solo de letras y dígitos (el reverso de una lista de permitidos)",
      "export const ok = (t: string) => !/[^a-z0-9]/.test(t);",
    ],
    ["reemplazar", "export const f = (t: string) => t.replace(/\\p{Cc}/gu, '');"],
    ["reemplazar todo", "export const f = (t: string) => t.replaceAll(/[<>]/g, '');"],
    ["separar", "export const f = (t: string) => t.split(/[<>]/);"],
    [
      "una constante que solo reemplaza",
      "const R = /[<>]/g;\nexport const f = (t: string) => t.replace(R, '');",
    ],
    [
      "un constructor armado con constantes",
      "const PERMITIDOS = 'a-z';\nexport const R = new RegExp(`^[${PERMITIDOS}]+$`);",
    ],
    [
      "espacios Unicode normalizados",
      "export const f = (t: string) => t.replace(/\\p{Zs}+/gu, ' ');",
    ],
    ["un texto sin expresiones regulares", "export const x = 'hola';"],
  ])("%s", (_, texto) => {
    expect(cuenta(texto)).toBe(0);
  });

  it("el patrón de prohibición se decide solo por lo que describe", () => {
    expect(esPatronDeProhibicion("^[a-z]+$")).toBe(false);
    expect(esPatronDeProhibicion("\\p{Cc}")).toBe(true);
    expect(esPatronDeProhibicion("\\p{Zs}")).toBe(true);
    expect(esPatronDeProhibicion("[\\s\\S]*")).toBe(false);
    expect(esPatronDeProhibicion("[\\w$\\u0080-\\uffff]")).toBe(false);
    expect(esPatronDeProhibicion("[^!-~]")).toBe(false);
  });
});

describe("lista de permitidos: las formas que la revisión independiente pidió cerrar", () => {
  const r = String.raw;
  it.each([
    ["includes contra <", r`export const f = (t: string) => !t.includes("<");`],
    ["includes contra >", r`export const f = (t: string) => !t.includes('>');`],
    ["includes contra un salto de línea", r`export const f = (t: string) => !t.includes("\n");`],
    ["includes contra un invisible", r`export const f = (t: string) => !t.includes("\u200b");`],
    ["indexOf contra <", r`export const f = (t: string) => t.indexOf("<") < 0;`],
    ["startsWith contra un control", r`export const f = (t: string) => !t.startsWith("\u0000");`],
    ["comparación con <", r`export const f = (c: string) => c !== "<";`],
    ["comparación con >", r`export const f = (c: string) => c === ">";`],
    ["charCodeAt contra un control", r`export const f = (t: string) => t.charCodeAt(0) < 32;`],
    ["codePointAt contra DEL", r`export const f = (t: string) => t.codePointAt(0) === 127;`],
    [
      "codePointAt contra un invisible",
      r`export const f = (t: string) => t.codePointAt(0) === 0x200b;`,
    ],
    ["codePointAt contra <", r`export const f = (t: string) => 60 === t.codePointAt(0);`],
    ["RegExp sin new", r`export const R = RegExp(variable);`],
    ["new RegExp sin texto fijo", r`export const R = new RegExp(variable, "u");`],
    ["RegExp por globalThis", r`export const R = new globalThis.RegExp(variable);`],
    ["RegExp sin argumento", r`export const R = new RegExp();`],
    ["alias de RegExp", r`const R = RegExp;` + "\n" + r`export const x = new R(variable);`],
    ["RegExp pasado como argumento", r`export const x = construir(RegExp);`],
    ["RegExp por globalThis sin llamar", r`export const R = globalThis.RegExp;`],
    ["clase negada de comas", r`export const ok = (t: string) => /[^,;]/.test(t);`],
    ["clase negada de saltos de línea", r`export const ok = (t: string) => /^[^\r\n]+$/.test(t);`],
    ["todo menos espacios", r`export const ok = (t: string) => /^\S+$/.test(t);`],
    ["separadores", r`export const ok = (t: string) => /\p{Z}/u.test(t);`],
    ["controles de 0x80 a 0x9f", r`export const ok = (t: string) => /[\x80-\x9f]/.test(t);`],
    ["invisibles con escape", r`export const ok = (t: string) => /[\u200b-\u200f]/.test(t);`],
    [
      "invisibles con el carácter mismo",
      "export const ok = (t: string) => /[\u200b\u200c]/.test(t);",
    ],
    ["espacio de no separación", r`export const ok = (t: string) => /\u00ad/.test(t);`],
    ["marca de orden de bytes", r`export const ok = (t: string) => /\ufeff/.test(t);`],
    [
      "separador de línea",
      "export const ok = (t: string) => /" + String.fromCharCode(92) + "u2028/.test(t);",
    ],
    ["constructor con clase negada", r`export const R = new RegExp("[^,;]");`],
  ])("%s", (_, texto) => {
    expect(cuenta(texto), texto).toBe(1);
  });

  it("no cuenta una búsqueda con posición ni un código que no es de control", () => {
    expect(cuenta(r`export const f = (s: string, i: number) => s.indexOf("\n", i);`)).toBe(0);
    expect(cuenta(r`export const f = (t: string) => (t.codePointAt(0) ?? 0) % 360;`)).toBe(0);
    expect(cuenta(r`export const f = (t: string) => t.charCodeAt(0) === 65;`)).toBe(0);
    expect(cuenta(r`export const f = (t: string) => t.includes("<svg");`)).toBe(0);
    expect(cuenta(r`export const f = (t: unknown) => t instanceof RegExp;`)).toBe(0);
    expect(cuenta(r`export const f = (t: RegExp) => t;`)).toBe(0);
    expect(cuenta(r`export const f = (t: string) => /[\s\S]+/.exec(t);`)).toBe(0);
    expect(cuenta(r`export const f = (t: string) => /[\w$\u0080-￿]/.test(t);`)).toBe(0);
    expect(cuenta(r`export const f = (t: string) => /[^!-~]/.test(t);`)).toBe(0);
    expect(cuenta("export const R = new RegExp(String.raw`^[${PERMITIDOS}]+$`);")).toBe(0);
  });
});

describe("lista de permitidos: segunda revisión independiente", () => {
  const r = String.raw;

  it.each([
    [
      "String.raw con una categoría",
      r`export const R = new RegExp(String.raw` + "`" + r`\p{Cc}` + "`" + r`, "u");`,
    ],
    [
      "String.raw con un rango de controles",
      r`export const R = new RegExp(String.raw` + "`" + r`[\x00-\x1f]` + "`" + r`);`,
    ],
    [
      "String.raw con una parte variable",
      r`export const R = new RegExp(String.raw` + "`" + r`[\p{Cc}$` + "{x}]" + "`" + r`);`,
    ],
    ["globalThis con corchetes", r`export const R = globalThis["RegExp"]("a");`],
    ["categoría con nombre largo", r`export const R = /\p{General_Category=Control}/u;`],
    ["categoría abreviada con gc", r`export const R = /\p{gc=Cc}/u;`],
    ["categoría White_Space", r`export const R = /\p{White_Space}/u;`],
    ["categoría Control", r`export const R = /\p{Control}/u;`],
    ["escape con llaves", r`export const R = /\u{1f600}/u;`],
    ["clase con \r\n\t", r`export const R = /[\r\n\t]/;`],
    ["clase con \0", r`export const R = /[\0-\37]/;`],
    ["clase con un escape de control con c", r`export const R = /[\cA-\cZ]/;`],
  ])("%s cuenta", (_, texto) => {
    expect(cuenta(texto), texto).toBe(1);
  });

  it("String.raw con solo lo permitido no cuenta", () => {
    expect(cuenta("export const R = new RegExp(String.raw`^[a-z]{1,40}$`);")).toBe(0);
    expect(cuenta(r`export const R = /\p{Script=Latin}+/u;`)).toBe(0);
    expect(cuenta(r`export const R = /\p{L}+/u;`)).toBe(0);
  });
});

describe("lista de permitidos: tercera revisión independiente (evasiones baratas cerradas)", () => {
  const r = String.raw;

  it.each([
    ["< escapado en hexadecimal", r`export const R = /[\x3c\x3e]/;`],
    ["< escapado en unicode", "export const R = /" + String.fromCharCode(92) + "u003c/;"],
    ["todo menos letras y dígitos", r`export const R = /^\W+$/;`],
    ["caracteres ignorables", r`export const R = /\p{Default_Ignorable_Code_Point}/u;`],
    ["globalThis con una clave calculada", r`export const R = globalThis[nombre]("a");`],
    ["window con una clave calculada", r`export const R = window[nombre];`],
    ["global con una clave calculada", r`export const R = global[nombre];`],
    ["self con una clave calculada", r`export const R = self[nombre];`],
    ["globalThis con conversión angular", r`export const R = (<any>globalThis)[nombre];`],
    ["globalThis con aserción de no nulo", r`export const R = globalThis![nombre];`],
    ["globalThis con satisfies", r`export const R = (globalThis satisfies object)[nombre];`],
    [
      "globalThis con la clave RegExp en una plantilla",
      "export const R = globalThis[`RegExp`]('a');",
    ],
    [
      "Reflect.get con la clave RegExp en una plantilla",
      "export const R = Reflect.get(globalThis, `RegExp`);",
    ],
    [
      "globalThis convertido de tipo con una clave calculada",
      r`export const R = (globalThis as unknown as Record<string, unknown>)[nombre];`,
    ],
    [
      "Reflect.get sobre globalThis con RegExp",
      r`export const R = Reflect.get(globalThis, "RegExp");`,
    ],
    [
      "Reflect.get sobre globalThis con una clave calculada",
      r`export const R = Reflect.get(globalThis, nombre);`,
    ],
  ])("%s cuenta", (_, texto) => {
    expect(cuenta(texto), texto).toBe(1);
  });

  it("globalThis con una clave literal que no es RegExp no cuenta", () => {
    expect(cuenta(r`export const t = globalThis["setTimeout"];`)).toBe(0);
    expect(cuenta(r`export const t = Reflect.get(globalThis, "setTimeout");`)).toBe(0);
    expect(cuenta("export const t = globalThis[`setTimeout`];")).toBe(0);
    expect(cuenta(r`export const t = Reflect.get(objeto, "RegExp");`)).toBe(0);
  });
});

describe("lista de permitidos: los límites declarados en el encabezado del apoyo NO se ven (un ejemplo por cada uno)", () => {
  const r = String.raw;
  it.each([
    ["constante de otro archivo en una búsqueda", r`export const f = (t: string) => t.includes(INVISIBLE);`],
    ["constructor por x.constructor", r`export const f = (t: string) => (/a/).constructor("a")(t);`],
    ["\\s solo y < fuera de una clase", r`export const f = (t: string) => /^\s*$/.test(t) || /<script/.test(t);`],
    ["split contra <", r`export const f = (t: string) => t.split("<").length > 1;`],
    ["Set con <", r`export const f = (c: string) => new Set(["<", ">"]).has(c);`],
    ["comparación de texto", r`export const f = (c: string) => c < " ";`],
    ["código por una variable", r`export const f = (t: string, tope: number) => t.charCodeAt(0) < tope;`],
    ["tabla de búsqueda", r`export const f = (t: string) => PROHIBIDOS[t.charCodeAt(0)];`],
    ["validador de otra zona", r`export const f = (z: Z) => z.string().refine(esSeguro);`],
  ])("%s pasa sin contarse", (_, texto) => {
    expect(cuenta(texto), texto).toBe(0);
  });
});
