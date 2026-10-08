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
  "ui-sin-internals-de-dominio": ExcepcionDeArchivo[];
  "paginas-solo-consultas": ExcepcionDeArchivo[];
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
const { DOMINIOS_DE_NEGOCIO } = requerir(join(RAIZ, ".dependency-cruiser-dominios.cjs")) as { DOMINIOS_DE_NEGOCIO: string[] };
/** Un archivo de `core/<dominio de negocio>/` que NO es su fachada (`public.ts` / `public-servidor.ts`). */
const RE_INTERNO_DE_DOMINIO = new RegExp(`^src/core/(${DOMINIOS_DE_NEGOCIO.join("|")})/(?!public(-servidor)?[.]ts$)`);

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
  const deArchivo = [...EXCEPCIONES["core-sin-react-next"], ...EXCEPCIONES["ui-sin-prisma"], ...EXCEPCIONES["db-solo-desde-auth-y-carta-publica"], ...EXCEPCIONES["base-solo-desde-lista"], ...EXCEPCIONES["ui-sin-internals-de-dominio"]];

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

describe("ui-sin-internals-de-dominio: las excepciones, en las dos direcciones", () => {
  it("el conjunto de archivos de app/ y components/ que importan un archivo interno de un dominio es exactamente el de la lista (ni uno nuevo, ni uno ya migrado)", () => {
    const reales = modulosCon(RE_UI, (d) => RE_INTERNO_DE_DOMINIO.test(d.resolved));
    const listadas = EXCEPCIONES["ui-sin-internals-de-dominio"].map((e) => e.ruta).sort();
    expect(diferencia(reales, listadas), "Estos archivos de la UI importan un interno de un dominio y no están en la lista (importá la fachada):").toEqual([]);
    expect(diferencia(listadas, reales), "Estos ya no importan un interno: sacalos de la lista (UI_CON_INTERNALS_DE_DOMINIO):").toEqual([]);
  });
});

describe("sin-internals-de-otro-dominio: todos los dominios de negocio tienen su fachada y su regla (DOMINIOS_SIN_PUBLIC_TODAVIA, en las dos direcciones)", () => {
  it("cada dominio de negocio tiene su regla `sin-internals-de-otro-dominio` y su public.ts (no hay un dominio exceptuado que ya pueda protegerse)", () => {
    const reglas = CONFIG.forbidden.filter((r) => r.name === "sin-internals-de-otro-dominio");
    // Una regla por dominio: si uno quedara en DOMINIOS_SIN_PUBLIC_TODAVIA, faltaría su regla.
    expect(reglas, "falta la regla de algún dominio: ¿quedó uno en DOMINIOS_SIN_PUBLIC_TODAVIA? Si ya tiene fachada, sacalo de esa lista").toHaveLength(DOMINIOS_DE_NEGOCIO.length);
    const sinFachada = DOMINIOS_DE_NEGOCIO.filter((d) => !existsSync(join(RAIZ, "src", "core", d, "public.ts")));
    expect(sinFachada, `Estos dominios de negocio no tienen core/<dominio>/public.ts: ${sinFachada.join(", ")}`).toEqual([]);
  });
});

