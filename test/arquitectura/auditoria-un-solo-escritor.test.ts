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
 *  2. TODO `vi.mock` / `vi.doMock` de `test/` y `scripts/` cuya ruta RESUELTA es el módulo del escritor (`src/server/auditoria/registrar-cambio-auditado.ts`) o el de su ruta vieja
 *     (`src/core/permisos/auditoria.ts`) tiene que cumplir tres cosas (reserva M4 de la auditoría del Hito 5: antes solo se miraban los mocks cuyo factory NOMBRABA la función, y un
 *     automock sin factory, o un factory que solo hace spread de `importOriginal`, pasaban sin que nadie lo viera):
 *       a. apuntar al archivo del escritor (la ruta vieja es siempre un error);
 *       b. tener un factory que DEFINE `registrarCambioAuditado` como propiedad del objeto que devuelve (un `...real` solo, o un automock sin factory, no la define: el mock no rompería nada);
 *       c. que el `typeof import("…")` de su factory (los tipos de `real.registrarCambioAuditado`) resuelva también al escritor;
 *     o bien figurar en la lista cerrada `MOCKS_PERMITIDOS_SIN_DEFINIR_LA_FUNCION` con su motivo (hoy vacía; una entrada que ya cumple, o cuyo archivo ya no tiene ese mock, falla);
 *  3. control de sanidad: encuentra al menos 10 mocks del escritor (hoy hay 10; si el analizador quedara ciego, las otras dos reglas pasarían por vacías).
 * No depende de dónde esté el escritor: sigue valiendo antes y después de la mudanza a `src/server/auditoria/` (B3), que es justo lo que protege.
 */
const RAIZ = join(__dirname, "../..");
const NOMBRE = "registrarCambioAuditado";
const MINIMO_DE_MOCKS = 10;
/** La ruta VIEJA del escritor (antes de B3). Un `vi.mock` que apunte ahí ya no intercepta al escritor. */
const RUTA_VIEJA = "src/core/permisos/auditoria";

/**
 * Los archivos de `test/` o `scripts/` que pueden tener un `vi.mock` del módulo del escritor (o de su ruta vieja) SIN un factory que defina `registrarCambioAuditado`, y por qué. Hoy ninguno:
 * todos los mocks rompen la auditoría a mitad de camino. Una entrada nueva es una decisión de arquitectura con motivo; si el archivo deja de tener ese mock (o lo arregla), se saca de acá.
 */
const MOCKS_PERMITIDOS_SIN_DEFINIR_LA_FUNCION: Record<string, string> = {};

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

interface MockDeModulo {
  /** El especificador del `vi.mock` / `vi.doMock`. */
  ruta: string;
  /** ¿Tiene un segundo argumento que es una función (el factory)? Sin eso es un automock (o un factory que no se puede leer: una variable). */
  tieneFactory: boolean;
  /** ¿El factory DEVUELVE un objeto que define `nombre` como propiedad (clave, atajo o método)? Un spread (`...real`) no cuenta. */
  defineLaFuncion: boolean;
  /** Los especificadores de cada `typeof import("…")` del factory. */
  tiposImportados: string[];
}

/** Las propiedades (por nombre) de los objetos literales que el factory devuelve: el cuerpo-expresión de una flecha, o cada `return` propio (no el de una función anidada). */
function clavesDevueltasPor(factory: ts.ArrowFunction | ts.FunctionExpression): Set<string> {
  const claves = new Set<string>();
  const sinParentesis = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) ? sinParentesis(e.expression) : e);
  const sumar = (e: ts.Expression | undefined) => {
    const obj = e && sinParentesis(e);
    if (!obj || !ts.isObjectLiteralExpression(obj)) return;
    for (const p of obj.properties) {
      if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p)) && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name))) claves.add(p.name.text);
      if (ts.isShorthandPropertyAssignment(p)) claves.add(p.name.text);
    }
  };
  if (!ts.isBlock(factory.body)) sumar(factory.body);
  else {
    const visitar = (n: ts.Node): void => {
      if (ts.isReturnStatement(n)) sumar(n.expression);
      if (n !== factory.body && (ts.isFunctionLike(n) || ts.isClassLike(n))) return; // el return de una función anidada es de ella, no del factory
      ts.forEachChild(n, visitar);
    };
    visitar(factory.body);
  }
  return claves;
}

