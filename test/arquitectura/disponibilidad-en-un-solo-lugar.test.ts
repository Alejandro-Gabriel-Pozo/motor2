import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §3, P12): "¿está este producto disponible en
 * esta sucursal?" tiene un solo lugar donde se escribe como filtro de Prisma — `whereDisponibleEn`/`whereDisponibleEnAlguna`
 * en `disponibilidad-producto-consulta.ts`, que arman `{ disponibilidades: { some: {...} } }` (el campo de relación
 * `Producto.disponibilidades` de schema.prisma). Si otro archivo reimplementa ese mismo fragmento a mano, puede divergir en
 * silencio del criterio real ("fila ausente = no disponible" — ver el docstring de disponibilidad-producto.ts) sin que
 * ningún tipo lo detecte: TypeScript no distingue "el where correcto" de "uno parecido pero mal" — los dos tipan igual.
 *
 * Esto NO alcanza a `prisma.disponibilidadProducto.*` en general (findMany/upsert/groupBy/createMany siguen apareciendo, a
 * propósito, en `actualizarDisponibilidadProducto`/`sincronizarActivoGlobal` (productos.ts), `crearSucursalConAdmin`
 * (sucursales.ts, P5b) y `listarProductosPagina` (P10, el conteo de la columna "Sucursales") — leer/escribir la tabla
 * directo es su trabajo real). Lo único que tiene que vivir en un solo lugar es el FILTRO "disponible acá", porque ES la
 * pieza que puede reimplementarse sutilmente mal.
 *
 * Cómo se controla: ningún archivo de `src/`, salvo `disponibilidad-producto-consulta.ts`, puede contener la cadena
 * literal `disponibilidades:` fuera de un comentario.
 */
const RAIZ = join(__dirname, "../../src");
const ARCHIVO_PERMITIDO = "core/catalogo/disponibilidad-producto-consulta.ts";

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

/** Las líneas (1-based) que escriben `disponibilidades:` fuera de un comentario. */
function lineasConDisponibilidadesAMano(fuente: string): number[] {
  const lineas = fuente.replace(/\r\n/g, "\n").split("\n");
  const malas: number[] = [];
  lineas.forEach((linea, i) => {
    if (esComentario(linea)) return;
    if (/disponibilidades:/.test(linea)) malas.push(i + 1);
  });
  return malas;
}

describe("disponibilidad de producto: un solo lugar escribe el filtro { disponibilidades: { some: ... } }", () => {
  const rutas = archivos(RAIZ);

  it("encuentra archivos de src/", () => {
    expect(rutas.length).toBeGreaterThan(50);
  });

  it("ningún archivo fuera de disponibilidad-producto-consulta.ts escribe `disponibilidades:` a mano", () => {
    const problemas: string[] = [];
    for (const ruta of rutas) {
      const nombre = relative(RAIZ, ruta).split(sep).join("/");
      if (nombre === ARCHIVO_PERMITIDO) continue;
      for (const linea of lineasConDisponibilidadesAMano(readFileSync(ruta, "utf8"))) problemas.push(`${nombre}:${linea}`);
    }
    expect(
      problemas,
      `Estas líneas escriben el filtro { disponibilidades: { some: ... } } a mano, fuera de disponibilidad-producto-consulta.ts ` +
        `(usá whereDisponibleEn/whereDisponibleEnAlguna en vez de reimplementarlo):\n${problemas.join("\n")}`
    ).toEqual([]);
  });

  it("construirMapaProductos resuelve `disponible` sin sucursal con disponibilidadEnAlgunaSucursal, no con un `true` fijo (R2, 2026-10-01)", () => {
    const fuente = readFileSync(join(RAIZ, "server/lecturas/reportes/comun.ts"), "utf8").replace(/\r\n/g, "\n");
    expect(fuente).toMatch(/disponibilidadEnAlgunaSucursal\(/);
    const fijas = fuente.split("\n").filter((l) => !esComentario(l) && /\bdisponible:\s*.*:\s*true\b/.test(l));
    expect(fijas, "`disponible` volvió a tener una rama con `true` fijo: sin sucursal debe ser «en alguna sucursal»").toEqual([]);
  });

  describe("el detector (con fuentes sintéticas)", () => {
    it("marca un where que reimplementa el filtro a mano", () => {
      const fuente = ["const where = {", "  disponibilidades: { some: { sucursalId, disponible: true } },", "};"].join("\n");
      expect(lineasConDisponibilidadesAMano(fuente)).toEqual([2]);
    });

    it("no marca un comentario que solo menciona el campo", () => {
      const fuente = "// disponibilidades: se resuelve en disponibilidad-producto-consulta.ts, no acá.";
      expect(lineasConDisponibilidadesAMano(fuente)).toEqual([]);
    });

    it("no marca el uso legítimo de whereDisponibleEn/whereDisponibleEnAlguna — no contienen la cadena", () => {
      const fuente = 'const where = { ...whereDisponibleEn(sucursalId), nombre: "x" };';
      expect(lineasConDisponibilidadesAMano(fuente)).toEqual([]);
    });
  });
});
