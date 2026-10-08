import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { resolverEspecificador } from "../../scripts/arquitectura/reapuntar-imports";

/**
 * La auditoría tiene UN solo escritor y los tests que lo interceptan apuntan a ese mismo archivo (Hito 5, pieza 5.4, B2 de `docs/plan-hito-5-pureza.md`; B5 del plan de la Fase 4).
 *
 * `registrarCambioAuditado` es el único punto de escritura de `RegistroAuditoria` (mismo criterio que `conPermiso`: un solo lugar, nunca una copia divergente en cada Server Action).
 * Diez tests de atomicidad lo interceptan con `vi.mock(<ruta>, factory)` para romper la auditoría A MITAD DE CAMINO y probar que el cambio y su rastro se deshacen juntos. Un `vi.mock`
 * solo intercepta el módulo cuyo especificador resuelve al MISMO archivo que importa el código bajo prueba: si el escritor se muda y un mock queda apuntando a la ruta vieja, ese test
 * deja de interceptar nada y SIGUE EN VERDE (la auditoría anda, nunca se rompe, y el test «prueba» una atomicidad que ya no ejercita). Este guardián lo impide:
 *  1. en `src/` y `plataforma/src/` exactamente UN archivo declara `registrarCambioAuditado` (ni una copia homónima en otro lado);
 *  2. todo `vi.mock(<ruta>, factory)` de `test/` y `scripts/` cuyo factory nombra `registrarCambioAuditado` resuelve a ESE archivo, y el `typeof import("…")` de su factory también
 *     (los tipos de `real.registrarCambioAuditado`: si apuntan a otro módulo, `tsc` pasa por casualidad y el mock queda mal tipado);
 *  3. control de sanidad: encuentra al menos 10 mocks (hoy hay 10; si el analizador quedara ciego, las otras dos reglas pasarían por vacías).
 * No depende de dónde esté el escritor: sigue valiendo antes y después de la mudanza a `src/server/auditoria/` (B3), que es justo lo que protege.
 */
const RAIZ = join(__dirname, "../..");
const NOMBRE = "registrarCambioAuditado";
const MINIMO_DE_MOCKS = 10;

const normalizar = (ruta: string) => ruta.split(sep).join("/");
const sinExtension = (ruta: string) => ruta.replace(/\.(tsx?|mts|cts)$/, "");

/** Las funciones (declaración o `const f = …`) que se llaman `nombre` en el código. */
export function declaracionesDe(codigo: string, nombre: string): string[] {
  const fuente = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true);
  const encontradas: string[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === nombre) encontradas.push(nombre);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === nombre && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) {
      encontradas.push(nombre);
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return encontradas;
}

interface MockDeAuditoria {
  /** El especificador del `vi.mock`. */
  ruta: string;
  /** Los especificadores de cada `typeof import("…")` del factory. */
  tiposImportados: string[];
}

/** Cada `vi.mock(<literal>, factory)` cuyo factory nombra `nombre` (como identificador o como clave), con los `typeof import("…")` de ese factory. */
export function mocksQueNombran(codigo: string, nombre: string): MockDeAuditoria[] {
  const fuente = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true);
  const mocks: MockDeAuditoria[] = [];
  const nombraElNombre = (nodo: ts.Node) => {
    let nombra = false;
    const mirar = (n: ts.Node): void => {
      if ((ts.isIdentifier(n) || ts.isStringLiteralLike(n)) && n.text === nombre) nombra = true;
      ts.forEachChild(n, mirar);
    };
    mirar(nodo);
    return nombra;
  };
  const visitar = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === "vi" &&
      n.expression.name.text === "mock" &&
      n.arguments[0] &&
      ts.isStringLiteralLike(n.arguments[0]) &&
      n.arguments[1] &&
      (ts.isArrowFunction(n.arguments[1]) || ts.isFunctionExpression(n.arguments[1])) &&
      nombraElNombre(n.arguments[1])
    ) {
      const tiposImportados: string[] = [];
      const buscarTipos = (m: ts.Node): void => {
        if (ts.isImportTypeNode(m) && ts.isLiteralTypeNode(m.argument) && ts.isStringLiteral(m.argument.literal)) tiposImportados.push(m.argument.literal.text);
        ts.forEachChild(m, buscarTipos);
      };
      buscarTipos(n.arguments[1]);
      mocks.push({ ruta: n.arguments[0].text, tiposImportados });
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return mocks;
}

