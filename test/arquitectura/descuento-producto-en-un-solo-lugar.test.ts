import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura: "¿qué porcentaje de descuento tiene este producto en esta sucursal?" se decide en UN solo lugar —
 * `descuentosDeProductoEnSucursal` (`server/lecturas/carta/descuentos.ts`). Un lector que consulte `DescuentoProductoSucursal` por su
 * cuenta puede mostrar (o cobrar) otro precio que el resto de las pantallas: la carta pública, el selector del POS, el cobro al agregar el
 * ítem y el cierre salen todos del mismo embudo, y TypeScript no detecta una lectura paralela (todas tipan igual).
 *
 * Lo que sí puede leer la tabla cruda: la acción que la edita (`server/actions/carta/descuento-producto.ts`: busca la fila para saber si
 * crea, actualiza o borra, y para auditar el valor anterior).
 *
 * Cómo se controla: ningún otro archivo de `src/` puede llamar `descuentoProductoSucursal.find*` / `count` / `aggregate` / `groupBy` fuera de
 * un comentario.
 */
const RAIZ = join(__dirname, "../../src");
const ARCHIVOS_PERMITIDOS = ["server/lecturas/carta/descuentos.ts", "server/actions/carta/descuento-producto.ts"];
const LECTURA = /descuentoProductoSucursal\s*\.\s*(find|count|aggregate|groupBy)/;

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

function esComentario(linea: string): boolean {
  const t = linea.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

/** Las líneas (1-based) que leen `descuentoProductoSucursal` (find, count, aggregate o groupBy) fuera de un comentario. */
function lineasQueLeenDescuentoDirecto(fuente: string): number[] {
  const malas: number[] = [];
  fuente
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((linea, i) => {
      if (esComentario(linea)) return;
      if (LECTURA.test(linea)) malas.push(i + 1);
    });
  return malas;
}

describe("descuento de producto: un solo lugar decide el % de cada producto en la sucursal", () => {
  const rutas = archivos(RAIZ);

  it("encuentra archivos de src/", () => {
    expect(rutas.length).toBeGreaterThan(50);
  });

  it("ningún archivo fuera de la lista permitida lee `descuentoProductoSucursal` directo", () => {
    const problemas: string[] = [];
    for (const ruta of rutas) {
      const nombre = relative(RAIZ, ruta).split(sep).join("/");
      if (ARCHIVOS_PERMITIDOS.includes(nombre)) continue;
      for (const linea of lineasQueLeenDescuentoDirecto(readFileSync(ruta, "utf8"))) problemas.push(`${nombre}:${linea}`);
    }
    expect(
      problemas,
      `Estas líneas leen DescuentoProductoSucursal a mano en vez de pasar por descuentosDeProductoEnSucursal (server/lecturas/carta/descuentos):\n${problemas.join("\n")}`
    ).toEqual([]);
  });

  it("los archivos permitidos existen (la lista no quedó desactualizada)", () => {
    const existentes = new Set(rutas.map((r) => relative(RAIZ, r).split(sep).join("/")));
    for (const permitido of ARCHIVOS_PERMITIDOS) expect(existentes.has(permitido), permitido).toBe(true);
  });

  describe("el detector (con fuentes sintéticas)", () => {
    it("marca una lectura directa de la tabla", () => {
      const fuente = ["const filas = await db.descuentoProductoSucursal.findMany({", "  where: { sucursalId },", "});"].join("\n");
      expect(lineasQueLeenDescuentoDirecto(fuente)).toEqual([1]);
    });

    it("marca findUnique, count y groupBy, también sobre una transacción", () => {
      const fuente = ["await tx.descuentoProductoSucursal.findUnique({});", "await prisma.descuentoProductoSucursal . count({});", "await db.descuentoProductoSucursal.groupBy({});"].join("\n");
      expect(lineasQueLeenDescuentoDirecto(fuente)).toEqual([1, 2, 3]);
    });

    it("no marca un comentario que menciona la lectura", () => {
      const fuente = "// antes: db.descuentoProductoSucursal.findMany — ahora pasa por descuentosDeProductoEnSucursal.";
      expect(lineasQueLeenDescuentoDirecto(fuente)).toEqual([]);
    });

    it("no marca el uso legítimo del embudo ni las escrituras", () => {
      const fuente = ["const descuentos = await descuentosDeProductoEnSucursal(sucursalId, db);", "await tx.descuentoProductoSucursal.upsert({});"].join("\n");
      expect(lineasQueLeenDescuentoDirecto(fuente)).toEqual([]);
    });
  });
});
