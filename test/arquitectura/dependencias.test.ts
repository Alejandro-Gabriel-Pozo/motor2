import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import { cruise, type ICruiseResult, type IDependency, type IModule } from "dependency-cruiser";
import extractDepcruiseOptions from "dependency-cruiser/config-utl/extract-depcruise-options";
import extractTSConfig from "dependency-cruiser/config-utl/extract-ts-config";
import { analizarFuente } from "./guardas/analizador";

/**
 * Complemento de `npm run arquitectura` (dependency-cruiser, `.dependency-cruiser.cjs` — Task #41, Fase A3) SOLO para lo que
 * dependency-cruiser no expresa: que cada excepción de `.dependency-cruiser-excepciones.cjs` SIGA HACIENDO FALTA. Una
 * regla de dependency-cruiser falla cuando aparece una dependencia prohibida que no está exceptuada, pero nunca cuando una
 * excepción quedó de más (la página ya se migró, el archivo ya no importa react, el ciclo ya se cortó): esa excepción
 * sobrante dejaría la puerta abierta en silencio para volver a introducir lo mismo.
 *
 * Mismo estilo de revisión en las DOS direcciones que `lectores-de-receta.test.ts` / `toda-accion-se-usa.test.ts`: para
 * cada lista, el conjunto REAL (calculado del grafo de dependency-cruiser, no de un segundo parser de imports) tiene que ser
 * exactamente el de la lista — todo lo que debería estar, está; todo lo que está, sigue haciendo falta.
 *
 * El grafo sale de la API `cruise()` del propio paquete, con las MISMAS opciones que el CLI (`extractDepcruiseOptions` sobre
 * la config real + el tsconfig para el alias `@/...`).
 */
const RAIZ = join(__dirname, "../..");
const requerir = createRequire(__filename);

interface ExcepcionDeArchivo {
  ruta: string;
  motivo: string;
}
interface ExcepcionDeCiclo {
  ciclo: string[];
  motivo: string;
}
interface Excepciones {
  "core-sin-react-next": ExcepcionDeArchivo[];
  "ui-sin-prisma": ExcepcionDeArchivo[];
  "db-solo-desde-auth-y-carta-publica": ExcepcionDeArchivo[];
  "base-solo-desde-lista": ExcepcionDeArchivo[];
  "sin-ciclos": ExcepcionDeCiclo[];
  PENDIENTES_DE_MIGRAR: ExcepcionDeArchivo[];
  ACCIONES_CON_CASO_DE_USO: ExcepcionDeArchivo[];
}
interface ReglaConfig {
  name: string;
  severity: string;
}
interface Config {
  forbidden: ReglaConfig[];
  options: Record<string, unknown>;
}

const EXCEPCIONES = requerir(join(RAIZ, ".dependency-cruiser-excepciones.cjs")) as Excepciones;
const CONFIG = requerir(join(RAIZ, ".dependency-cruiser.cjs")) as Config;

const RE_UI = /^src\/(app|components)\//;
const RE_CORE = /^src\/core\//;
const RE_DB = /^src\/lib\/db\.ts$/;
const RE_BASE = /^src\/core\/auth\/base\.ts$/;
const RE_REACT_NEXT = /^node_modules\/(@types\/)?(react|react-dom|next)\//;

let modulos: IModule[] = [];

function esDeSoloTipo(d: IDependency): boolean {
  return d.dependencyTypes.includes("type-only");
}

/** Rutas de los módulos de `src/` que cumplen `filtroOrigen` y tienen al menos una dependencia que cumple `filtroDependencia`. */
function modulosCon(filtroOrigen: RegExp, filtroDependencia: (d: IDependency) => boolean): string[] {
  return modulos
    .filter((m) => filtroOrigen.test(m.source) && m.dependencies.some(filtroDependencia))
    .map((m) => m.source)
    .sort();
}

/** Cada ciclo real del grafo, como la lista ordenada (y sin repetidos) de los archivos que lo forman. */
function ciclosReales(): string[] {
  const ciclos = new Set<string>();
  for (const m of modulos) {
    for (const d of m.dependencies) {
      if (!d.circular || !d.cycle) continue;
      ciclos.add(JSON.stringify(Array.from(new Set(d.cycle.map((c) => c.name))).sort()));
    }
  }
  return Array.from(ciclos).sort();
}

function diferencia(a: readonly string[], b: readonly string[]): string[] {
  const enB = new Set(b);
  return a.filter((x) => !enB.has(x));
}

