import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura: "¿qué precio local rige en esta sucursal?" se decide en UN solo lugar — `preciosLocalesVigentes`
 * (`core/catalogo/precio-local-consulta.ts`), que combina la capacidad `precio_local` de la sucursal con la fila habilitada. Un
 * lector que consulte `PrecioLocalProducto` por su cuenta se salta la capacidad: la sucursal que la tiene apagada seguiría
 * cobrando (y mostrando) el precio local, y TypeScript no lo detecta — los dos tipan igual.
 *
 * Lo que sí puede leer la tabla cruda: el CRUD administrativo (`server/actions/movimientos/precio-local.ts`: lista las filas, con capacidad
 * apagada o no; desde el Hito 4, H4C-4, la escritura y la lectura de la fila ANTERIOR para la auditoría viven en `server/persistencia/movimientos/precio-local.ts`)
 * y el reporte de la comparativa de precios (`core/reportes/periodo-precios.ts`, que solo traduce el id de una fila auditada a su producto, sin leer ningún
 * precio).
 *
 * Lo mismo vale para la capacidad: "¿rige el precio propio de la sucursal?" (R1, 2026-10-01: también gobierna el precio local de las promos y los
 * descuentos de producto) se pregunta con `precioLocalActivoEn`, el único lugar que consulta la capacidad `precio_local` para decidir un precio.
 *
 * Cómo se controla: ningún otro archivo de `src/` puede llamar `precioLocalProducto.find*` ni `sucursalTieneCapacidad(…, "precio_local", …)`
 * fuera de un comentario.
 */
const RAIZ = join(__dirname, "../../src");
const ARCHIVOS_PERMITIDOS = [
  "core/catalogo/precio-local-consulta.ts",
  "server/actions/movimientos/precio-local.ts",
  "server/persistencia/movimientos/precio-local.ts",
  "server/consultas/reportes/periodo-precios.ts",
];

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

/** Las líneas (1-based) que leen `precioLocalProducto` (find*) fuera de un comentario. */
function lineasQueLeenPrecioLocalDirecto(fuente: string): number[] {
  const malas: number[] = [];
  fuente
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((linea, i) => {
      if (esComentario(linea)) return;
      if (/precioLocalProducto\s*\.\s*find/.test(linea)) malas.push(i + 1);
    });
  return malas;
}

const LECTURA_DE_CAPACIDAD = /sucursalTieneCapacidad\s*\([^)]*["']precio_local["']/;

/** Las líneas (1-based) que consultan la capacidad `precio_local` con `sucursalTieneCapacidad` fuera de un comentario. */
function lineasQueLeenCapacidadPrecioLocal(fuente: string): number[] {
  const malas: number[] = [];
  fuente
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((linea, i) => {
      if (esComentario(linea)) return;
      if (LECTURA_DE_CAPACIDAD.test(linea)) malas.push(i + 1);
    });
  return malas;
}

describe("precio local: un solo lugar decide cuál rige (capacidad + fila habilitada)", () => {
  const rutas = archivos(RAIZ);

  it("encuentra archivos de src/", () => {
    expect(rutas.length).toBeGreaterThan(50);
  });

  it("ningún archivo fuera de la lista permitida lee `precioLocalProducto.find*` directo", () => {
    const problemas: string[] = [];
    for (const ruta of rutas) {
      const nombre = relative(RAIZ, ruta).split(sep).join("/");
      if (ARCHIVOS_PERMITIDOS.includes(nombre)) continue;
      for (const linea of lineasQueLeenPrecioLocalDirecto(readFileSync(ruta, "utf8"))) problemas.push(`${nombre}:${linea}`);
    }
    expect(
      problemas,
      `Estas líneas leen PrecioLocalProducto a mano y se saltan la capacidad \`precio_local\` de la sucursal ` +
        `(usá preciosLocalesVigentes de core/catalogo/public-servidor):\n${problemas.join("\n")}`
    ).toEqual([]);
  });

  it("solo `precioLocalActivoEn` (core/catalogo/precio-local-consulta.ts) consulta la capacidad `precio_local` para decidir un precio", () => {
    const problemas: string[] = [];
    for (const ruta of rutas) {
      const nombre = relative(RAIZ, ruta).split(sep).join("/");
      if (nombre === "core/catalogo/precio-local-consulta.ts") continue;
      for (const linea of lineasQueLeenCapacidadPrecioLocal(readFileSync(ruta, "utf8"))) problemas.push(`${nombre}:${linea}`);
    }
    expect(
      problemas,
      `Estas líneas preguntan por la capacidad precio_local a mano; usá precioLocalActivoEn (core/catalogo/public-servidor) para que el precio local de la promo y el descuento no discrepen:\n${problemas.join("\n")}`
    ).toEqual([]);
    const fuente = readFileSync(join(RAIZ, "core/catalogo/precio-local-consulta.ts"), "utf8");
    expect(lineasQueLeenCapacidadPrecioLocal(fuente).length, "precio-local-consulta.ts ya no consulta la capacidad: ¿se movió?").toBeGreaterThan(0);
  });

  it("los archivos permitidos existen (la lista no quedó desactualizada)", () => {
    const existentes = new Set(rutas.map((r) => relative(RAIZ, r).split(sep).join("/")));
    for (const permitido of ARCHIVOS_PERMITIDOS) expect(existentes.has(permitido), permitido).toBe(true);
  });

  describe("el detector (con fuentes sintéticas)", () => {
    it("marca una lectura directa de la tabla", () => {
      const fuente = ["const filas = await db.precioLocalProducto.findMany({", "  where: { sucursalId },", "});"].join("\n");
      expect(lineasQueLeenPrecioLocalDirecto(fuente)).toEqual([1]);
    });

    it("marca findUnique y findFirst, también sobre una transacción", () => {
      const fuente = ["await tx.precioLocalProducto.findUnique({});", "await prisma.precioLocalProducto . findFirst({});"].join("\n");
      expect(lineasQueLeenPrecioLocalDirecto(fuente)).toEqual([1, 2]);
    });

    it("no marca un comentario que menciona la lectura", () => {
      const fuente = "// antes: db.precioLocalProducto.findMany — ahora pasa por preciosLocalesVigentes.";
      expect(lineasQueLeenPrecioLocalDirecto(fuente)).toEqual([]);
    });

    it("marca la consulta directa de la capacidad precio_local (comillas dobles o simples) y no la de otra capacidad ni un comentario", () => {
      const fuente = [
        'const activa = await sucursalTieneCapacidad(sucursalId, "precio_local", db);',
        "const activa = await sucursalTieneCapacidad(sucursalId, 'precio_local', tx);",
        'const otra = await sucursalTieneCapacidad(sucursalId, "proceso_venta", db);',
        '// antes: sucursalTieneCapacidad(sucursalId, "precio_local", db)',
      ].join("\n");
      expect(lineasQueLeenCapacidadPrecioLocal(fuente)).toEqual([1, 2]);
    });

    it("no marca el uso legítimo del embudo ni las escrituras", () => {
      const fuente = ["const vigentes = await preciosLocalesVigentes(sucursalId, db);", "await tx.precioLocalProducto.upsert({});"].join("\n");
      expect(lineasQueLeenPrecioLocalDirecto(fuente)).toEqual([]);
    });
  });
});
