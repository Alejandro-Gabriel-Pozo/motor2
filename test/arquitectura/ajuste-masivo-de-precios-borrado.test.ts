import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El ajuste MASIVO de precios de la carta (CARTA-MANT F4: «Precios» por sección o «en toda la empresa», con su aviso de sucursales) se BORRÓ por decisión del dueño (2026-10-28; ya lo había decidido el
 * 2026-10-20: borrarlo si no se extrañaba). Apagado (`PRECIOS_EDITABLES = false`) solo escondía la pantalla: el servidor seguía aceptando `ajustarPreciosDeLaCarta` y `ajustarPreciosDeLaEmpresa`. Este
 * guardián falla si alguno de sus nombres vuelve a aparecer en `src/` (fuera de los comentarios): volver a tenerlo es una decisión del dueño, con su diseño. Los precios se cambian en Catálogo (precio de
 * lista y precio local del producto) y en Promociones (precio local de la promo), que NO son esto.
 */
const NOMBRES_BORRADOS = [
  "PRECIOS_EDITABLES",
  "ajustarPreciosDeLaCarta",
  "ajustarPreciosDeLaEmpresa",
  "avisoDePrecioDeEmpresa",
  "avisoDelPrecioDeLaEmpresa",
  "guardComandoAjustarPreciosDeLaCarta",
  "guardComandoAjustarPreciosDeLaEmpresa",
  "guardComandoAvisoDePrecioDeEmpresa",
  "precioAjustado",
  "validarAjusteDePrecio",
  "HojaDePrecios",
] as const;

const SRC = join(__dirname, "../../src");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}

/** El código sin los comentarios (de línea, de bloque y JSX): la historia puede nombrarlo en un comentario. */
const sinComentarios = (fuente: string) =>
  fuente
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** Dónde aparece cada nombre borrado en el código de `src/` (ruta relativa y nombre). */
function apariciones(fuentes: readonly { ruta: string; texto: string }[]): string[] {
  return fuentes.flatMap(({ ruta, texto }) => {
    const codigo = sinComentarios(texto);
    return NOMBRES_BORRADOS.filter((n) => new RegExp(`\\b${n}\\b`).test(codigo)).map((n) => `${ruta}: ${n}`);
  });
}

describe("el ajuste masivo de precios de la carta está borrado (decisión del dueño, 2026-10-28)", () => {
  it("ningún archivo de src/ vuelve a definir ni a usar sus nombres", () => {
    const fuentes = archivos(SRC).map((ruta) => ({ ruta: relative(SRC, ruta), texto: readFileSync(ruta, "utf8") }));
    expect(fuentes.length).toBeGreaterThan(500);
    expect(apariciones(fuentes)).toEqual([]);
  });

  it("el cálculo lo ve en el código y no en un comentario (no pasa en vacío)", () => {
    expect(apariciones([{ ruta: "x.ts", texto: 'export async function ajustarPreciosDeLaCarta() {}\n// PRECIOS_EDITABLES era el interruptor' }])).toEqual(["x.ts: ajustarPreciosDeLaCarta"]);
    expect(apariciones([{ ruta: "y.ts", texto: "/** precioAjustado */ const a = 1;" }])).toEqual([]);
  });
});
