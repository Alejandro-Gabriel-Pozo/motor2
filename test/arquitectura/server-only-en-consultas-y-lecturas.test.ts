import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * `import "server-only"` en las consultas y las lecturas del servidor (Pureza, auditoría de la Fase 3: 39 de 67 archivos de `server/consultas` y `server/lecturas` no lo llevan y ningún test
 * decía cuáles debían llevarlo). `server-only` hace fallar el BUILD si un componente de cliente llega a importar el archivo: es la red de seguridad de que una lectura con la base nunca viaje
 * al navegador. Algunos lo omiten a propósito porque los alcanza (directa o transitivamente) un script con `tsx`, un spec de Playwright o `prisma/`, donde `server-only` revienta; el resto (19 de los 40 que no lo tenían, 2026-10-08) lo recibió en la auditoría del Hito 1.
 *
 * Regla: todo archivo de `src/server/consultas/**` y `src/server/lecturas/**` abre con `import "server-only"`, salvo los de `SIN_SERVER_ONLY` (cada uno con el punto de entrada que lo alcanza). La lista solo se achica:
 * un archivo nuevo que no lleve `server-only` falla hasta que se lo agregue acá con su motivo, y una entrada cuyo archivo ya lo lleva (o ya no existe) también falla. Por AST: un comentario no cuenta.
 */
const RAIZ = join(__dirname, "..", "..");
/** Cada archivo que NO lleva `import "server-only"` y por qué: lo alcanza, directa o transitivamente, un punto de entrada que no corre bajo Next ni bajo Vitest (un script con `tsx`, un spec de Playwright o `prisma/`), donde `server-only` revienta. El valor es ese punto de entrada. */
export const SIN_SERVER_ONLY: Record<string, string> = {
  "src/server/consultas/reportes/costo-historico.ts": "scripts/verificar-demo-invariantes.ts",
  "src/server/consultas/reportes/historial-producto.ts": "scripts/auditoria-benchmark-reportes.ts",
  "src/server/consultas/reportes/margen-objetivo-consulta.ts": "scripts/verificar-demo-invariantes.ts",
  "src/server/consultas/reportes/margen-real.ts": "scripts/verificar-demo-invariantes.ts",
  "src/server/consultas/reportes/periodo-margen.ts": "scripts/verificar-demo-invariantes.ts",
  "src/server/consultas/reportes/periodo-precios.ts": "scripts/verificar-demo-invariantes.ts",
  "src/server/consultas/reportes/periodo-ratio.ts": "scripts/verificar-demo-invariantes.ts",
  "src/server/consultas/reportes/periodo.ts": "scripts/verificar-demo-invariantes.ts",
  "src/server/consultas/reportes/rendimiento-recetas.ts": "scripts/seed-demo-pizzeria.ts",
  "src/server/consultas/reportes/valuacion.ts": "scripts/verificar-demo-invariantes.ts",
  "src/server/lecturas/carta/descuentos.ts": "test/e2e/fixtures/carta-menu.ts",
  "src/server/lecturas/carta/empresa.ts": "test/e2e/carta-portal-admin.spec.ts",
  "src/server/lecturas/carta/menu.ts": "test/e2e/fixtures/carta-menu.ts",
  "src/server/lecturas/carta/publica.ts": "test/e2e/carta-portal-admin.spec.ts",
  "src/server/lecturas/catalogo/disponibilidad.ts": "test/e2e/conteo-fisico-grilla.spec.ts",
  "src/server/lecturas/catalogo/ofertas-de-proveedor.ts": "scripts/verificar-demo-invariantes.ts",
  "src/server/lecturas/catalogo/precio-local.ts": "test/e2e/fixtures/carta-menu.ts",
  "src/server/lecturas/catalogo/recetas-vigentes.ts": "scripts/verificar-demo-invariantes.ts",
  "src/server/lecturas/movimientos/saldos.ts": "test/e2e/conteo-fisico-grilla.spec.ts",
  "src/server/lecturas/reportes/comun.ts": "scripts/verificar-demo-invariantes.ts",
  "src/server/lecturas/reportes/costos.ts": "scripts/verificar-demo-invariantes.ts",
  "src/server/lecturas/reportes/serie-ipc.ts": "scripts/verificar-demo-invariantes.ts",
};

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
