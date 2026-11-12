import { describe, expect, it } from "vitest";
import { type Cerco, medirPorArchivo } from "./cercos/trinquete";
import { probarCerco } from "./cercos/probar-cerco";
import { contarProhibidosEnCodigo } from "./cerco-lista-de-permitidos-apoyo";

/**
 * Cerco «lista de prohibidos» (regla del dueño «Todo nace cerrado», 2026-11-11, AGENTS.md): la validación de un dato declara lo que se PERMITE (conjunto, largo, forma), nunca lo que se prohíbe.
 * Lo que nadie pensó en prohibir pasa (caso real de Pedernal: `/\p{Cc}/u` solo rechazaba controles y dejaba pasar invisibles y `<>`). Cuenta, por archivo, las validaciones por lista de prohibidos
 * (detector y sus límites, en `cerco-lista-de-permitidos-apoyo.ts`; cada forma con su violación inyectada, en `cerco-lista-de-permitidos-evasiones.test.ts`) en `src/`, `plataforma/src/` y `scripts/`, sin
 * archivos de prueba. Lo que ya existe es deuda con vencimiento (`cercos/vencimientos.ts`, máximo 60 días); una nueva no entra.
 * Meta: 0 (cada una pasa a declarar lo permitido: se corrige en un trabajo aparte, no en el PR que instala el guardián).
 *
 * Mecanismo, regeneración (`BAJAR_CERCOS=1`) y excepciones: `test/arquitectura/cercos/trinquete.ts`.
 */
const EXTENSIONES = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const ES_DE_PRUEBA = /\.(?:test|spec)\.[a-z]+$|(?:^|\/)tests?\//;

function contar(fuente: string, ruta: string): Record<string, number> {
  return { "lista-de-prohibidos": contarProhibidosEnCodigo(ruta, fuente) };
}

const CERCO_LISTA_DE_PERMITIDOS: Cerco = {
  regla: "lista-de-prohibidos",
  meta: "0 (la validación declara lo permitido: conjunto, largo, forma; trabajo aparte del PR que instala el guardián)",
  medir: medirPorArchivo({ raices: ["src", "plataforma/src", "scripts"], extensiones: EXTENSIONES, incluir: (ruta) => !ES_DE_PRUEBA.test(ruta), contar }),
};

describe("cerco «lista de prohibidos»: el detector mira código real", () => {
  it("cuenta una prohibición escrita en un archivo y no la de un archivo de prueba", () => {
    expect(contar("export const ok = (t: string) => !/\\p{Cc}/u.test(t);", "x.ts")).toEqual({ "lista-de-prohibidos": 1 });
    expect(ES_DE_PRUEBA.test("src/core/a.test.ts")).toBe(true);
    expect(ES_DE_PRUEBA.test("scripts/test/a.ts")).toBe(true);
    expect(ES_DE_PRUEBA.test("src/core/a.ts")).toBe(false);
  });
});

probarCerco(CERCO_LISTA_DE_PERMITIDOS);
