import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as fichas from "@/core/datos/fichas-de-texto";
import * as cuit from "@/core/fiscal/cuit-estricto";
import * as texto from "@/core/datos/texto-de-catalogo";
import { EXPORTADOS_DE_CUIT_ESTRICTO, CODIGOS_DE_ERROR } from "../core/oraculo-cuit-estricto";
import { DECLARACION_DE_FICHAS, EXPORTADOS_DE_TEXTO_DE_CATALOGO, FICHAS, FUNCIONES_POR_FICHA, MOTIVOS, OPCIONES_DE_LAS_REGLAS, OTRAS_FUNCIONES_DE_FICHAS } from "../core/oraculo-texto-de-catalogo";

/**
 * Guardián de dimensiones de la regla de texto de catálogo y de CUIT (AGENTS.md, «Combinaciones»; etapa E1 del plan de paridad con Pedernal): falla si aparece una
 * ficha, una opción de las reglas, un motivo de rechazo o una función exportada que el oráculo (`test/core/oraculo-texto-de-catalogo.ts` y `oraculo-cuit-estricto.ts`)
 * no declara. Así una dimensión nueva (un dato con su largo, una opción como «sin tildes») no entra sin una fila que diga qué cambia.
 * LÍMITES: lee los archivos como texto (las exportaciones `export function|const|type|class` y los miembros del tipo de las reglas y de los motivos); una exportación
 * con otra forma (`export { a }`, `export default`) no se ve; no comprueba que lo declarado esté bien, solo que esté declarado.
 */
const RUTAS = {
  texto: "src/core/datos/texto-de-catalogo.ts",
  fichas: "src/core/datos/fichas-de-texto.ts",
  cuit: "src/core/fiscal/cuit-estricto.ts",
} as const;

const fuente = (ruta: string): string => readFileSync(ruta, "utf8");

/** Los nombres exportados con `export function|const|type|class|interface`. */
export function nombresExportados(codigo: string): string[] {
  return [...codigo.matchAll(/^export (?:async )?(?:function|const|type|class|interface|enum) (\w+)/gm)].map((m) => m[1] ?? "").sort();
}

/** Las propiedades del tipo `ReglasDelTexto = Readonly<{ a: …; b?: … }>`. */
export function opcionesDeLasReglas(codigo: string): string[] {
  const bloque = /export type ReglasDelTexto = Readonly<\{([\s\S]*?)\}>/.exec(codigo)?.[1] ?? "";
  return [...bloque.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1] ?? "").sort();
}

/** Los miembros de una unión de cadenas `export type Nombre = "A" | "B"`. */
export function miembrosDeLaUnion(codigo: string, nombre: string): string[] {
  const cuerpo = new RegExp(`export type ${nombre} =([^;]*);`).exec(codigo)?.[1] ?? "";
  return [...cuerpo.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1] ?? "").sort();
}

describe("guardián de texto de catálogo: el detector", () => {
  it("lee las exportaciones, las opciones y los miembros de una unión", () => {
    expect(nombresExportados("export function b() {}\nconst x = 1;\nexport type A = 1;\nexport const C = 2;")).toEqual(["A", "C", "b"]);
    expect(opcionesDeLasReglas("export type ReglasDelTexto = Readonly<{\n  maximo: number;\n  opcional?: boolean;\n}>;")).toEqual(["maximo", "opcional"]);
    expect(miembrosDeLaUnion('export type M = "UNO" | "DOS_TRES";', "M")).toEqual(["DOS_TRES", "UNO"]);
  });
  it("los archivos que lee existen y tienen exportaciones (no mira un archivo vacío)", () => {
    for (const ruta of Object.values(RUTAS)) expect(nombresExportados(fuente(ruta)).length).toBeGreaterThan(2);
  });
});

describe("guardián de texto de catálogo: todo lo que cambia qué se acepta está declarado en el oráculo", () => {
  it("lo exportado por texto-de-catalogo.ts es exactamente lo declarado", () => {
    expect(nombresExportados(fuente(RUTAS.texto))).toEqual([...EXPORTADOS_DE_TEXTO_DE_CATALOGO].sort());
  });

  it("las opciones de ReglasDelTexto son exactamente las declaradas (una opción nueva cambia qué se acepta: va al oráculo)", () => {
    expect(opcionesDeLasReglas(fuente(RUTAS.texto))).toEqual([...OPCIONES_DE_LAS_REGLAS].sort());
  });

  it("los motivos de rechazo son exactamente los declarados", () => {
    expect(miembrosDeLaUnion(fuente(RUTAS.texto), "MotivoDeTextoInvalido")).toEqual([...MOTIVOS].sort());
  });

  it("las fichas de la tabla son exactamente las declaradas, con las mismas opciones por ficha", () => {
    expect(Object.keys(fichas.FICHAS_DE_TEXTO).sort()).toEqual([...FICHAS].sort());
    for (const ficha of FICHAS) {
      expect(Object.keys(fichas.FICHAS_DE_TEXTO[ficha]).sort(), ficha).toEqual([...OPCIONES_DE_LAS_REGLAS].sort());
      expect(fichas.FICHAS_DE_TEXTO[ficha]).toEqual(DECLARACION_DE_FICHAS[ficha]);
    }
  });

  it("lo exportado por fichas-de-texto.ts es la tabla, el tipo, las funciones con nombre y las otras declaradas, y nada más", () => {
    const declaradas = ["FICHAS_DE_TEXTO", "FichaDeTexto", ...Object.keys(FUNCIONES_POR_FICHA), ...OTRAS_FUNCIONES_DE_FICHAS].sort();
    expect(nombresExportados(fuente(RUTAS.fichas))).toEqual(declaradas);
  });

  it("cada función con nombre existe y cada ficha tiene su función (una ficha nueva sin función, o al revés, no pasa)", () => {
    const modulo = fichas as unknown as Record<string, unknown>;
    for (const nombre of Object.keys(FUNCIONES_POR_FICHA)) expect(typeof modulo[nombre], nombre).toBe("function");
    expect(Object.values(FUNCIONES_POR_FICHA).sort()).toEqual([...FICHAS].sort());
  });

  it("lo exportado en tiempo de ejecución coincide con lo escrito en el código (nada exportado de otra manera)", () => {
    const enCodigo = (ruta: string, tipos: readonly string[]) => nombresExportados(fuente(ruta)).filter((n) => !tipos.includes(n));
    expect(Object.keys(texto).sort()).toEqual(enCodigo(RUTAS.texto, ["MotivoDeTextoInvalido", "ReglasDelTexto"]));
    expect(Object.keys(fichas).sort()).toEqual(enCodigo(RUTAS.fichas, ["FichaDeTexto"]));
    expect(Object.keys(cuit).sort()).toEqual(enCodigo(RUTAS.cuit, ["ErrorDeCuit"]));
  });
});

describe("guardián del CUIT estricto: todo lo exportado y todo código de error está declarado", () => {
  it("lo exportado por cuit-estricto.ts es exactamente lo declarado", () => {
    expect(nombresExportados(fuente(RUTAS.cuit))).toEqual([...EXPORTADOS_DE_CUIT_ESTRICTO].sort());
  });
  it("los códigos de error son exactamente los declarados", () => {
    expect(miembrosDeLaUnion(fuente(RUTAS.cuit), "ErrorDeCuit")).toEqual([...CODIGOS_DE_ERROR].sort());
  });
});