/** Cada `vi.mock(<literal>, …)` / `vi.doMock(<literal>, …)` del código, con qué factory tiene y si ese factory define `nombre`. Todos, no solo los que nombran la función. */
export function mocksDeModulos(codigo: string, nombre: string): MockDeModulo[] {
  const fuente = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true);
  const mocks: MockDeModulo[] = [];
  const visitar = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === "vi" &&
      (n.expression.name.text === "mock" || n.expression.name.text === "doMock") &&
      n.arguments[0] &&
      ts.isStringLiteralLike(n.arguments[0])
    ) {
      const factory = n.arguments[1] && (ts.isArrowFunction(n.arguments[1]) || ts.isFunctionExpression(n.arguments[1])) ? n.arguments[1] : undefined;
      const tiposImportados: string[] = [];
      const buscarTipos = (m: ts.Node): void => {
        if (ts.isImportTypeNode(m) && ts.isLiteralTypeNode(m.argument) && ts.isStringLiteral(m.argument.literal)) tiposImportados.push(m.argument.literal.text);
        ts.forEachChild(m, buscarTipos);
      };
      if (factory) buscarTipos(factory);
      mocks.push({ ruta: n.arguments[0].text, tieneFactory: !!factory, defineLaFuncion: !!factory && clavesDevueltasPor(factory).has(nombre), tiposImportados });
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return mocks;
}

/** Las rutas absolutas (sin extensión) que cuentan: el archivo del escritor y su ruta vieja. */
interface Destinos {
  escritor: string;
  viejo: string;
}

/** Los mocks del escritor (o de su ruta vieja) que están mal, con por qué. Un mock de otro módulo no se mira. `archivo` es la ruta absoluta del archivo que contiene el mock. */
export function mocksProblematicos(mocks: MockDeModulo[], archivo: string, destinos: Destinos): string[] {
  const donde = normalizar(relative(RAIZ, archivo));
  const problemas: string[] = [];
  for (const m of mocks) {
    const resuelta = resolverEspecificador(m.ruta, archivo, RAIZ);
    if (resuelta !== destinos.escritor && resuelta !== destinos.viejo) continue;
    if (resuelta === destinos.viejo) {
      problemas.push(`${donde}: vi.mock("${m.ruta}") apunta a la ruta vieja del escritor (no intercepta nada); el escritor está en ${normalizar(relative(RAIZ, destinos.escritor))}`);
      continue;
    }
    if (!m.tieneFactory) problemas.push(`${donde}: vi.mock("${m.ruta}") es un automock (o su factory no es una función literal): no define ${NOMBRE} y no rompe la auditoría a mitad de camino`);
    else if (!m.defineLaFuncion) problemas.push(`${donde}: el factory de vi.mock("${m.ruta}") no define ${NOMBRE} en el objeto que devuelve (¿solo un spread de importOriginal?)`);
    for (const t of m.tiposImportados) {
      if (resolverEspecificador(t, archivo, RAIZ) !== destinos.escritor) problemas.push(`${donde}: typeof import("${t}") del factory no resuelve al archivo del escritor`);
    }
  }
  return problemas;
}

/** Cruza los problemas por archivo con la lista cerrada: los archivos con problemas que no están permitidos, y las entradas permitidas que ya no hacen falta (sin problemas, o archivo ausente). */
export function juzgarContraLaLista(problemasPorArchivo: Record<string, string[]>, permitidos: Record<string, string>): { infractores: string[]; sobran: string[] } {
  return {
    infractores: Object.entries(problemasPorArchivo)
      .filter(([archivo, problemas]) => problemas.length > 0 && !(archivo in permitidos))
      .flatMap(([, problemas]) => problemas),
    sobran: Object.keys(permitidos).filter((archivo) => (problemasPorArchivo[archivo] ?? []).length === 0),
  };
}

function archivosDe(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "node_modules" || nombre === ".next" ? [] : archivosDe(ruta);
    return /\.tsx?$/.test(nombre) && !nombre.endsWith(".d.ts") ? [ruta] : [];
  });
}

