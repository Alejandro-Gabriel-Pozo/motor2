import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura: la estructura de la carta (SeccionCarta, GeneroCarta, ItemAgrupadoCarta, ContenidoCartaProducto y
 * OpcionItemAgrupadoCarta) hoy es una sola para toda la empresa y se lee en un puñado de archivos. Cuando la carta pase a ser propia de
 * cada sucursal, TypeScript obliga a cambiar las escrituras, pero NO obliga a filtrar por sucursal un `findMany`/`findFirst` que ya existe:
 * esa lectura seguiría compilando y mezclaría cartas. Esta lista es el inventario de lectores que hay que revisar uno por uno en ese
 * momento, y evita que aparezca un lector nuevo sin que nadie lo note.
 *
 * Cómo se controla: solo los archivos de `ARCHIVOS_PERMITIDOS` pueden llamar `<modelo>.find*` / `count` / `aggregate` / `groupBy` sobre
 * esos cinco modelos, fuera de un comentario. Un lector nuevo se agrega a la lista a propósito (y, cuando la carta sea por sucursal, con
 * su filtro por sucursal).
 */
const RAIZ = join(__dirname, "../../src");
const ARCHIVOS_PERMITIDOS = [
  "core/carta/menu-consulta.ts",
  "core/carta/admin-consulta.ts",
  "core/carta/grupo-producto-consulta.ts",
  "core/pos/selector-carta-consulta.ts",
  "server/actions/carta/secciones.ts",
  "server/actions/carta/generos.ts",
  "server/actions/carta/generos-compartido.ts",
  "server/actions/carta/contenido-producto.ts",
  "server/actions/carta/items-agrupados.ts",
  "server/actions/carta/promos.ts",
];
const LECTURA = /\b(seccionCarta|generoCarta|itemAgrupadoCarta|contenidoCartaProducto|opcionItemAgrupadoCarta)\s*\.\s*(find|count|aggregate|groupBy)/;

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

/** Las líneas (1-based) que leen alguno de los cinco modelos de estructura de carta fuera de un comentario. */
function lineasQueLeenEstructura(fuente: string): number[] {
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

describe("estructura de carta: los lectores están inventariados", () => {
  const rutas = archivos(RAIZ);

  it("encuentra archivos de src/", () => {
    expect(rutas.length).toBeGreaterThan(50);
  });

  it("ningún archivo fuera del inventario lee los modelos de estructura de carta directo", () => {
    const problemas: string[] = [];
    for (const ruta of rutas) {
      const nombre = relative(RAIZ, ruta).split(sep).join("/");
      if (ARCHIVOS_PERMITIDOS.includes(nombre)) continue;
      for (const linea of lineasQueLeenEstructura(readFileSync(ruta, "utf8"))) problemas.push(`${nombre}:${linea}`);
    }
    expect(
      problemas,
      `Estas líneas leen la estructura de la carta fuera del inventario (agregá el archivo a ARCHIVOS_PERMITIDOS a propósito, o usá las consultas de core/carta):\n${problemas.join("\n")}`
    ).toEqual([]);
  });

  it("los archivos del inventario existen y todos leen algún modelo (la lista no quedó desactualizada)", () => {
    const porNombre = new Map(rutas.map((r) => [relative(RAIZ, r).split(sep).join("/"), r]));
    for (const permitido of ARCHIVOS_PERMITIDOS) {
      const ruta = porNombre.get(permitido);
      expect(ruta, `${permitido} ya no existe: actualizá la lista`).toBeDefined();
      expect(lineasQueLeenEstructura(readFileSync(ruta!, "utf8")).length, `${permitido} ya no lee estos modelos: sacalo de la lista`).toBeGreaterThan(0);
    }
  });

  describe("el detector (con fuentes sintéticas)", () => {
    it("marca una lectura directa de cada modelo", () => {
      const fuente = [
        "await db.seccionCarta.findMany({});",
        "await db.generoCarta.findFirst({});",
        "await db.itemAgrupadoCarta.findUnique({});",
        "await db.contenidoCartaProducto.findMany({});",
        "await db.opcionItemAgrupadoCarta.findFirst({});",
      ].join("\n");
      expect(lineasQueLeenEstructura(fuente)).toEqual([1, 2, 3, 4, 5]);
    });

    it("marca count, aggregate y groupBy, también sobre una transacción y con espacios", () => {
      const fuente = ["await tx.seccionCarta.count({});", "await prisma.generoCarta . aggregate({});", "await ctx.db.itemAgrupadoCarta.groupBy({});"].join("\n");
      expect(lineasQueLeenEstructura(fuente)).toEqual([1, 2, 3]);
    });

    it("no marca un comentario ni las escrituras", () => {
      const fuente = [
        "// antes: db.seccionCarta.findMany({}) — ahora pasa por resolverMenuCarta.",
        "await tx.seccionCarta.create({});",
        "await tx.generoCarta.update({});",
        "await tx.itemAgrupadoCarta.delete({});",
        "await tx.contenidoCartaProducto.upsert({});",
      ].join("\n");
      expect(lineasQueLeenEstructura(fuente)).toEqual([]);
    });
  });
});
