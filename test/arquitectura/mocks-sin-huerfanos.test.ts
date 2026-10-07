import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Todo `vi.mock("<ruta>")`, `vi.doMock`, `vi.importActual("<ruta>")` e `importOriginal<typeof import("<ruta>")>` apunta a un archivo que EXISTE.
 *
 * Por qué: Vitest no se queja si el módulo que se mockea no existe; simplemente el mock queda sin efecto y la prueba corre contra el código REAL. Al mover un archivo
 * (la Fase 3 sacó el guard de `core/permisos`, la Fase 6 mueve la sesión: 161 `vi.mock` de `core/auth/session`), un mock que se queda con la ruta vieja deja un test
 * verde que ya no prueba lo que dice. Este guardián lo convierte en rojo.
 *
 * Solo rutas del proyecto (`@/…` y relativas): los paquetes de node_modules no se miran.
 */
const RAIZ = join(__dirname, "../..");
const SRC = join(RAIZ, "src");

function archivosDe(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    if (nombre === "node_modules" || nombre === ".next") return [];
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivosDe(ruta);
    return /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}

/** `vi.mock("x"`, `vi.doMock("x"`, `vi.importActual<…>("x"` / `vi.importActual("x"`, `importOriginal<typeof import("x")>`. */
const PATRONES: RegExp[] = [
  /\bvi\.(?:mock|doMock|unmock)\(\s*["'`]([^"'`]+)["'`]/g,
  /\bvi\.importActual(?:<[^>]*(?:<[^>]*>)?[^>]*>)?\(\s*["'`]([^"'`]+)["'`]/g,
  /\bimportOriginal<\s*typeof\s+import\(\s*["'`]([^"'`]+)["'`]\s*\)\s*>/g,
];

/** ¿La ruta apunta a un archivo del proyecto que existe (con extensión o como carpeta con index)? `null` si no es una ruta del proyecto. */
function existe(desde: string, especificador: string): boolean | null {
  const base = especificador.startsWith("@/") ? join(SRC, especificador.slice(2)) : especificador.startsWith(".") ? resolve(dirname(desde), especificador) : null;
  if (!base) return null;
  return [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, join(base, "index.ts"), join(base, "index.tsx")].some((c) => existsSync(c) && statSync(c).isFile());
}

/** Los especificadores de proyecto que el código mockea y no existen, con archivo y línea. */
function huerfanosDe(archivo: string, codigo: string): string[] {
  const encontrados: string[] = [];
  const sinComentarios = codigo.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:])\/\/[^\n]*/g, (_, p) => p);
  for (const patron of PATRONES) {
    for (const m of sinComentarios.matchAll(new RegExp(patron.source, patron.flags))) {
      const especificador = m[1]!;
      if (existe(archivo, especificador) === false) {
        const linea = sinComentarios.slice(0, m.index).split("\n").length;
        encontrados.push(`${relative(RAIZ, archivo).split(sep).join("/")}:${linea} mockea «${especificador}», que no existe`);
      }
    }
  }
  return encontrados;
}

describe("mocks sin huérfanos", () => {
  const esteArchivo = __filename;
  // `scripts/` también (Hito 3, paso 0.7): los seeds de la demo corren bajo Vitest y mockean la sesión y el limitador; L.2 mueve el limitador y un mock que se
  // queda con la ruta vieja dejaría al seed martillando el limitador real sin que nada lo diga.
  const archivos = [
    ...archivosDe(join(RAIZ, "test")),
    ...archivosDe(join(RAIZ, "src")).filter((f) => /\.(test|spec)\./.test(f)),
    ...archivosDe(join(RAIZ, "scripts")),
  ].filter((f) => f !== esteArchivo);

  it("se revisan archivos de test (si no, el guardián no mira nada)", () => {
    expect(archivos.length).toBeGreaterThan(300);
    const conMocks = archivos.filter((f) => /\bvi\.mock\(/.test(readFileSync(f, "utf8")));
    expect(conMocks.length).toBeGreaterThan(100);
  });

  it("se revisan los scripts que mockean (los seeds de la demo)", () => {
    const scriptsConMocks = archivos.filter((f) => relative(RAIZ, f).split(sep)[0] === "scripts" && /\bvi\.mock\(/.test(readFileSync(f, "utf8")));
    expect(scriptsConMocks.map((f) => relative(RAIZ, f).split(sep).join("/"))).toEqual(expect.arrayContaining(["scripts/seed-demo-pizzeria-6-meses.ts"]));
  });

  it("ningún vi.mock / importActual / importOriginal apunta a un archivo que no existe", () => {
    const huerfanos = archivos.flatMap((f) => huerfanosDe(f, readFileSync(f, "utf8")));
    expect(huerfanos, "Actualizá la ruta del mock (el archivo se movió) o borrá el mock:").toEqual([]);
  });

  it("el detector (con fuentes sintéticas)", () => {
    const aqui = join(RAIZ, "test/arquitectura/ejemplo.test.ts");
    expect(huerfanosDe(aqui, 'vi.mock("@/core/permisos/gate-que-no-existe", () => ({}));')).toHaveLength(1);
    expect(huerfanosDe(aqui, 'vi.mock("../../src/core/auth/session", () => ({}));')).toEqual([]);
    expect(huerfanosDe(aqui, 'const real = await importOriginal<typeof import("@/core/permisos/nunca")>();')).toHaveLength(1);
    expect(huerfanosDe(aqui, 'await vi.importActual<typeof import("@/server/acceso/gate")>("@/server/acceso/gate");')).toEqual([]);
    expect(huerfanosDe(aqui, 'vi.mock("next/headers", () => ({}));')).toEqual([]); // paquete: no se mira
    expect(huerfanosDe(aqui, '// vi.mock("@/no/existe")')).toEqual([]); // comentado
  });
});
