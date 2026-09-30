import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura (docs/plan-carta-catalogo-2026-09-24.md, M5): la carta pública es un espejo de SOLO LECTURA del
 * catálogo. Ni la lógica de la carta (`src/core/carta/**`) ni las páginas que la sirven (`src/app/(carta-publica)/**`; Fase 8 del
 * ADR-006 borró el endpoint HTTP `src/app/api/carta/**`) pueden escribir en la base. Si alguna vez hiciera falta, la escritura va en una
 * Server Action con `conPermiso` (`src/server/actions/carta/`), nunca en el camino público — y esas acciones, a su vez, solo
 * pueden escribir en las 7 tablas de carta (SeccionCarta, ContenidoCartaProducto, PromoCarta,
 * SucursalPublica, el registro de tenants del portal, TemaCartaSucursal, el tema visual, e ItemAgrupadoCarta y
 * OpcionItemAgrupadoCarta, los ítems agrupados): el catálogo, los precios, la disponibilidad y las sucursales en sí se siguen
 * editando donde siempre.
 *
 * Cómo se controla: ningún archivo de esas carpetas puede contener, fuera de un comentario, una llamada de escritura de
 * Prisma sobre un modelo (`x.modelo.create(`, `.createMany(`, `.update(`, `.updateMany(`, `.upsert(`, `.delete(`,
 * `.deleteMany(`, …) ni `$executeRaw`. Se exige la forma `cliente.modelo.op(` para no marcar métodos homónimos que no son de
 * Prisma (p. ej. `createHash("sha256").update(...)`).
 *
 * `GeneroCarta` (docs/plan-genero-carta-2026-09-26.md) sumó una 8ª tabla a la whitelist de abajo: carpeta VISUAL del POS, sin
 * relación con `ContenidoCartaProducto.generoCartaId` / `ItemAgrupadoCarta.generoCartaId` en la carta pública (G4: la lee
 * `selector-carta-consulta.ts`, en `core/pos`, no en `core/carta`).
 *
 * `PromoCartaCupo` (Task #16, docs/plan-promo-combo-2026-09-26.md) suma una 9ª: los cupos de una promo ARMABLE (D1) —
 * `PromoCarta` deja de ser puramente informativa cuando tiene uno o más, pero la tabla en sí sigue siendo del ADMIN de la
 * carta (paso 5, `guardarCuposPromoCarta`), nunca del camino público.
 */
const SRC = join(__dirname, "../../src");
const CARPETAS = ["core/carta", "app/(carta-publica)", "components/carta-publica"];
/** Captura el modelo de una escritura `cliente.modelo.op(`. */
const ESCRITURA_POR_MODELO = /\w\s*\.\s*(\w+)\s*\.\s*(?:create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)\s*\(/;
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

  it("encuentra los archivos de la carta (lógica y páginas públicas)", () => {
    const nombres = rutas.map((r) => relative(SRC, r).split(sep).join("/"));
    expect(nombres).toContain("core/carta/menu-consulta.ts");
    expect(nombres).toContain("core/carta/publica-consulta.ts");
    expect(nombres).toContain("core/carta/publica-sin-sesion.ts");
    expect(nombres).toContain("app/(carta-publica)/carta-publica/[empresa]/page.tsx");
  });

  it("ningún archivo de src/core/carta ni de las páginas públicas escribe en la base", () => {
    const problemas = rutas.flatMap((ruta) => lineasQueEscriben(readFileSync(ruta, "utf8")).map((l) => `${relative(SRC, ruta).split(sep).join("/")}:${l}`));
    expect(problemas, `La carta pública es de solo lectura; estas líneas escriben:\n${problemas.join("\n")}`).toEqual([]);
  });

  it("las Server Actions de la carta (src/server/actions/carta) solo escriben en las 9 tablas de carta", () => {
    // `sucursalPublica`: el registro de tenants del portal (docs/plan-registro-tenants-2026-09-24.md, M6).
    // `temaCartaSucursal`: el tema visual de la carta (docs/plan-tema-carta-2026-09-24.md, M8).
    // `itemAgrupadoCarta` y `opcionItemAgrupadoCarta`: los ítems agrupados (docs/plan-agrupacion-items-carta-2026-09-24.md, M5).
    // Ya no está la puente categoría → sección: cada contenido e ítem agrupado elige su sección directo (docs/plan-carta-seccion-directa-2026-09-25.md, M1).
    // `generoCarta`: carpetas VISUALES del POS (docs/plan-genero-carta-2026-09-26.md), global, sin efecto en la carta pública.
    // `promoCartaCupo`: cupos de una promo ARMABLE (Task #16, docs/plan-promo-combo-2026-09-26.md, D1) — admin de la carta, no público.
    const TABLAS_DE_CARTA = new Set([
      "seccionCarta",
      "contenidoCartaProducto",
      "promoCarta",
      "sucursalPublica",
      "temaCartaSucursal",
      "itemAgrupadoCarta",
      "opcionItemAgrupadoCarta",
      "generoCarta",
      "promoCartaCupo",
    ]);
    const acciones = archivos(join(SRC, "server/actions/carta"));
    expect(acciones.length, "no se encontraron las acciones de la carta").toBeGreaterThan(0);
    const problemas = acciones.flatMap((ruta) =>
      readFileSync(ruta, "utf8")
        .replace(/\r\n/g, "\n")
        .split("\n")
        .flatMap((linea, i) => {
          if (esComentario(linea)) return [];
          const modelos = [...linea.matchAll(new RegExp(ESCRITURA_POR_MODELO, "g"))].map((m) => m[1]);
          const ajenos = modelos.filter((m) => !TABLAS_DE_CARTA.has(m));
          const raw = /\$executeRaw/.test(linea);
          return ajenos.length || raw ? [`${relative(SRC, ruta).split(sep).join("/")}:${i + 1} ${raw ? "$executeRaw" : ajenos.join(", ")}`] : [];
        })
    );
    expect(problemas, `Las acciones de la carta escriben fuera de sus tablas:\n${problemas.join("\n")}`).toEqual([]);
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