beforeAll(async () => {
  const opciones = await extractDepcruiseOptions(join(RAIZ, ".dependency-cruiser.cjs"));
  const resultado = await cruise(["src"], opciones, {}, { tsConfig: extractTSConfig(join(RAIZ, "tsconfig.json")) });
  modulos = (resultado.output as ICruiseResult).modules;
}, 120_000);

describe("dependency-cruiser: la config no se afloja por la puerta de atrás", () => {
  it("todas las reglas tienen severidad error", () => {
    const flojas = CONFIG.forbidden.filter((r) => r.severity !== "error").map((r) => `${r.name}: ${r.severity}`);
    expect(flojas, `Estas reglas no son "error" — una regla que no falla no protege nada:\n${flojas.join("\n")}`).toEqual([]);
  });

  it("no usa el baseline propio de dependency-cruiser (knownViolations): las excepciones van con motivo en el archivo de excepciones", () => {
    expect(CONFIG.options).not.toHaveProperty("knownViolations");
    expect(existsSync(join(RAIZ, ".dependency-cruiser-known-violations.json"))).toBe(false);
  });

  it("el grafo incluye src/ y ve los imports de solo tipo (tsPreCompilationDeps) y los paquetes de node_modules", () => {
    expect(modulos.filter((m) => m.source.startsWith("src/")).length).toBeGreaterThan(300);
    expect(modulos.some((m) => m.dependencies.some(esDeSoloTipo))).toBe(true);
    expect(modulos.some((m) => m.dependencies.some((d) => d.resolved.startsWith("node_modules/@prisma/client/")))).toBe(true);
  });
});

describe(".dependency-cruiser-excepciones.cjs: toda excepción tiene motivo y apunta a algo que existe", () => {
  const deArchivo = [...EXCEPCIONES["core-sin-react-next"], ...EXCEPCIONES["ui-sin-prisma"], ...EXCEPCIONES["db-solo-desde-auth-y-carta-publica"], ...EXCEPCIONES["base-solo-desde-lista"]];

  it("toda excepción lleva un motivo no vacío", () => {
    const sinMotivo = [
      ...deArchivo.filter((e) => !e.motivo?.trim()).map((e) => e.ruta),
      ...EXCEPCIONES["sin-ciclos"].filter((e) => !e.motivo?.trim()).map((e) => e.ciclo.join(" ↔ ")),
    ];
    expect(sinMotivo, `Excepciones sin motivo:\n${sinMotivo.join("\n")}`).toEqual([]);
  });

  it("todo archivo nombrado en una excepción existe", () => {
    const rutas = [...deArchivo.map((e) => e.ruta), ...EXCEPCIONES["sin-ciclos"].flatMap((e) => e.ciclo)];
    const inexistentes = rutas.filter((r) => !existsSync(join(RAIZ, r)));
    expect(inexistentes, `Estos archivos ya no existen: sacalos de .dependency-cruiser-excepciones.cjs:\n${inexistentes.join("\n")}`).toEqual([]);
  });

  it("la excepción de ui-sin-prisma ES la lista PENDIENTES_DE_MIGRAR", () => {
    expect(EXCEPCIONES["ui-sin-prisma"]).toBe(EXCEPCIONES.PENDIENTES_DE_MIGRAR);
  });
});

describe("ui-sin-prisma: PENDIENTES_DE_MIGRAR, en las dos direcciones", () => {
  it("toda página de PENDIENTES_DE_MIGRAR sigue importando @/lib/db (si ya no, se migró: sacala de la lista)", () => {
    const conDb = modulosCon(RE_UI, (d) => RE_DB.test(d.resolved) && !esDeSoloTipo(d));
    const yaMigradas = diferencia(
      EXCEPCIONES.PENDIENTES_DE_MIGRAR.map((e) => e.ruta),
      conDb
    );
    expect(
      yaMigradas,
      `Estas páginas ya no importan @/lib/db (en runtime): sacalas de PENDIENTES_DE_MIGRAR en .dependency-cruiser-excepciones.cjs:\n${yaMigradas.join("\n")}`
    ).toEqual([]);
  });

  it("todo archivo de app/ o components/ que importa @/lib/db en runtime está en PENDIENTES_DE_MIGRAR (y no se suma ninguno nuevo sin pasar por la lista)", () => {
    const conDb = modulosCon(RE_UI, (d) => RE_DB.test(d.resolved) && !esDeSoloTipo(d));
    const sinListar = diferencia(
      conDb,
      EXCEPCIONES.PENDIENTES_DE_MIGRAR.map((e) => e.ruta)
    );
    expect(sinListar, `Estos archivos de la UI importan @/lib/db y no están en PENDIENTES_DE_MIGRAR:\n${sinListar.join("\n")}`).toEqual([]);
  });
});

