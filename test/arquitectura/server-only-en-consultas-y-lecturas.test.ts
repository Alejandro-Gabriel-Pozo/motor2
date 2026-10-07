import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * `import "server-only"` en las consultas y las lecturas del servidor (Pureza, auditoría de la Fase 3: 39 de 67 archivos de `server/consultas` y `server/lecturas` no lo llevan y ningún test
 * decía cuáles debían llevarlo). `server-only` hace fallar el BUILD si un componente de cliente llega a importar el archivo: es la red de seguridad de que una lectura con la base nunca viaje
 * al navegador. Algunos archivos lo omiten a propósito porque los importan scripts con `tsx` y los e2e de Playwright, donde `server-only` revienta (plan de la Fase 3, §7).
 *
 * Regla: todo archivo de `src/server/consultas/**` y `src/server/lecturas/**` abre con `import "server-only"`, salvo los de `SIN_SERVER_ONLY` (los de hoy, congelados). La lista solo se achica:
 * un archivo nuevo que no lleve `server-only` falla hasta que se lo agregue acá con su motivo, y una entrada cuyo archivo ya lo lleva (o ya no existe) también falla. Por AST: un comentario no cuenta.
 */
const RAIZ = join(__dirname, "..", "..");
const MOTIVO = 'Sin `import "server-only"` desde antes de esta regla (plan de la Fase 3, §7: los importan scripts con tsx y los e2e de Playwright). Congelado: la lista solo se achica.';
export const SIN_SERVER_ONLY: Record<string, string> = Object.fromEntries(
  [
    "src/server/consultas/movimientos/stock-para-conteo.ts",
    "src/server/consultas/reportes/compras-registradas.ts",
    "src/server/consultas/reportes/consignacion.ts",
    "src/server/consultas/reportes/costo-historico.ts",
    "src/server/consultas/reportes/cotizacion-dolar.ts",
    "src/server/consultas/reportes/descuentos-clientes.ts",
    "src/server/consultas/reportes/descuentos-productos.ts",
    "src/server/consultas/reportes/devoluciones.ts",
    "src/server/consultas/reportes/diferencias-ajustes.ts",
    "src/server/consultas/reportes/historial-producto.ts",
    "src/server/consultas/reportes/huecos-catalogo.ts",
    "src/server/consultas/reportes/insumos-sin-receta.ts",
    "src/server/consultas/reportes/margen-objetivo-consulta.ts",
    "src/server/consultas/reportes/margen-promociones.ts",
    "src/server/consultas/reportes/margen-real.ts",
    "src/server/consultas/reportes/perdidas.ts",
    "src/server/consultas/reportes/periodo-margen.ts",
    "src/server/consultas/reportes/periodo-precios.ts",
    "src/server/consultas/reportes/periodo-ratio.ts",
    "src/server/consultas/reportes/periodo.ts",
    "src/server/consultas/reportes/rendimiento-recetas.ts",
    "src/server/consultas/reportes/resumen-consolidado.ts",
    "src/server/consultas/reportes/resumen-operativo.ts",
    "src/server/consultas/reportes/rotacion-mesas.ts",
    "src/server/consultas/reportes/tickets-emitidos.ts",
    "src/server/consultas/reportes/trazabilidad.ts",
    "src/server/consultas/reportes/valuacion.ts",
    "src/server/consultas/reportes/vencimientos.ts",
    "src/server/consultas/reportes/ventas-sin-receta.ts",
    "src/server/lecturas/carta/descuentos.ts",
    "src/server/lecturas/carta/empresa.ts",
    "src/server/lecturas/carta/menu.ts",
    "src/server/lecturas/carta/publica.ts",
    "src/server/lecturas/catalogo/ofertas-de-proveedor.ts", // lo importa scripts/verificar-demo-invariantes.ts (tsx): con server-only reventaría
    "src/server/lecturas/catalogo/disponibilidad.ts",
    "src/server/lecturas/catalogo/recetas-vigentes.ts",
    "src/server/lecturas/movimientos/saldos.ts",
    "src/server/lecturas/reportes/comun.ts",
    "src/server/lecturas/reportes/costos.ts",
    "src/server/lecturas/reportes/serie-ipc.ts",
  ].map((ruta) => [ruta, MOTIVO]),
);

/** ¿La PRIMERA sentencia del archivo es exactamente `import "server-only";`? */
export function abreConServerOnly(codigo: string): boolean {
  const primera = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, false).statements[0];
  return primera !== undefined && ts.isImportDeclaration(primera) && primera.importClause === undefined && ts.isStringLiteral(primera.moduleSpecifier) && primera.moduleSpecifier.text === "server-only";
}

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    return e.isDirectory() ? archivos(ruta) : /\.tsx?$/.test(e.name) ? [ruta] : [];
  });
}

describe("el detector de server-only ve la primera sentencia (un comentario no cuenta)", () => {
  it("abre con server-only / no", () => {
    expect(abreConServerOnly('import "server-only";\nexport const a = 1;')).toBe(true);
    expect(abreConServerOnly('// import "server-only";\nexport const a = 1;')).toBe(false);
    expect(abreConServerOnly('export const a = 1;\nimport "server-only";')).toBe(false);
    expect(abreConServerOnly('import { x } from "server-only";')).toBe(false);
  });
});

describe("server/consultas y server/lecturas abren con server-only, salvo la lista congelada", () => {
  const todos = ["consultas", "lecturas"].flatMap((capa) => archivos(join(RAIZ, "src", "server", capa))).map((a) => relative(RAIZ, a).split(sep).join("/"));
  const sinServerOnly = (ruta: string) => !abreConServerOnly(readFileSync(join(RAIZ, ruta), "utf8"));

  it("encuentra los archivos (si no, la regla está vacía)", () => {
    expect(todos.length).toBeGreaterThan(50);
  });

  it("ninguno omite server-only sin estar en SIN_SERVER_ONLY", () => {
    const infractores = todos.filter((ruta) => sinServerOnly(ruta) && !(ruta in SIN_SERVER_ONLY));
    expect(infractores, `Abrí el archivo con \`import "server-only";\` (o, si lo importan scripts o Playwright, agregalo a SIN_SERVER_ONLY con su motivo):\n${infractores.join("\n")}`).toEqual([]);
  });

  it("toda entrada de la lista sigue haciendo falta (al agregarle server-only a un archivo, se saca de acá)", () => {
    const sobran = Object.keys(SIN_SERVER_ONLY).filter((ruta) => !todos.includes(ruta) || !sinServerOnly(ruta));
    expect(sobran, `Estos ya llevan server-only (o ya no existen): sacalos de SIN_SERVER_ONLY:\n${sobran.join("\n")}`).toEqual([]);
  });
});