describe("el analizador de la auditoría ve lo que dice ver (fuentes sintéticas)", () => {
  const archivo = join(RAIZ, "test/x/prueba.test.ts");
  const destinos: Destinos = {
    escritor: normalizar(sinExtension(resolve(RAIZ, "src/server/auditoria/registrar-cambio-auditado.ts"))),
    viejo: normalizar(sinExtension(resolve(RAIZ, `${RUTA_VIEJA}.ts`))),
  };
  const problemasDe = (codigo: string) => mocksProblematicos(mocksDeModulos(codigo, NOMBRE), archivo, destinos);
  const NUEVA = "../../src/server/auditoria/registrar-cambio-auditado";
  const BIEN = `
    vi.mock("${NUEVA}", async (importOriginal) => {
      const real = await importOriginal<typeof import("${NUEVA}")>();
      return { ...real, registrarCambioAuditado: async (...a: unknown[]) => real.registrarCambioAuditado(...(a as never)) };
    });`;

  it("declaraciones: función, flecha y expresión; no un uso ni un comentario", () => {
    expect(declaracionesDe("export async function registrarCambioAuditado() {}", NOMBRE)).toHaveLength(1);
    expect(declaracionesDe("export const registrarCambioAuditado = async () => {};", NOMBRE)).toHaveLength(1);
    expect(declaracionesDe("export const registrarCambioAuditado = function () {};", NOMBRE)).toHaveLength(1);
    expect(declaracionesDe("// function registrarCambioAuditado() {}\nregistrarCambioAuditado();\nconst x = registrarCambioAuditado;", NOMBRE)).toEqual([]);
  });

  it("mocks: ve TODOS los vi.mock y vi.doMock con ruta literal, con su factory, si define la función y los typeof import", () => {
    const codigo = `${BIEN}
      vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
      vi.doMock("${NUEVA}");
      vi.mock(rutaEnVariable, () => ({}));`;
    expect(mocksDeModulos(codigo, NOMBRE)).toEqual([
      { ruta: NUEVA, tieneFactory: true, defineLaFuncion: true, tiposImportados: [NUEVA] },
      { ruta: "../../src/core/auth/session", tieneFactory: true, defineLaFuncion: false, tiposImportados: [] },
      { ruta: NUEVA, tieneFactory: false, defineLaFuncion: false, tiposImportados: [] },
    ]);
  });

  it("la definición cuenta como propiedad del objeto DEVUELTO: clave, atajo, método, cuerpo-expresión con paréntesis, `return` en bloque; no un spread ni un objeto anidado ni un return de otra función", () => {
    const con = (cuerpo: string) => mocksDeModulos(`vi.mock("${NUEVA}", ${cuerpo});`, NOMBRE)[0].defineLaFuncion;
    expect(con("() => ({ registrarCambioAuditado: vi.fn() })")).toBe(true);
    expect(con("() => ({ 'registrarCambioAuditado': vi.fn() })")).toBe(true);
    expect(con("() => { const registrarCambioAuditado = vi.fn(); return { registrarCambioAuditado }; }")).toBe(true);
    expect(con("() => ({ async registrarCambioAuditado() {} })")).toBe(true);
    expect(con("async (importOriginal) => { const real = await importOriginal(); return { ...real, registrarCambioAuditado: vi.fn() }; }")).toBe(true);
    expect(con("async (importOriginal) => ({ ...(await importOriginal()) })")).toBe(false);
    expect(con("async (importOriginal) => { const real = await importOriginal(); return { ...real }; }")).toBe(false);
    expect(con("() => ({ otra: { registrarCambioAuditado: vi.fn() } })")).toBe(false);
    expect(con("() => { const f = () => ({ registrarCambioAuditado: vi.fn() }); return {}; }")).toBe(false);
  });

  it("juzga: el mock bien armado pasa", () => {
    expect(problemasDe(BIEN)).toEqual([]);
    expect(problemasDe(BIEN.replaceAll(NUEVA, "@/server/auditoria/registrar-cambio-auditado"))).toEqual([]); // con alias
    expect(problemasDe('vi.mock("../../src/core/auth/session", () => ({}));')).toEqual([]); // otro módulo: no se mira
  });

  it("juzga: un automock sin factory sobre el escritor falla (también vi.doMock)", () => {
    expect(problemasDe(`vi.mock("${NUEVA}");`)).toHaveLength(1);
    expect(problemasDe(`vi.doMock("${NUEVA}");`)).toHaveLength(1);
    expect(problemasDe(`vi.mock("${NUEVA}", factoryEnVariable);`)).toHaveLength(1);
  });

  it("juzga: un factory que solo hace spread (o que devuelve otra cosa) falla", () => {
    expect(problemasDe(`vi.mock("${NUEVA}", async (importOriginal) => ({ ...(await importOriginal<typeof import("${NUEVA}")>()) }));`)).toHaveLength(1);
    expect(problemasDe(`vi.mock("${NUEVA}", () => ({ otraCosa: vi.fn() }));`)).toHaveLength(1);
  });

  it("juzga: la ruta vieja falla, con o sin la función en el factory, y con automock", () => {
    const VIEJA = "../../src/core/permisos/auditoria";
    expect(problemasDe(BIEN.replaceAll(NUEVA, VIEJA))).toHaveLength(1);
    expect(problemasDe(`vi.mock("${VIEJA}");`)).toHaveLength(1);
    expect(problemasDe(`vi.mock("${VIEJA}", () => ({ ENTIDADES_AUDITABLES: [] }));`)).toHaveLength(1);
  });

  it("juzga: el typeof import del factory tiene que resolver también al escritor", () => {
    expect(problemasDe(BIEN.replace(`typeof import("${NUEVA}")`, 'typeof import("../../src/core/permisos/auditoria")'))).toHaveLength(1);
  });

  it("la lista cerrada: un archivo con problemas que no está permitido es infractor; una entrada sin problemas sobra", () => {
    const problemas = { "test/a.test.ts": ["a: mal"], "test/b.test.ts": ["b: mal"], "test/c.test.ts": [] };
    expect(juzgarContraLaLista(problemas, {})).toEqual({ infractores: ["a: mal", "b: mal"], sobran: [] });
    expect(juzgarContraLaLista(problemas, { "test/a.test.ts": "motivo" })).toEqual({ infractores: ["b: mal"], sobran: [] });
    expect(juzgarContraLaLista(problemas, { "test/c.test.ts": "motivo", "test/no-existe.test.ts": "motivo" })).toEqual({ infractores: ["a: mal", "b: mal"], sobran: ["test/c.test.ts", "test/no-existe.test.ts"] });
  });
});