describe("db-solo-desde-auth-y-carta-publica: los importadores de @/lib/db, en las dos direcciones", () => {
  it("el conjunto de archivos de src/ que importan @/lib/db es exactamente el de la lista", () => {
    const reales = modulosCon(/^src\//, (d) => RE_DB.test(d.resolved));
    const listados = EXCEPCIONES["db-solo-desde-auth-y-carta-publica"].map((e) => e.ruta).sort();
    const sobran = diferencia(listados, reales);
    const faltan = diferencia(reales, listados);
    expect(sobran, `Estos ya no importan @/lib/db: sacalos de db-solo-desde-auth-y-carta-publica en .dependency-cruiser-excepciones.cjs:\n${sobran.join("\n")}`).toEqual([]);
    expect(faltan, `Estos archivos importan @/lib/db sin estar en la lista (reciban la base del contexto: ctx.db / db: Db):\n${faltan.join("\n")}`).toEqual([]);
  });
});

describe("base-solo-desde-lista: los importadores de core/auth/base.ts, en las dos direcciones", () => {
  it("el conjunto de archivos de src/ que importan core/auth/base.ts es exactamente el de la lista", () => {
    const reales = modulosCon(/^src\//, (d) => RE_BASE.test(d.resolved));
    const listados = EXCEPCIONES["base-solo-desde-lista"].map((e) => e.ruta).sort();
    const sobran = diferencia(listados, reales);
    const faltan = diferencia(reales, listados);
    expect(sobran, `Estos ya no importan core/auth/base.ts: sacalos de base-solo-desde-lista en .dependency-cruiser-excepciones.cjs:\n${sobran.join("\n")}`).toEqual([]);
    expect(faltan, `Estos archivos importan core/auth/base.ts sin estar en la lista (reciban la base del contexto: ctx.db / db: Db):\n${faltan.join("\n")}`).toEqual([]);
  });
});

describe("core-sin-react-next: las excepciones, en las dos direcciones", () => {
  it("el conjunto de archivos de core/ que importan react/react-dom/next es exactamente el de la lista", () => {
    const reales = modulosCon(RE_CORE, (d) => RE_REACT_NEXT.test(d.resolved));
    const listados = EXCEPCIONES["core-sin-react-next"].map((e) => e.ruta).sort();
    const sobran = diferencia(listados, reales);
    const faltan = diferencia(reales, listados);
    expect(sobran, `Estos ya no importan react/next: sacalos de core-sin-react-next en .dependency-cruiser-excepciones.cjs:\n${sobran.join("\n")}`).toEqual([]);
    expect(faltan, `Estos archivos de core/ importan react/next sin estar exceptuados:\n${faltan.join("\n")}`).toEqual([]);
  });
});

describe("sin-ciclos: los ciclos exceptuados, en las dos direcciones", () => {
  it("el conjunto de ciclos reales de src/ es exactamente el de la lista (ni uno nuevo, ni uno ya cortado)", () => {
    const reales = ciclosReales();
    const listados = EXCEPCIONES["sin-ciclos"].map((e) => JSON.stringify([...new Set(e.ciclo)].sort())).sort();
    const cortados = diferencia(listados, reales);
    const nuevos = diferencia(reales, listados);
    expect(cortados, `Estos ciclos ya no existen: sacalos de sin-ciclos en .dependency-cruiser-excepciones.cjs:\n${cortados.join("\n")}`).toEqual([]);
    expect(
      nuevos,
      `Ciclos que no están exceptuados (córtenlos; la regla sin-ciclos solo deja pasar un ciclo formado exclusivamente por archivos de ciclos ya listados):\n${nuevos.join("\n")}`
    ).toEqual([]);
  });
});

/** Todos los `.ts` bajo `dir` (recursivo), como rutas relativas a la raíz del repo con `/`. */
function archivosTs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivosTs(ruta) : ruta.endsWith(".ts") ? [relative(RAIZ, ruta).split("\\").join("/")] : [];
  });
}

