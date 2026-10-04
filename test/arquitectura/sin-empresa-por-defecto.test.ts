import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ADR-022: ninguna parte del sistema depende de «la única empresa ACTIVE» como empresa por defecto. La función SQL `app_empresa_actual()` devuelve solo la empresa que fija el
 * pedido; sin contexto es NULL (el DEFAULT NOT NULL falla y el RLS no muestra nada). Este test vigila que el código no vuelva a apoyarse en el respaldo:
 *
 *  (a) Un archivo que importa el cliente global (`src/lib/db`) no toca con él una tabla por empresa (`prisma.<modelo>.`): para eso están `dbDeEmpresa`/`transaccionDeEmpresa`.
 *      Vale para `src/`, `plataforma/src/`, `scripts/` y `prisma/seed.ts`. Excepciones declaradas abajo, con motivo.
 *  (b) Los módulos que usan `baseDelContexto()` (los crons) solo tocan modelos globales.
 *  (c) El preset de empresa en una conexión (`-c app.empresa_id=…`) existe en UN solo archivo: `test/setup/empresa-de-prueba.ts`.
 *  (d) Nada fija un contexto de sesión (`set_config(…, false)`) ni lo guarda en la base (`ALTER ROLE/DATABASE … SET app.…`).
 *
 * Los modelos «por empresa» se descubren del schema (los que tienen un campo `empresaId`): una tabla nueva queda cubierta sola.
 */
const RAIZ = join(__dirname, "../..");

/** archivo → por qué puede tocar una tabla por empresa con el cliente global. */
const EXCEPCIONES_A: Record<string, string> = {
  "scripts/verificar-demo-invariantes.ts": "solo LEE, como dueño sobre la base de la demo (el dueño salta el RLS): no escribe y no depende del DEFAULT de empresaId.",
};

function archivosDe(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next") continue;
    const ruta = join(dir, e);
    if (statSync(ruta).isDirectory()) archivosDe(ruta, salida);
    else if (/\.(ts|tsx|cjs|mjs)$/.test(e)) salida.push(ruta);
  }
  return salida;
}

const rel = (ruta: string) => relative(RAIZ, ruta).replace(/\\/g, "/");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Modelos del schema con un campo `empresaId`, como el nombre del delegado de Prisma (primera letra en minúscula). */
function modelosPorEmpresa(schema: string): string[] {
  const modelos: string[] = [];
  for (const m of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    if (/^\s+empresaId\s+String\b/m.test(m[2])) modelos.push(m[1].charAt(0).toLowerCase() + m[1].slice(1));
  }
  return modelos;
}