/** Los mocks que no apuntan al escritor (`escritor` = ruta absoluta sin extensión), con por qué. */
export function mocksMalApuntados(mocks: MockDeAuditoria[], archivo: string, escritor: string): string[] {
  const problemas: string[] = [];
  for (const m of mocks) {
    if (resolverEspecificador(m.ruta, archivo, RAIZ) !== escritor) problemas.push(`${normalizar(relative(RAIZ, archivo))}: vi.mock("${m.ruta}") no resuelve al archivo del escritor`);
    for (const t of m.tiposImportados) {
      if (resolverEspecificador(t, archivo, RAIZ) !== escritor) problemas.push(`${normalizar(relative(RAIZ, archivo))}: typeof import("${t}") del factory no resuelve al archivo del escritor`);
    }
  }
  return problemas;
}

function archivosDe(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "node_modules" || nombre === ".next" ? [] : archivosDe(ruta);
    return /\.tsx?$/.test(nombre) && !nombre.endsWith(".d.ts") ? [ruta] : [];
  });
}

describe("el analizador de la auditoría ve lo que dice ver (fuentes sintéticas)", () => {
  it("declaraciones: función, flecha y expresión; no un uso ni un comentario", () => {
    expect(declaracionesDe("export async function registrarCambioAuditado() {}", NOMBRE)).toHaveLength(1);
    expect(declaracionesDe("export const registrarCambioAuditado = async () => {};", NOMBRE)).toHaveLength(1);
    expect(declaracionesDe("export const registrarCambioAuditado = function () {};", NOMBRE)).toHaveLength(1);
    expect(declaracionesDe("// function registrarCambioAuditado() {}\nregistrarCambioAuditado();\nconst x = registrarCambioAuditado;", NOMBRE)).toEqual([]);
  });

  it("mocks: ve el literal y el typeof import del factory, y solo los factories que nombran la función", () => {
    const codigo = `
      vi.mock("../../src/core/permisos/auditoria", async (importOriginal) => {
        const real = await importOriginal<typeof import("../../src/core/permisos/auditoria")>();
        return { ...real, registrarCambioAuditado: async (...a: unknown[]) => real.registrarCambioAuditado(...(a as never)) };
      });
      vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));`;
    expect(mocksQueNombran(codigo, NOMBRE)).toEqual([{ ruta: "../../src/core/permisos/auditoria", tiposImportados: ["../../src/core/permisos/auditoria"] }]);
  });

  it("juzga: la ruta del mock y la del typeof import tienen que resolver al escritor, con alias o relativas", () => {
    const archivo = join(RAIZ, "test/x/prueba.test.ts");
    const escritor = normalizar(sinExtension(resolve(RAIZ, "src/server/auditoria/registrar-cambio-auditado.ts")));
    const bien = [{ ruta: "../../src/server/auditoria/registrar-cambio-auditado", tiposImportados: ["@/server/auditoria/registrar-cambio-auditado"] }];
    expect(mocksMalApuntados(bien, archivo, escritor)).toEqual([]);
    expect(mocksMalApuntados([{ ...bien[0], ruta: "../../src/core/permisos/auditoria" }], archivo, escritor)).toHaveLength(1);
    expect(mocksMalApuntados([{ ...bien[0], tiposImportados: ["../../src/core/permisos/auditoria"] }], archivo, escritor)).toHaveLength(1);
  });
});

describe("la auditoría tiene un solo escritor y los mocks lo apuntan", () => {
  const declaradores = ["src", "plataforma/src"].flatMap((c) => archivosDe(join(RAIZ, c))).filter((f) => declaracionesDe(readFileSync(f, "utf8"), NOMBRE).length > 0);
  const mocks = ["test", "scripts"].flatMap((c) => archivosDe(join(RAIZ, c))).flatMap((f) => mocksQueNombran(readFileSync(f, "utf8"), NOMBRE).map((m) => ({ archivo: f, m })));

  it("exactamente UN archivo de src/ y plataforma/src/ declara registrarCambioAuditado", () => {
    expect(declaradores.map((f) => normalizar(relative(RAIZ, f))), "debe haber un único escritor de la auditoría (una copia homónima es una escritura divergente)").toHaveLength(1);
  });

  it("encuentra los mocks (si no, las otras reglas pasarían por vacías)", () => {
    expect(mocks.length).toBeGreaterThanOrEqual(MINIMO_DE_MOCKS);
  });

  it("todo vi.mock cuyo factory nombra registrarCambioAuditado, y su typeof import, resuelven al archivo del escritor", () => {
    const escritor = normalizar(sinExtension(declaradores[0]));
    const problemas = mocks.flatMap(({ archivo, m }) => mocksMalApuntados([m], archivo, escritor));
    expect(problemas, `Un mock que no apunta al archivo del escritor no intercepta nada y su test sigue verde:\n${problemas.join("\n")}`).toEqual([]);
  });
});