/** ¿La PRIMERA sentencia del archivo es exactamente `import "server-only";` (sin nada importado)? Por AST: un comentario no cuenta. */
function abreConServerOnly(fuente: string): boolean {
  const primera = ts.createSourceFile("x.ts", fuente, ts.ScriptTarget.Latest, false).statements[0];
  return (
    primera !== undefined &&
    ts.isImportDeclaration(primera) &&
    primera.importClause === undefined &&
    ts.isStringLiteral(primera.moduleSpecifier) &&
    primera.moduleSpecifier.text === "server-only"
  );
}

describe("persistencia-solo-desde-casos-de-uso (Fase M): los casos de uso no son endpoints", () => {
  const CASOS_DE_USO = archivosTs(join(RAIZ, "src/server/actions")).filter((r) => /^src\/server\/actions\/[^/]+\/casos-de-uso\//.test(r));

  it("la regla está en la config", () => {
    expect(CONFIG.forbidden.map((r) => r.name)).toContain("persistencia-solo-desde-casos-de-uso");
  });

  it("hay casos de uso que revisar (el chequeo no pasa en vacío)", () => {
    expect(CASOS_DE_USO.length).toBeGreaterThan(0);
  });

  it("ningún archivo de casos-de-uso/ lleva \"use server\" (todo lo que exporta sería un endpoint sin guarda)", () => {
    const conUseServer = CASOS_DE_USO.filter((r) => analizarFuente(r, readFileSync(join(RAIZ, r), "utf8")).esArchivoDeAcciones);
    expect(conUseServer, `Estos casos de uso llevan "use server": sacáselo (lo expone la Server Action que lo envuelve):\n${conUseServer.join("\n")}`).toEqual([]);
  });

  it("todo archivo de casos-de-uso/ abre con import \"server-only\"", () => {
    const sinServerOnly = CASOS_DE_USO.filter((r) => !abreConServerOnly(readFileSync(join(RAIZ, r), "utf8")));
    expect(sinServerOnly, `Estos casos de uso no abren con import "server-only":\n${sinServerOnly.join("\n")}`).toEqual([]);
  });

  it("el detector de import \"server-only\" (con fuentes sintéticas)", () => {
    expect(abreConServerOnly('import "server-only";\nimport { x } from "y";')).toBe(true);
    expect(abreConServerOnly('// import "server-only";\nimport { x } from "y";')).toBe(false);
    expect(abreConServerOnly('import { x } from "y";\nimport "server-only";')).toBe(false);
    expect(abreConServerOnly('"use server";\nimport "server-only";')).toBe(false);
  });
});

describe("accion-migrada-sin-orquestacion (Fase M): ACCIONES_CON_CASO_DE_USO", () => {
  const LISTA = EXCEPCIONES.ACCIONES_CON_CASO_DE_USO;

  it("la regla está en la config (sus dos entradas: runtime y persistencia)", () => {
    expect(CONFIG.forbidden.filter((r) => r.name === "accion-migrada-sin-orquestacion")).toHaveLength(2);
  });

  it("la lista no está vacía y cada entrada lleva motivo", () => {
    expect(LISTA.length).toBeGreaterThan(0);
    const sinMotivo = LISTA.filter((e) => !e.motivo?.trim()).map((e) => e.ruta);
    expect(sinMotivo, `Entradas sin motivo:\n${sinMotivo.join("\n")}`).toEqual([]);
  });

  it("cada archivo de la lista existe y es un archivo de Server Actions (\"use server\")", () => {
    const problemas = LISTA.flatMap(({ ruta }) => {
      const absoluta = join(RAIZ, ruta);
      if (!existsSync(absoluta)) return [`${ruta}: no existe`];
      return analizarFuente(ruta, readFileSync(absoluta, "utf8")).esArchivoDeAcciones ? [] : [`${ruta}: no lleva "use server"`];
    });
    expect(problemas, `ACCIONES_CON_CASO_DE_USO (.dependency-cruiser-excepciones.cjs):\n${problemas.join("\n")}`).toEqual([]);
  });

  it("dependency-cruiser efectivamente ve esos archivos en el grafo (la regla no apunta a una ruta que no matchea nada)", () => {
    const enGrafo = new Set(modulos.map((m) => m.source));
    const fuera = LISTA.map((e) => e.ruta).filter((r) => !enGrafo.has(r));
    expect(fuera).toEqual([]);
  });
});
