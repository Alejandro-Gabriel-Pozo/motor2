import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura: la estructura de la carta se lee en un puñado de archivos. Las SECCIONES (SeccionCarta) son de la empresa; el
 * CONTENIDO de cada producto, los GÉNEROS, los ÍTEMS AGRUPADOS y sus opciones (ContenidoCartaProducto, GeneroCarta, ItemAgrupadoCarta y
 * OpcionItemAgrupadoCarta) son PROPIOS de cada sucursal (ADR-009, C3/C4). TypeScript obliga a pasar `sucursalId` en una escritura, pero NO
 * obliga a filtrar por sucursal un `findMany`/`findFirst`/relación que ya existe: esa lectura seguiría compilando y mezclaría las cartas de
 * dos sucursales. Esta lista es el inventario de lectores, y evita que aparezca uno nuevo sin que nadie lo note.
 *
 * Cómo se controla:
 * 1. Solo los archivos de `ARCHIVOS_PERMITIDOS` pueden llamar `<modelo>.find*` / `count` / `aggregate` / `groupBy` sobre los cinco modelos,
 *    fuera de un comentario. Un lector nuevo se agrega a la lista a propósito.
 * 2. Cada lectura directa de un modelo PROPIO de la sucursal lleva `whereCartaDeSucursal(` dentro de su propio where. SeccionCarta no.
 * 3. Cada lectura por la RELACIÓN del producto (`contenidosCarta: {…}`, `opcionesItemAgrupadoCarta: {…}`) lleva el mismo filtro: una
 *    relación sin él devolvería la fila de cualquier sucursal.
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
  "server/actions/carta/copiar-carta.ts",
];
const LECTURA = /\b(seccionCarta|generoCarta|itemAgrupadoCarta|contenidoCartaProducto|opcionItemAgrupadoCarta)\s*\.\s*(find|count|aggregate|groupBy)/;
/** Los modelos PROPIOS de la sucursal: SeccionCarta queda afuera a propósito (es de la empresa). */
const LECTURA_DE_SUCURSAL = /\b(generoCarta|itemAgrupadoCarta|contenidoCartaProducto|opcionItemAgrupadoCarta)\s*\.\s*(find|count|aggregate|groupBy)/;
/** La relación del producto hacia la carta propia, abierta con `{` (`: true` en un `_count` no es una lectura de filas). */
const RELACION_DE_PRODUCTO = /\b(contenidosCarta|opcionesItemAgrupadoCarta)\s*:\s*\{/;
const FILTRO = "whereCartaDeSucursal(";

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

/** El texto entre el delimitador de apertura de `desde` y su cierre balanceado. */
function cuerpoBalanceado(texto: string, desde: number, abre: "(" | "{", cierra: ")" | "}"): string {
  const inicio = texto.indexOf(abre, desde);
  let profundidad = 0;
  let fin = inicio;
  for (; fin < texto.length; fin++) {
    if (texto[fin] === abre) profundidad++;
    else if (texto[fin] === cierra && --profundidad === 0) break;
  }
  return texto.slice(inicio, fin);
}

/** Las líneas (1-based) de los matches de `patron` fuera de un comentario cuyo cuerpo balanceado NO lleva el filtro de sucursal. */
function sinFiltro(fuente: string, patron: RegExp, abre: "(" | "{", cierra: ")" | "}"): number[] {
  const texto = fuente.replace(/\r\n/g, "\n");
  const lineas = texto.split("\n");
  const malas: number[] = [];
  for (const m of texto.matchAll(new RegExp(patron.source, "g"))) {
    const linea = texto.slice(0, m.index).split("\n").length;
    if (esComentario(lineas[linea - 1])) continue;
    if (!cuerpoBalanceado(texto, m.index, abre, cierra).includes(FILTRO)) malas.push(linea);
  }
  return malas;
}

/** C2/C3 (ADR-009): lecturas directas de modelos PROPIOS de la sucursal sin `whereCartaDeSucursal(` dentro de sus propios paréntesis. */
function lecturasSinFiltroDeSucursal(fuente: string): number[] {
  return sinFiltro(fuente, LECTURA_DE_SUCURSAL, "(", ")");
}

/** Lecturas por la relación del producto (`contenidosCarta: {…}`) sin el filtro de sucursal dentro de sus propias llaves. */
function relacionesSinFiltroDeSucursal(fuente: string): number[] {
  return sinFiltro(fuente, RELACION_DE_PRODUCTO, "{", "}");
}

describe("estructura de carta: los lectores están inventariados", () => {
  const rutas = archivos(RAIZ);
  const porNombre = new Map(rutas.map((r) => [relative(RAIZ, r).split(sep).join("/"), r]));

  it("encuentra archivos de src/", () => {
    expect(rutas.length).toBeGreaterThan(50);
  });

  it("ningún archivo fuera del inventario lee los modelos de estructura de carta directo", () => {
    const problemas: string[] = [];
    for (const [nombre, ruta] of porNombre) {
      if (ARCHIVOS_PERMITIDOS.includes(nombre)) continue;
      for (const linea of lineasQueLeenEstructura(readFileSync(ruta, "utf8"))) problemas.push(`${nombre}:${linea}`);
    }
    expect(
      problemas,
      `Estas líneas leen la estructura de la carta fuera del inventario (agregá el archivo a ARCHIVOS_PERMITIDOS a propósito, o usá las consultas de core/carta):\n${problemas.join("\n")}`
    ).toEqual([]);
  });

  it("los archivos del inventario existen y todos leen algún modelo (la lista no quedó desactualizada)", () => {
    for (const permitido of ARCHIVOS_PERMITIDOS) {
      const ruta = porNombre.get(permitido);
      expect(ruta, `${permitido} ya no existe: actualizá la lista`).toBeDefined();
      expect(lineasQueLeenEstructura(readFileSync(ruta!, "utf8")).length, `${permitido} ya no lee estos modelos: sacalo de la lista`).toBeGreaterThan(0);
    }
  });

  it("cada lectura directa de un modelo propio de la sucursal filtra con whereCartaDeSucursal (C3)", () => {
    const problemas: string[] = [];
    for (const permitido of ARCHIVOS_PERMITIDOS) {
      for (const linea of lecturasSinFiltroDeSucursal(readFileSync(porNombre.get(permitido)!, "utf8"))) problemas.push(`${permitido}:${linea}`);
    }
    expect(problemas, `Estas lecturas no llevan ...whereCartaDeSucursal(sucursalId) en su where:\n${problemas.join("\n")}`).toEqual([]);
  });

  it("cada lectura por la relación del producto (contenidosCarta / opcionesItemAgrupadoCarta) filtra con whereCartaDeSucursal (C3)", () => {
    const problemas: string[] = [];
    for (const [nombre, ruta] of porNombre) {
      for (const linea of relacionesSinFiltroDeSucursal(readFileSync(ruta, "utf8"))) problemas.push(`${nombre}:${linea}`);
    }
    expect(problemas, `Estas relaciones del producto hacia la carta no llevan whereCartaDeSucursal(sucursalId):\n${problemas.join("\n")}`).toEqual([]);
  });

  describe("el detector de filtro por sucursal (con fuentes sintéticas)", () => {
    it("acepta una lectura con el filtro, en una o en varias líneas", () => {
      const fuente = [
        "await db.generoCarta.findMany({ where: { activo: true, ...whereCartaDeSucursal(sucursalId) } });",
        "await db.itemAgrupadoCarta.findMany({",
        "  where: { activo: true, ...whereCartaDeSucursal(sucursalId) },",
        "  select: { id: true },",
        "});",
      ].join("\n");
      expect(lecturasSinFiltroDeSucursal(fuente)).toEqual([]);
    });

    it("marca la lectura sin filtro, aunque otra lectura del archivo sí lo tenga", () => {
      const fuente = [
        "await db.contenidoCartaProducto.findMany({ where: { ...whereCartaDeSucursal(sucursalId) } });",
        "await db.generoCarta.findMany({ where: { activo: true } });",
        "await db.opcionItemAgrupadoCarta.findFirst({",
        "  where: { productoId },",
        "});",
        "const otra = whereCartaDeSucursal(sucursalId);",
      ].join("\n");
      expect(lecturasSinFiltroDeSucursal(fuente)).toEqual([2, 3]);
    });

    it("una variable con el filtro armado afuera NO alcanza: el filtro va a la vista, dentro de la lectura", () => {
      const fuente = ["const propia = whereCartaDeSucursal(sucursalId);", "await db.contenidoCartaProducto.count({ where: propia });"].join("\n");
      expect(lecturasSinFiltroDeSucursal(fuente)).toEqual([2]);
    });

    it("SeccionCarta (de la empresa) NO exige el filtro: es la excepción a propósito", () => {
      expect(lecturasSinFiltroDeSucursal("await db.seccionCarta.findMany({ where: { activa: true } });")).toEqual([]);
    });

    it("no marca un comentario", () => {
      expect(lecturasSinFiltroDeSucursal("// db.generoCarta.findMany({ where: {} })")).toEqual([]);
    });
  });

  describe("el detector de relaciones del producto (con fuentes sintéticas)", () => {
    it("acepta la relación con el filtro (where, some o none), en una o en varias líneas", () => {
      const fuente = [
        "select: { contenidosCarta: { where: whereCartaDeSucursal(sucursalId), take: 1 } }",
        "where: { opcionesItemAgrupadoCarta: { none: whereCartaDeSucursal(sucursalId) } }",
        "where: {",
        "  contenidosCarta: { some: { ...whereCartaDeSucursal(sucursalId), visibleEnCarta: true } },",
        "}",
      ].join("\n");
      expect(relacionesSinFiltroDeSucursal(fuente)).toEqual([]);
    });

    it("marca la relación sin filtro, aunque otra del archivo sí lo tenga", () => {
      const fuente = [
        "select: { contenidosCarta: { where: whereCartaDeSucursal(sucursalId) } }",
        "select: { contenidosCarta: { take: 1 } }",
        "where: { opcionesItemAgrupadoCarta: { some: { productoId } } }",
      ].join("\n");
      expect(relacionesSinFiltroDeSucursal(fuente)).toEqual([2, 3]);
    });

    it("un `_count` o un acceso al arreglo no es una lectura de filas", () => {
      const fuente = ["_count: { select: { contenidosCarta: true } }", "const c = p.contenidosCarta[0];", "// contenidosCarta: { take: 1 }"].join("\n");
      expect(relacionesSinFiltroDeSucursal(fuente)).toEqual([]);
    });
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