describe("la auditoría tiene un solo escritor y los mocks lo apuntan", () => {
  const declaradores = ["src", "plataforma/src"].flatMap((c) => archivosDe(join(RAIZ, c))).filter((f) => declaracionesDe(readFileSync(f, "utf8"), NOMBRE).length > 0);
  const mocksPorArchivo = ["test", "scripts"]
    .flatMap((c) => archivosDe(join(RAIZ, c)))
    .map((archivo) => ({ archivo, mocks: mocksDeModulos(readFileSync(archivo, "utf8"), NOMBRE) }))
    .filter(({ mocks }) => mocks.length > 0);
  const destinos = (): Destinos => ({ escritor: normalizar(sinExtension(declaradores[0])), viejo: normalizar(sinExtension(resolve(RAIZ, `${RUTA_VIEJA}.ts`))) });

  it("exactamente UN archivo de src/ y plataforma/src/ declara registrarCambioAuditado", () => {
    expect(declaradores.map((f) => normalizar(relative(RAIZ, f))), "debe haber un único escritor de la auditoría (una copia homónima es una escritura divergente)").toHaveLength(1);
  });

  it("encuentra los mocks del escritor (si no, las otras reglas pasarían por vacías)", () => {
    const d = destinos();
    const delEscritor = mocksPorArchivo.flatMap(({ archivo, mocks }) => mocks.filter((m) => resolverEspecificador(m.ruta, archivo, RAIZ) === d.escritor));
    expect(delEscritor.length).toBeGreaterThanOrEqual(MINIMO_DE_MOCKS);
  });

  it("todo vi.mock del escritor (o de su ruta vieja) tiene un factory que define registrarCambioAuditado y apunta al archivo del escritor, o está en la lista cerrada con motivo", () => {
    const d = destinos();
    const porArchivo = Object.fromEntries(mocksPorArchivo.map(({ archivo, mocks }) => [normalizar(relative(RAIZ, archivo)), mocksProblematicos(mocks, archivo, d)]));
    const { infractores, sobran } = juzgarContraLaLista(porArchivo, MOCKS_PERMITIDOS_SIN_DEFINIR_LA_FUNCION);
    expect(infractores, `Un mock que no define ${NOMBRE} sobre el archivo del escritor no intercepta nada y su test sigue verde:\n${infractores.join("\n")}`).toEqual([]);
    expect(sobran, `Estas entradas de MOCKS_PERMITIDOS_SIN_DEFINIR_LA_FUNCION ya no hacen falta (el mock está bien o ya no existe): sacalas:\n${sobran.join("\n")}`).toEqual([]);
  });
});
