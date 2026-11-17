import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Guardián de E1-0 (`docs/diseno-e1-arbol-de-categorias-niveles-6-10-2026-11-17.md`, P4 y P7; H1 y H3 de `docs/inventario-lectores-clasificacion-e1-2026-11-17.md`): en los tests y los scripts,
 * las categorías se crean y se borran SOLO por `test/setup/categoria-de-prueba.ts`. Así, cuando la tabla exija `nombreClave` (E1-1), la clave la calcula un único lugar con la función de producción
 * (nadie la escribe a mano en ~45 sitios), y el borrado —que en producción no existe (las categorías se desactivan; dueño, 2026-11-17, «como pedernal»)— tiene un único camino explícito y solo local.
 *
 * Qué cuenta: una llamada `<algo>.categoriaProducto.<create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany>(…)` (por AST, no por texto, fuera de comentarios y cadenas) o el mismo delegado
 * suelto (`const { categoriaProducto } = prisma; categoriaProducto.create(…)`). Alcance: `test/`, `scripts/` y `prisma/seed.ts`. Fuera, a propósito: `src/` (la escritura de producción vive en
 * `src/server/persistencia/` y la vigila `escrituras-solo-en-persistencia`).
 *
 * LÍMITES (honestos): no ve el SQL crudo (`$executeRaw`, un `INSERT INTO "CategoriaProducto"` armado como texto: hoy solo hay dos, dentro de una prueba que muta un SQL de solo lectura) ni una llamada por
 * un delegado con otro nombre (`const c = prisma["categoriaProducto"]`). Es una alarma para errores honestos, no un límite de seguridad.
 */
const RAIZ = join(__dirname, "../..");
const CARPETAS = ["test", "scripts"];
const ARCHIVOS_SUELTOS = ["prisma/seed.ts"];
const EL_AYUDANTE = "test/setup/categoria-de-prueba.ts";
const ESCRITURAS = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"]);

interface Hallazgo {
  linea: number;
  llamada: string;
}

/** Las escrituras sobre `categoriaProducto` de un archivo (por AST). Exportada para probar el detector con violaciones inyectadas. */
function escriturasDeCategoria(codigo: string, ruta = "x.ts"): Hallazgo[] {
  const fuente = ts.createSourceFile(ruta, codigo, ts.ScriptTarget.Latest, true, ruta.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hallazgos: Hallazgo[] = [];
  const visitar = (nodo: ts.Node): void => {
    if (ts.isCallExpression(nodo) && ts.isPropertyAccessExpression(nodo.expression)) {
      const operacion = nodo.expression.name.text;
      const delegado = nodo.expression.expression;
      const esDelegado =
        (ts.isPropertyAccessExpression(delegado) && delegado.name.text === "categoriaProducto") || // x.categoriaProducto.create(…)
        (ts.isIdentifier(delegado) && delegado.text === "categoriaProducto"); // categoriaProducto.create(…) (desestructurado)
      if (esDelegado && ESCRITURAS.has(operacion)) {
        hallazgos.push({ linea: fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente)).line + 1, llamada: `categoriaProducto.${operacion}` });
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  return hallazgos;
}

function archivosDe(carpeta: string): string[] {
  const salida: string[] = [];
  const recorrer = (dir: string): void => {
    for (const nombre of readdirSync(dir)) {
      if (nombre === "node_modules" || nombre.startsWith(".")) continue;
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (/\.(ts|tsx)$/.test(nombre)) salida.push(relative(RAIZ, ruta).split(sep).join("/"));
    }
  };
  recorrer(join(RAIZ, carpeta));
  return salida;
}

describe("categorías de prueba: solo por el ayudante (E1-0)", () => {
  it("ningún test ni script crea ni borra categorías por fuera de `test/setup/categoria-de-prueba.ts`", () => {
    const archivos = [...CARPETAS.flatMap(archivosDe), ...ARCHIVOS_SUELTOS].filter((f) => f !== EL_AYUDANTE);
    const infracciones = archivos.flatMap((f) => escriturasDeCategoria(readFileSync(join(RAIZ, f), "utf8"), f).map((h) => `${f}:${h.linea} ${h.llamada}`));
    expect(infracciones, `Usá crearCategoriaDeTest / crearCategoriasDeTest / limpiarCategoriasDeTest de test/setup/categoria-de-prueba.ts:\n${infracciones.join("\n")}`).toEqual([]);
  });

  it("el ayudante existe y es el que toca la tabla", () => {
    const hallazgos = escriturasDeCategoria(readFileSync(join(RAIZ, EL_AYUDANTE), "utf8"), EL_AYUDANTE);
    expect(hallazgos.map((h) => h.llamada).sort()).toEqual(["categoriaProducto.create", "categoriaProducto.createMany", "categoriaProducto.deleteMany"]);
  });

  describe("el detector ve cada forma de escribir (violaciones inyectadas)", () => {
    it.each([
      ["create", "await prisma.categoriaProducto.create({ data: { nombre: 'x' } });"],
      ["createMany", "await prismaAdmin.categoriaProducto.createMany({ data: [] });"],
      ["upsert", "await tx.categoriaProducto.upsert({ where: { id: 'a' }, create: {}, update: {} });"],
      ["update", "await db.categoriaProducto.update({ where: { id: 'a' }, data: {} });"],
      ["updateMany", "await db.categoriaProducto.updateMany({ data: {} });"],
      ["delete", "await db.categoriaProducto.delete({ where: { id: 'a' } });"],
      ["deleteMany", "await prisma.categoriaProducto.deleteMany();"],
      ["desestructurado", "const { categoriaProducto } = prisma; await categoriaProducto.create({ data: {} });"],
    ])("%s", (_nombre, codigo) => {
      expect(escriturasDeCategoria(codigo)).toHaveLength(1);
    });

    it("las lecturas, los comentarios y las cadenas no cuentan", () => {
      const codigo = [
        "await prisma.categoriaProducto.findMany();",
        "await prisma.categoriaProducto.count();",
        "// prisma.categoriaProducto.create({ data: {} })",
        'const sql = "INSERT INTO \\"CategoriaProducto\\" VALUES (1)"; const t = "prisma.categoriaProducto.deleteMany()";',
        "await prisma.producto.create({ data: {} });",
      ].join("\n");
      expect(escriturasDeCategoria(codigo)).toEqual([]);
    });
  });
});
