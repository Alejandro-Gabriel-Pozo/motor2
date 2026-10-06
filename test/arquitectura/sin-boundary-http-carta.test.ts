import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura (ADR-006, Fase 8): la carta pública es un módulo INTERNO (`src/app/(carta-publica)/**`); ya no existe el
 * boundary HTTP que consumía la app externa `restaurant-menu-design` (`/api/carta/*`, autenticado con `CARTA_API_TOKEN`). Esta regla
 * evita que vuelva por descuido: ni rutas bajo `src/app/api/carta`, ni las variables de entorno del boundary, ni un llamado a esa ruta.
 */
const RAIZ = join(__dirname, "../..");
const SRC = join(RAIZ, "src");
// Se arman por partes para que este archivo no se detecte a sí mismo.
const VARIABLES = ["CARTA_API" + "_TOKEN", "CARTA_PORTAL" + "_URL"];
const RUTA_HTTP = "/api/" + "carta";

function archivos(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((nombre) => {
    if (nombre === "node_modules" || nombre === ".next") return [];
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : [ruta];
  });
}

const esComentario = (linea: string) => {
  const t = linea.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
};

const relativa = (ruta: string) => relative(RAIZ, ruta).split(sep).join("/");

describe("carta: sin boundary HTTP (ADR-006, Fase 8)", () => {
  it("no existe ninguna ruta bajo src/app/api/carta", () => {
    const rutas = archivos(join(SRC, "app/api/carta")).map(relativa);
    expect(rutas, `Fase 8 borró el endpoint HTTP de la carta; reaparecieron:\n${rutas.join("\n")}`).toEqual([]);
  });

  it("ninguna variable de entorno del boundary (token de servicio, URL del portal externo) sigue en código, tests ni configuración", () => {
    const candidatos = [
      ...archivos(SRC),
      ...archivos(join(RAIZ, "test")),
      ...["playwright.config.ts", "next.config.ts", "package.json", "vercel.json", ".env.example"].map((f) => join(RAIZ, f)).filter(existsSync),
    ].filter((ruta) => /\.(tsx?|cjs|mjs|jsonc?|example)$/.test(ruta) && ruta !== __filename);
    expect(candidatos.length, "no se encontraron archivos para revisar").toBeGreaterThan(0);
    const problemas = candidatos.flatMap((ruta) =>
      readFileSync(ruta, "utf8")
        .replace(/\r\n/g, "\n")
        .split("\n")
        .flatMap((linea, i) => (VARIABLES.some((v) => linea.includes(v)) ? [`${relativa(ruta)}:${i + 1}`] : []))
    );
    expect(problemas, `Variables del boundary HTTP de la carta:\n${problemas.join("\n")}`).toEqual([]);
  });

  it("ningún código de src llama a /api/carta (los comentarios pueden nombrarla; el e2e que verifica el 404 vive en test/e2e)", () => {
    const candidatos = archivos(SRC).filter((ruta) => /\.tsx?$/.test(ruta));
    const problemas = candidatos.flatMap((ruta) =>
      readFileSync(ruta, "utf8")
        .replace(/\r\n/g, "\n")
        .split("\n")
        .flatMap((linea, i) => (!esComentario(linea) && linea.includes(RUTA_HTTP) ? [`${relativa(ruta)}:${i + 1}`] : []))
    );
    expect(problemas, `Llamados a la ruta HTTP de la carta:\n${problemas.join("\n")}`).toEqual([]);
  });
});
