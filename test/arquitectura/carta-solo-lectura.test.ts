import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura (docs/plan-carta-catalogo-2026-09-24.md, M5): la carta pública es un espejo de SOLO LECTURA del
 * catálogo. Ni la lógica de la carta (`src/core/carta/**`) ni el endpoint que la sirve (`src/app/api/carta/**`, que lo llama
 * un sitio externo con un token de servicio) pueden escribir en la base. Si alguna vez hiciera falta, la escritura va en una
 * Server Action con `conPermiso` (`src/server/actions/carta/`, fuera de este chequeo a propósito), nunca en el camino público.
 *
 * Cómo se controla: ningún archivo de esas dos carpetas puede contener, fuera de un comentario, una llamada de escritura de
 * Prisma sobre un modelo (`x.modelo.create(`, `.createMany(`, `.update(`, `.updateMany(`, `.upsert(`, `.delete(`,
 * `.deleteMany(`, …) ni `$executeRaw`. Se exige la forma `cliente.modelo.op(` para no marcar métodos homónimos que no son de
 * Prisma (p. ej. `createHash("sha256").update(...)` de token-servicio.ts).
 */
const SRC = join(__dirname, "../../src");
const CARPETAS = ["core/carta", "app/api/carta"];
const ESCRITURA = /\w\s*\.\s*\w+\s*\.\s*(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)\s*\(|\$executeRaw/;

function archivos(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

function esComentario(linea: string): boolean {
  const t = linea.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

function lineasQueEscriben(fuente: string): number[] {
  return fuente
    .replace(/\r\n/g, "\n")
    .split("\n")
    .flatMap((linea, i) => (!esComentario(linea) && ESCRITURA.test(linea) ? [i + 1] : []));
}

describe("carta: solo lectura", () => {
  const rutas = CARPETAS.flatMap((c) => archivos(join(SRC, c)));

  it("encuentra los archivos de la carta (lógica y endpoint)", () => {
    const nombres = rutas.map((r) => relative(SRC, r).split(sep).join("/"));
    expect(nombres).toContain("core/carta/menu-consulta.ts");
    expect(nombres).toContain("app/api/carta/[sucursal]/route.ts");
  });

  it("ningún archivo de src/core/carta ni src/app/api/carta escribe en la base", () => {
    const problemas = rutas.flatMap((ruta) => lineasQueEscriben(readFileSync(ruta, "utf8")).map((l) => `${relative(SRC, ruta).split(sep).join("/")}:${l}`));
    expect(problemas, `La carta pública es de solo lectura; estas líneas escriben:\n${problemas.join("\n")}`).toEqual([]);
  });

  describe("el detector (con fuentes sintéticas)", () => {
    it("marca create/update/upsert/delete y $executeRaw", () => {
      const fuente = [
        "await db.promoCarta.create({ data });",
        "await db.contenidoCartaProducto.update({ where, data });",
        "await db.seccionCarta.upsert({ where, create, update });",
        "await db.seccionCarta.deleteMany();",
        "await db.$executeRaw`DELETE FROM x`;",
        "await db.producto.updateMany ({ data });",
      ].join("\n");
      expect(lineasQueEscriben(fuente)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("no marca lecturas ni comentarios", () => {
      const fuente = [
        "const x = await db.seccionCarta.findMany({ where: { activa: true } });",
        "const y = await db.producto.count();",
        "// acá NO se hace db.promoCarta.create(...)",
        " * ni .update( en un docstring",
        'const h = createHash("sha256").update(s, "utf8").digest();',
        "porId.delete(clave);",
      ].join("\n");
      expect(lineasQueEscriben(fuente)).toEqual([]);
    });
  });
});