const IMPORTA_CLIENTE_GLOBAL = /import\s*\{[^}]*\bprisma\b[^}]*\}\s*from\s*["'](?:@\/lib\/db|(?:\.\.?\/)+(?:src\/)?lib\/db)["']/;

/** Las líneas `prisma.<modelo por empresa>.` (cliente global) de un archivo que importa el cliente global. */
function usosDelClienteGlobal(fuente: string, modelos: string[]): string[] {
  const t = sinComentarios(fuente);
  if (!IMPORTA_CLIENTE_GLOBAL.test(t)) return [];
  const patron = new RegExp(`\\bprisma\\s*\\.\\s*(${modelos.join("|")})\\b`, "g");
  return [...t.matchAll(patron)].map((m) => m[0].replace(/\s+/g, ""));
}

/** Los accesos `<algo>.<modelo por empresa>.` de un archivo que usa `baseDelContexto(`. */
function modelosPorEmpresaDeUnCron(fuente: string, modelos: string[]): string[] {
  const t = sinComentarios(fuente);
  if (!/\bbaseDelContexto\s*\(/.test(t)) return [];
  const patron = new RegExp(`\\.\\s*(${modelos.join("|")})\\s*\\.\\s*(?:find|create|update|upsert|delete|count|aggregate|group)\\w*`, "g");
  return [...t.matchAll(patron)].map((m) => m[0].replace(/\s+/g, ""));
}

const PRESET_DE_EMPRESA = /-c\s+app\.(?:empresa_id|usuario_id|invitacion_hash)/;
const CONTEXTO_DE_SESION = /set_config\s*\(\s*'app\.[a-z_]+'\s*,[^)]*,\s*false\s*\)|ALTER\s+(?:ROLE|DATABASE)\b[^;]*\bSET\s+app\./i;

const schema = readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8");
const MODELOS = modelosPorEmpresa(schema);

const ARCHIVOS_DE_CODIGO = [...archivosDe(join(RAIZ, "src")), ...archivosDe(join(RAIZ, "plataforma/src")), ...archivosDe(join(RAIZ, "scripts")), join(RAIZ, "prisma/seed.ts")];
const TODOS = [...ARCHIVOS_DE_CODIGO, ...archivosDe(join(RAIZ, "test")), ...archivosDe(join(RAIZ, "prisma"))];

describe("sin empresa por defecto (ADR-022)", () => {
  it("los modelos por empresa se descubren del schema (sanidad: no pasa en vacío)", () => {
    expect(MODELOS.length).toBeGreaterThan(40);
    expect(MODELOS).toEqual(expect.arrayContaining(["producto", "sucursal", "invitacion", "moduloEmpresa", "usuarioEmpresa"]));
    expect(MODELOS).not.toContain("empresa");
    expect(MODELOS).not.toContain("user");
  });

  it("(a) ningún archivo toca una tabla por empresa con el cliente global importado de lib/db", () => {
    const problemas = ARCHIVOS_DE_CODIGO.filter((a) => !(rel(a) in EXCEPCIONES_A)).flatMap((a) => usosDelClienteGlobal(readFileSync(a, "utf8"), MODELOS).map((u) => `${rel(a)}: ${u}`));
    expect(problemas, "usá dbDeEmpresa/transaccionDeEmpresa/baseDeEmpresa (ADR-022)").toEqual([]);
  });

  it("(b) los crons (baseDelContexto) solo tocan modelos globales", () => {
    const problemas = ARCHIVOS_DE_CODIGO.flatMap((a) => modelosPorEmpresaDeUnCron(readFileSync(a, "utf8"), MODELOS).map((u) => `${rel(a)}: ${u}`));
    expect(problemas).toEqual([]);
  });

  it("(c) el preset de empresa en la conexión (-c app.empresa_id=…) vive solo en test/setup/empresa-de-prueba.ts", () => {
    const usos = TODOS.filter((a) => !rel(a).endsWith("sin-empresa-por-defecto.test.ts") && PRESET_DE_EMPRESA.test(sinComentarios(readFileSync(a, "utf8")))).map(rel);
    expect(usos).toEqual(["test/setup/empresa-de-prueba.ts"]);
  });

  it("(d) nada fija el contexto de sesión ni lo guarda en la base (set_config(…, false), ALTER ROLE/DATABASE … SET app.…)", () => {
    const usos = TODOS.filter((a) => !rel(a).endsWith("sin-empresa-por-defecto.test.ts") && !rel(a).includes("/migrations/") && CONTEXTO_DE_SESION.test(sinComentarios(readFileSync(a, "utf8")))).map(rel);
    expect(usos, "el contexto va en la transacción (set_config(…, true)), nunca en la sesión ni en la base").toEqual([]);
  });

  describe("los detectores (con fuentes sintéticas)", () => {
    const modelos = ["producto", "sucursal"];
    const conImport = 'import { prisma } from "@/lib/db";\n';

    it("(a) marca prisma.<modelo por empresa> solo si el archivo importa el cliente global, y no marca tablas globales ni comentarios", () => {
      expect(usosDelClienteGlobal(`${conImport}await prisma.producto.findMany();`, modelos)).toEqual(["prisma.producto"]);
      expect(usosDelClienteGlobal(`${conImport}await prisma.user.findMany();`, modelos)).toEqual([]);
      expect(usosDelClienteGlobal(`${conImport}// prisma.producto.findMany()`, modelos)).toEqual([]);
      expect(usosDelClienteGlobal("const prisma = dbDeEmpresa(id);\nawait prisma.producto.findMany();", modelos)).toEqual([]);
      expect(usosDelClienteGlobal('import { prisma } from "../src/lib/db";\nawait prisma.sucursal.create({});', modelos)).toEqual(["prisma.sucursal"]);
    });

    it("(b) marca el acceso a un modelo por empresa en un archivo con baseDelContexto()", () => {
      expect(modelosPorEmpresaDeUnCron("const { db } = baseDelContexto();\nawait db.producto.findMany();", modelos)).toEqual([".producto.findMany"]);
      expect(modelosPorEmpresaDeUnCron("const { db } = baseDelContexto();\nawait db.cotizacionDolar.findMany();", modelos)).toEqual([]);
      expect(modelosPorEmpresaDeUnCron("await db.producto.findMany();", modelos)).toEqual([]);
    });

    it("(c) y (d) reconocen el preset y el contexto de sesión", () => {
      expect(PRESET_DE_EMPRESA.test("options: `-c app.empresa_id=${id}`")).toBe(true);
      expect(PRESET_DE_EMPRESA.test("-c statement_timeout=5000")).toBe(false);
      expect(CONTEXTO_DE_SESION.test("SELECT set_config('app.empresa_id', 'x', false)")).toBe(true);
      expect(CONTEXTO_DE_SESION.test("SELECT set_config('app.empresa_id', 'x', true)")).toBe(false);
      expect(CONTEXTO_DE_SESION.test("ALTER ROLE motor2_app SET app.empresa_id = 'x'")).toBe(true);
    });
  });
});