describe("paginas-solo-consultas: las excepciones, en las dos direcciones", () => {
  it("la regla está en la config", () => {
    expect(CONFIG.forbidden.map((r) => r.name)).toContain("paginas-solo-consultas");
  });

  it("el conjunto de archivos de app/ y components/ que importan server/lecturas o server/persistencia es exactamente el de la lista (ni uno nuevo, ni uno ya migrado)", () => {
    const reales = modulosCon(RE_UI, (d) => /^src\/server\/(lecturas|persistencia)\//.test(d.resolved));
    const listadas = EXCEPCIONES["paginas-solo-consultas"].map((e) => e.ruta).sort();
    expect(diferencia(reales, listadas), "Estas páginas importan server/lecturas o server/persistencia y no están en la lista (pedí los datos a una consulta en server/consultas):").toEqual([]);
    expect(diferencia(listadas, reales), "Estas páginas ya no importan esas capas: sacalas de la lista (paginas-solo-consultas):").toEqual([]);
  });

  it("toda excepción lleva su motivo", () => {
    expect(EXCEPCIONES["paginas-solo-consultas"].filter((e) => !e.motivo || e.motivo.length < 20)).toEqual([]);
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

  it("todo archivo de server/lecturas/permisos/ (las lecturas de decisión de gobierno, Hito 3 Fase II) abre con import \"server-only\"", () => {
    // Otras lecturas compartidas no lo llevan a propósito (las importan scripts con `tsx` y Playwright, ADR-026); las de gobierno solo las usan los casos de
    // uso y la transacción de gobierno (y el seed, que corre con `--conditions=react-server`): ninguna puede terminar en un bundle de cliente.
    const LECTURAS_DE_GOBIERNO = archivosTs(join(RAIZ, "src/server/lecturas/permisos"));
    expect(LECTURAS_DE_GOBIERNO.length).toBeGreaterThan(0);
    const sinServerOnly = LECTURAS_DE_GOBIERNO.filter((r) => !abreConServerOnly(readFileSync(join(RAIZ, r), "utf8")));
    expect(sinServerOnly, `Estas lecturas de gobierno no abren con import "server-only":\n${sinServerOnly.join("\n")}`).toEqual([]);
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

/**
 * `auditoria-capa` (Hito 5, pieza 5.4, B5): la capa del escritor de la auditoría (`src/server/auditoria/`) son DOS entradas de la misma regla de dependency-cruiser (como `persistencia-capa`):
 * lo que la capa no puede importar y quién no puede importarla. dependency-cruiser falla cuando aparece una dependencia prohibida, pero NO cuando alguien borra una entrada o le saca una
 * carpeta a la lista (la regla queda más floja y todo sigue verde): acá se exigen las dos entradas con sus listas EXACTAS. Los archivos de la carpeta, `server-only`, las impurezas y la única
 * escritura permitida las fija `server-auditoria.test.ts`.
 */
describe("auditoria-capa (Hito 5, 5.4-B5): las dos entradas con sus listas exactas", () => {
  interface ReglaConRutas {
    name: string;
    severity: string;
    from: { path: string | string[] };
    to: { path: string | string[] };
  }
  const entradas = CONFIG.forbidden.filter((r) => r.name === "auditoria-capa") as unknown as ReglaConRutas[];
  const rutas = (p: string | string[]) => (Array.isArray(p) ? p : [p]);
  const saliente = entradas.find((e) => rutas(e.from.path).join("|") === "^src/server/auditoria/");
  const entrante = entradas.find((e) => rutas(e.to.path).join("|") === "^src/server/auditoria/");

  it("la regla tiene exactamente dos entradas, las dos en error", () => {
    expect(entradas).toHaveLength(2);
    expect(entradas.map((e) => e.severity)).toEqual(["error", "error"]);
  });

  it("(1) desde server/auditoria no se puede ir a la UI, lib, lo demás de server, Next ni la sesión (core/auth)", () => {
    expect(saliente, "falta la entrada que sale de ^src/server/auditoria/").toBeDefined();
    expect(rutas(saliente!.to.path)).toEqual([
      "^src/(app|components|lib)/",
      "^src/server/(actions|consultas|lecturas|persistencia|acceso|sesion|carta-publica|adaptadores|operaciones-de-plataforma)/",
      "^node_modules/next/",
      "^src/core/auth/",
    ]);
  });

  it("(2) a server/auditoria no llegan la UI, lib, el proxy, el entorno ni consultas, lecturas, persistencia, acceso, carta pública o adaptadores", () => {
    expect(entrante, "falta la entrada que llega a ^src/server/auditoria/").toBeDefined();
    expect(rutas(entrante!.from.path)).toEqual(["^src/(app|components|lib)/|^src/server/(consultas|lecturas|persistencia|acceso|carta-publica|adaptadores)/|^src/(proxy|env)\\.ts$"]);
  });
});

/**
 * `carta-publica-alcance` + `ALCANCE_CARTA_PUBLICA` (Hito 5, pieza 5.2, paso 0.1; frontera de seguridad autorizada por el dueño el 2026-10-07).
 *
 * La regla de dependency-cruiser prohíbe que la carta pública (sin sesión) ALCANCE auth, permisos o `server/` salvo una lista cerrada de archivos, pero NO dice
 * nada de una entrada de la lista que sobra: un patrón que se ensancha (una carpeta entera en lugar de un archivo, un `gate.ts` agregado «por las dudas») deja de
 * proteger y `npm run arquitectura` sigue verde, porque solo falla ante una dependencia prohibida, nunca ante un permiso de más. Acá se calcula, sobre el grafo REAL
 * que dependency-cruiser arma (mismas opciones que el CLI), qué alcanza la carta dentro de la zona prohibida y se exige que sea EXACTAMENTE lo permitido:
 *
 *  1. Nada alcanzado dentro de la zona queda fuera de la lista (lo mismo que ya exige la regla; así también lo ve el test).
 *  2. Nada de lo que la lista permite deja de ser alcanzado: todo archivo que existe y cumple una entrada tiene que estar en el alcance de la carta, y cada
 *     entrada tiene que cubrir al menos un archivo alcanzado. Es la dirección que la regla no puede ver.
 *  3. Cada entrada nombra ARCHIVOS (`\.ts$`), no carpetas: una carpeta entera permite todo lo que mañana se le agregue.
 */
interface ReglaDeAlcance {
  from: { path: string };
  to: { path: string; pathNot: string[] };
}
interface ModuloDelGrafo {
  source: string;
  dependencies: { resolved: string }[];
}

/** El alcance de `desde` (cierre transitivo por imports, reexports e imports dinámicos; los puntos de entrada incluidos) contra la lista `permitidas` de la `zona`. */
function revisarAlcance(grafo: readonly ModuloDelGrafo[], desde: RegExp, zona: RegExp, permitidas: readonly RegExp[]) {
  const porRuta = new Map(grafo.map((m) => [m.source, m]));
  const vistos = new Set(grafo.filter((m) => desde.test(m.source)).map((m) => m.source));
  const pendientes = [...vistos];
  while (pendientes.length) {
    for (const d of porRuta.get(pendientes.pop()!)?.dependencies ?? []) {
      if (!vistos.has(d.resolved)) {
        vistos.add(d.resolved);
        pendientes.push(d.resolved);
      }
    }
  }
  const permitido = (ruta: string) => permitidas.some((p) => p.test(ruta));
  const alcanzadosEnZona = [...vistos].filter((r) => zona.test(r)).sort();
  return {
    alcanzadosEnZona,
    /** Alcanzados dentro de la zona que ninguna entrada permite. */
    sinPermiso: alcanzadosEnZona.filter((r) => !permitido(r)),
    /** Archivos que existen, caen en la zona y cumplen una entrada, pero la carta NO alcanza: permiso de más. */
    sobran: grafo
      .map((m) => m.source)
      .filter((r) => zona.test(r) && permitido(r) && !vistos.has(r))
      .sort(),
    /** Entradas que no cubren ningún archivo alcanzado. */
    entradasSinUso: permitidas.filter((p) => !alcanzadosEnZona.some((r) => p.test(r))).map((p) => p.source),
  };
}

describe("carta-publica-alcance: ALCANCE_CARTA_PUBLICA es exactamente lo que la carta alcanza (Hito 5, 5.2 paso 0.1)", () => {
  const regla = CONFIG.forbidden.find((r) => r.name === "carta-publica-alcance") as unknown as ReglaDeAlcance | undefined;

  it("la regla existe y su lista cerrada no está vacía", () => {
    expect(regla, "no está la regla carta-publica-alcance en la config").toBeDefined();
    expect(regla!.to.pathNot.length).toBeGreaterThan(0);
  });

  it("cada entrada de la lista nombra un ARCHIVO (termina en `\\.ts$`), nunca una carpeta", () => {
    const carpetas = regla!.to.pathNot.filter((e) => !e.endsWith("\\.ts$"));
    expect(carpetas, `ALCANCE_CARTA_PUBLICA: estas entradas no terminan en \\.ts$ (¿una carpeta?):\n${carpetas.join("\n")}`).toEqual([]);
  });

  it("la carta alcanza, dentro de la zona prohibida, exactamente lo que la lista permite (ni un archivo sin permiso, ni un permiso sin uso)", () => {
    const r = revisarAlcance(modulos, new RegExp(regla!.from.path), new RegExp(regla!.to.path), regla!.to.pathNot.map((e) => new RegExp(e)));
    expect(r.alcanzadosEnZona.length, "el cálculo de alcance no llega a la zona prohibida: la prueba pasaría en vacío").toBeGreaterThan(5);
    expect(r.sinPermiso, `La carta alcanza esto y ALCANCE_CARTA_PUBLICA no lo permite:\n${r.sinPermiso.join("\n")}`).toEqual([]);
    expect(r.sobran, `ALCANCE_CARTA_PUBLICA permite estos archivos que la carta NO alcanza (sobra permiso: ¿un patrón ensanchado?):\n${r.sobran.join("\n")}`).toEqual([]);
    expect(r.entradasSinUso, `Estas entradas de ALCANCE_CARTA_PUBLICA no cubren ningún archivo que la carta alcance:\n${r.entradasSinUso.join("\n")}`).toEqual([]);
  });

  describe("el cálculo (con un grafo sintético)", () => {
    const modulo = (source: string, ...deps: string[]): ModuloDelGrafo => ({ source, dependencies: deps.map((resolved) => ({ resolved })) });
    const grafo = [
      modulo("src/app/pagina.tsx", "src/server/a.ts"),
      modulo("src/server/a.ts", "src/lib/ayuda.ts", "src/server/b.ts"),
      modulo("src/server/b.ts"),
      modulo("src/server/c.ts"),
      modulo("src/lib/ayuda.ts"),
    ];
    const desde = /^src\/app\//;
    const zona = /^src\/server\//;

    it("todo permitido y alcanzado: sin hallazgos", () => {
      const r = revisarAlcance(grafo, desde, zona, [/^src\/server\/(a|b)\.ts$/]);
      expect([r.sinPermiso, r.sobran, r.entradasSinUso]).toEqual([[], [], []]);
    });

    it("un alcanzado sin permiso se marca (y se sigue por los intermedios fuera de la zona)", () => {
      expect(revisarAlcance(grafo, desde, zona, [/^src\/server\/a\.ts$/]).sinPermiso).toEqual(["src/server/b.ts"]);
    });

    it("una entrada ensanchada permite un archivo que nadie alcanza: sobra", () => {
      const r = revisarAlcance(grafo, desde, zona, [/^src\/server\//]);
      expect(r.sobran).toEqual(["src/server/c.ts"]);
    });

    it("una entrada que no cubre nada alcanzado se marca", () => {
      expect(revisarAlcance(grafo, desde, zona, [/^src\/server\/(a|b)\.ts$/, /^src\/server\/c\.ts$/]).entradasSinUso).toEqual(["^src\\/server\\/c\\.ts$"]);
    });
  });
});
