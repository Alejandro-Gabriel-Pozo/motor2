import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RAIZ_DEL_REPO } from "../../cercos/trinquete";
import { SEPARADOR_DE_LISTA_DE_CARTA } from "../contratos/separador-de-lista-de-carta";
import { MANIFIESTO } from "../manifiesto";
import { revisarContratos } from "../motor";
import { fechaUtcDeHoy } from "../politica";
import type { Contrato } from "../tipos";
import {
  AREAS,
  IDS_DE_CONTRATO,
  POLITICA_DE_TIPOS,
  areaDe,
  carpetasDeNucleo,
  compararAreas,
  formatearHallazgoDeArea,
  formatearReporteDeAreas,
  posicionEnTexto,
  resumirAreas,
  revisarAreasDelRepo,
  type DeclaracionDeAreas,
  type HallazgoDeArea,
  type ResultadoDeAreas,
} from "./areas";
import { REGLAS_DE_RUTA, TIPOS_DE_RUTA, clasificarRutas, listarRutasConGit, type TipoDeRuta } from "./clasificacion";
import { usosDeContratos } from "./usos";

/**
 * Guardián «cada área declara sus contratos» (G3): corre `areas.ts` sobre el repo real (UNA prueba, que imprime el conteo de áreas), prueba el mecanismo con árboles
 * temporales y muta una COPIA EXACTA del repo (nunca el repo real, y sin `git checkout`: cada mutación se deshace a mano sobre la copia).
 */

const HOY = "2026-10-21";
const vistos = (r: ResultadoDeAreas): [string, string][] => r.hallazgos.map((h) => [h.tipo, h.area]);

// ---------------------------------------------------------------------------------------------------------------------------------
// El repo real
// ---------------------------------------------------------------------------------------------------------------------------------

describe("áreas y contratos declarados (repo real)", () => {
  let memo: ResultadoDeAreas | undefined;
  const real = (): ResultadoDeAreas => (memo ??= revisarAreasDelRepo(RAIZ_DEL_REPO, fechaUtcDeHoy()));

  it("cada área declara sus contratos y la declaración coincide con los usos reales", () => {
    const r = real();
    // El conteo de áreas sale siempre, también en verde.
    console.info(`[areas] ${resumirAreas(r)}`);
    expect(r.hallazgos.map(formatearHallazgoDeArea), `\n${formatearReporteDeAreas(r)}`).toEqual([]);
  });

  it("toda área real tiene su línea en AREAS y viceversa (la cuenta cierra)", () => {
    const r = real();
    expect(r.areas.map((a) => a.nombre).sort()).toEqual(Object.keys(AREAS).sort());
    expect(r.conLista + r.conVacio).toBe(r.areas.length);
    expect(r.areas.length).toBeGreaterThan(0);
  });

  it("las 21 áreas del núcleo salen de .dependency-cruiser-dominios.cjs, más los archivos sueltos de la raíz de core", () => {
    const dominios = carpetasDeNucleo(RAIZ_DEL_REPO);
    expect(dominios).toHaveLength(21);
    const delNucleo = real().areas.filter((a) => a.tipo === "nucleo").map((a) => a.nombre);
    expect(delNucleo.filter((n) => n !== "core").sort()).toEqual(dominios.map((d) => `core/${d}`).sort());
    expect(delNucleo).toContain("core");
  });

  it("los ids que se pueden declarar existen en el manifiesto, y el área de la carta declara los dos contratos de la carta que el motor ve", () => {
    const delManifiesto = new Set(MANIFIESTO.map((c) => c.id));
    for (const id of IDS_DE_CONTRATO) expect(delManifiesto.has(id), `«${id}» está en IDS_DE_CONTRATO y no en el manifiesto`).toBe(true);
    const usos = usosDeContratos(RAIZ_DEL_REPO, MANIFIESTO);
    const deLaCarta = usos.filter((u) => u.archivos.some((f) => f.ruta.startsWith("src/components/carta-publica/"))).map((u) => u.id).sort();
    expect([...(AREAS["components/carta-publica"] ?? [])].sort()).toEqual(deLaCarta);
    expect(deLaCarta.length).toBeGreaterThan(0);
  });

  it("las áreas con contratos hoy son las que el motor dice y todas las demás declaran [] explícito", () => {
    const conContratos = Object.entries(AREAS).filter(([, ids]) => ids.length > 0).map(([a]) => a);
    expect(conContratos).toEqual(["app/(app)/administracion", "app/(app)/carta", "app/(app)/catalogo", "app/(app)/inicio", "app/(app)/movimientos", "app/(app)/stock", "app/(app)/traspasos", "app/invitacion", "app/login", "components", "components/carta-publica", "components/catalogo", "ui"]);
    for (const ids of Object.values(AREAS)) expect(Array.isArray(ids)).toBe(true);
  });

  it("la política cubre cada tipo de ruta; los que no declaran dicen por qué (20 caracteres o más)", () => {
    expect(Object.keys(POLITICA_DE_TIPOS).sort()).toEqual([...TIPOS_DE_RUTA].sort());
    for (const tipo of TIPOS_DE_RUTA) {
      const p = POLITICA_DE_TIPOS[tipo];
      if (!p.declara) expect(p.motivo.trim().length, tipo).toBeGreaterThanOrEqual(20);
    }
    for (const tipo of ["pruebas", "documentacion", "configuracion", "activos", "ci", "agentes"] as const) expect(POLITICA_DE_TIPOS[tipo].declara, tipo).toBe(false);
    for (const tipo of ["frontend", "trabajo-programado", "nucleo", "servidor", "consola", "scripts"] as const) expect(POLITICA_DE_TIPOS[tipo].declara, tipo).toBe(true);
  });

  it("tsc rechaza un id de contrato que no existe", () => {
    // @ts-expect-error «contrato-inventado» no es un IdDeContrato: si compilara, la unión no estaría protegiendo nada.
    const falsa: DeclaracionDeAreas = { ui: ["contrato-inventado"] };
    expect(Object.keys(falsa)).toEqual(["ui"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Derivar el área de una ruta
// ---------------------------------------------------------------------------------------------------------------------------------

describe("areaDe", () => {
  it.each<[string, TipoDeRuta, string | null]>([
    ["src/app/page.tsx", "frontend", "app"],
    ["src/app/globals.css", "frontend", "app"],
    ["src/app/(app)/layout.tsx", "frontend", "app/(app)"],
    ["src/app/(app)/stock/page.tsx", "frontend", "app/(app)/stock"],
    ["src/app/(app)/stock/hondo/uno/otro.tsx", "frontend", "app/(app)/stock"],
    ["src/app/(pos)/pos/page.tsx", "frontend", "app/(pos)"],
    ["src/app/(carta-publica)/x/page.tsx", "frontend", "app/(carta-publica)"],
    ["src/app/api/salud/route.ts", "frontend", "app/api"],
    ["src/app/login/actions.ts", "frontend", "app/login"],
    ["src/app/api/cron/sincronizar/route.ts", "trabajo-programado", "app/api/cron"],
    ["src/components/modal.tsx", "frontend", "components"],
    ["src/components/mesas/a/b.tsx", "frontend", "components/mesas"],
    ["src/ui/boton.tsx", "frontend", "ui"],
    ["src/core/moneda.ts", "nucleo", "core"],
    ["src/core/stock/a/b.ts", "nucleo", "core/stock"],
    ["src/server/actions/stock/x.ts", "servidor", "server/actions"],
    ["src/lib/db.ts", "servidor", "lib"],
    ["src/lib/correo/x.ts", "servidor", "lib"],
    ["src/types/x.ts", "servidor", "types"],
    ["src/env.ts", "servidor", "src"],
    ["plataforma/next.config.ts", "consola", "plataforma"],
    ["plataforma/src/db.ts", "consola", "plataforma"],
    ["plataforma/src/app/page.tsx", "consola", "plataforma/app"],
    ["plataforma/src/servidor/x.ts", "consola", "plataforma/servidor"],
    ["scripts/medir-cuit.ts", "scripts", "scripts"],
    ["scripts/operaciones/con-env.mjs", "scripts", "scripts/operaciones"],
    ["src/ui/x.tsx", "nucleo", null],
    ["otra/x.ts", "scripts", null],
    ["test/a.test.ts", "pruebas", null],
  ])("%s (%s) → %s", (ruta, tipo, esperada) => {
    expect(areaDe(ruta, tipo)).toBe(esperada);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// El mecanismo, con un árbol temporal
// ---------------------------------------------------------------------------------------------------------------------------------

// Se arman sobre un contrato real (no desde cero) para no depender de qué campos tenga `Contrato`: lo que sea obligatorio llega por la copia.
const CONTRATO_A: Contrato = {
  ...SEPARADOR_DE_LISTA_DE_CARTA,
  id: "ctr-a",
  porQue: "una caja sin marco pinta el borde con el color equivocado en todo el sistema",
  fuente: { archivo: "src/app/globals.css", ancla: ".fuente-a .marco" },
  alcance: { raices: ["src/components", "src/app", "test"], extensiones: [".tsx"] },
  senales: [{ adaptador: "clases", token: /^caja$/, que: "usa `caja`" }],
  declaracion: { tipo: "clase-companera", clase: "marco", equivalentes: [] },
  definicion: [],
  consumidores: "descubiertos",
  excepciones: [],
  deuda: [],
};
const CONTRATO_B: Contrato = {
  ...CONTRATO_A,
  id: "ctr-b",
  fuente: { archivo: "src/app/globals.css", ancla: ".fuente-b .tapa" },
  senales: [{ adaptador: "clases", token: /^otra$/, que: "usa `otra`" }],
  declaracion: { tipo: "clase-companera", clase: "tapa", equivalentes: [] },
};

const GLOBALS = `/* @contrato ctr-a */
.fuente-a .marco { border-color: red; }
/* @contrato ctr-b */
.fuente-b .tapa { border-color: blue; }
`;
const tsx = (clases: string): string => `export const X = () => <div className="${clases}" />;\n`;
/** Un repo chico: dos áreas de frontend que usan ctr-a (una lo declara en el archivo, otra no), una vacía, núcleo, una prueba y un documento. */
const BASE: Record<string, string> = {
  "src/app/globals.css": GLOBALS,
  "src/app/page.tsx": tsx("caja marco"),
  "src/components/uno/a.tsx": tsx("caja marco"),
  "src/components/dos/b.tsx": tsx("caja"),
  "src/components/tres/c.tsx": tsx("nada"),
  "src/core/nuevo/n.ts": "export const n = 1;\n",
  "test/x.test.tsx": tsx("caja"),
  "docs/notas.md": "# notas\n",
};
const DECLARACION_BASE: Record<string, readonly string[]> = {
  "app": [],
  "components/uno": ["ctr-a"],
  "components/dos": ["ctr-a"],
  "components/tres": [],
  "core/nuevo": [],
};

let arbol: string;
function escribir(raiz: string, archivos: Record<string, string>): void {
  for (const [ruta, contenido] of Object.entries(archivos)) {
    const absoluta = join(raiz, ...ruta.split("/"));
    mkdirSync(dirname(absoluta), { recursive: true });
    writeFileSync(absoluta, contenido);
  }
}
const tiposDe = (rutas: readonly string[]): ReadonlyMap<string, TipoDeRuta> => clasificarRutas({ archivos: rutas, ignorados: [], crons: [], reglas: REGLAS_DE_RUTA, exclusiones: [], hoy: HOY }).tipos;

/** Corre la comparación sobre el árbol temporal con `archivos` (los de BASE más los que se agreguen) y la declaración dada. */
function comparar(declaraciones: Record<string, readonly string[]>, archivos: Record<string, string> = {}, contratos: readonly Contrato[] = [CONTRATO_A, CONTRATO_B]): ResultadoDeAreas {
  escribir(arbol, archivos);
  const rutas = [...new Set([...Object.keys(BASE), ...Object.keys(archivos)])].sort();
  return compararAreas({ tipos: tiposDe(rutas), declaraciones, usos: usosDeContratos(arbol, contratos), posicionDeEntrada: () => ({ linea: 7, columna: 3 }) });
}

beforeEach(() => {
  arbol = mkdtempSync(join(tmpdir(), "areas-"));
  escribir(arbol, BASE);
});
afterEach(() => {
  rmSync(arbol, { recursive: true, force: true });
});

describe("cada área declara lo que usa (árbol temporal)", () => {
  it("todo declarado y usado: sin hallazgos; las áreas se cuentan por tipo y los archivos sin declaración también", () => {
    const r = comparar(DECLARACION_BASE);
    expect(r.hallazgos).toEqual([]);
    expect(r.areas.map((a) => a.nombre)).toEqual(["app", "components/dos", "components/tres", "components/uno", "core/nuevo"]);
    expect(r.conLista).toBe(2);
    expect(r.conVacio).toBe(3);
    expect(r.sinDeclarar).toEqual({ pruebas: 1, documentacion: 1 });
    expect(resumirAreas(r)).toBe("5 áreas (frontend 4, nucleo 1) · 3 declaran [] · 2 declaran contratos · archivos de tipos que no declaran: documentacion 1, pruebas 1");
  });

  it("un área nueva sin declaración es area-sin-declaracion y trae la línea exacta para pegar", () => {
    const r = comparar(DECLARACION_BASE, { "src/core/dominio-nuevo/x.ts": "export const x = 1;\n" });
    expect(vistos(r)).toEqual([["area-sin-declaracion", "core/dominio-nuevo"]]);
    expect(formatearHallazgoDeArea(r.hallazgos[0])).toBe(
      "src/core/dominio-nuevo/x.ts:1:1  [areas · area-sin-declaracion]\n" +
        '  el área «core/dominio-nuevo» (nucleo, 1 archivo) no declara sus contratos → pegá en `AREAS` de «test/arquitectura/contratos/gobernanza/areas.ts» la línea: "core/dominio-nuevo": [],  (`[]` = no depende de ningún contrato)'
    );
  });

  it("si el área nueva ya usa un contrato, la línea sugerida lo declara", () => {
    const r = comparar(DECLARACION_BASE, { "src/components/cuatro/d.tsx": tsx("caja otra marco") });
    expect(vistos(r)).toEqual([["area-sin-declaracion", "components/cuatro"]]);
    expect(r.hallazgos[0].que).toContain("usa «ctr-a», «ctr-b»");
    expect(r.hallazgos[0].como).toContain('"components/cuatro": ["ctr-a", "ctr-b"],');
  });

  it("declarar [] y usar un contrato es dependencia-omitida, en el archivo y la posición del primer uso", () => {
    const r = comparar({ ...DECLARACION_BASE, "components/dos": [] });
    expect(vistos(r)).toEqual([["dependencia-omitida", "components/dos"]]);
    expect(formatearHallazgoDeArea(r.hallazgos[0])).toBe(
      `src/components/dos/b.tsx:1:${tsx("caja").indexOf("caja") + 1}  [areas · dependencia-omitida]\n` +
        "  el área «components/dos» usa el contrato «ctr-a» (1 archivo; el primero, este) y no lo declara → agregá «ctr-a» a la línea de «components/dos» en `AREAS` de «test/arquitectura/contratos/gobernanza/areas.ts»; antes agregá «ctr-a» a `IDS_DE_CONTRATO`"
    );
  });

  it("declarar un contrato que nada del área usa es dependencia-falsa y bloquea (en la línea de la entrada)", () => {
    const r = comparar({ ...DECLARACION_BASE, "components/tres": ["ctr-a"] });
    expect(vistos(r)).toEqual([["dependencia-falsa", "components/tres"]]);
    expect(r.hallazgos[0]).toMatchObject({ archivo: "test/arquitectura/contratos/gobernanza/areas.ts", linea: 7, columna: 3 });
    expect(r.hallazgos[0].que).toContain("ningún archivo del área lo usa");
  });

  it("una entrada de un área que no existe es area-fantasma", () => {
    const r = comparar({ ...DECLARACION_BASE, "core/borrado": [] });
    expect(vistos(r)).toEqual([["area-fantasma", "core/borrado"]]);
    expect(formatearHallazgoDeArea(r.hallazgos[0])).toContain("[areas · area-fantasma]");
  });

  it("un área real que se renombra deja un area-fantasma (la vieja) y un area-sin-declaracion (la nueva)", () => {
    const sin = { ...DECLARACION_BASE };
    delete sin["components/tres"];
    const r = comparar({ ...sin, "components/tres-viejo": [] });
    expect(vistos(r).sort()).toEqual([["area-fantasma", "components/tres-viejo"], ["area-sin-declaracion", "components/tres"]]);
  });

  it("agregar una etiqueta sin uso real NO silencia la omisión: el uso sigue sin declarar y la etiqueta sobra", () => {
    const r = comparar({ ...DECLARACION_BASE, "components/dos": ["ctr-b"] });
    expect(vistos(r).sort()).toEqual([["dependencia-falsa", "components/dos"], ["dependencia-omitida", "components/dos"]]);
    expect(r.hallazgos.find((h) => h.tipo === "dependencia-falsa")?.que).toContain("«ctr-b»");
    expect(r.hallazgos.find((h) => h.tipo === "dependencia-omitida")?.que).toContain("«ctr-a»");
  });

  it("un id que no existe en el manifiesto es dependencia-falsa; uno repetido también", () => {
    const r = comparar({ ...DECLARACION_BASE, "components/tres": ["ctr-inventado"], "components/uno": ["ctr-a", "ctr-a"] });
    expect(vistos(r).sort()).toEqual([["dependencia-falsa", "components/tres"], ["dependencia-falsa", "components/uno"]]);
    expect(r.hallazgos.map((h) => h.que).join("\n")).toContain("no existe en el manifiesto");
    expect(r.hallazgos.map((h) => h.que).join("\n")).toContain("más de una vez");
  });

  it("el uso sin declaración por ARCHIVO sigue siendo uso-sin-declarar del motor aunque el área lo declare", () => {
    // `components/dos` declara ctr-a y el área compara limpia (un archivo la usa), pero `b.tsx` no lleva la clase compañera: el motor lo marca.
    expect(comparar(DECLARACION_BASE).hallazgos).toEqual([]);
    const motor = revisarContratos({ raiz: arbol, contratos: [CONTRATO_A, CONTRATO_B], hoy: HOY });
    expect(motor.hallazgos.filter((h) => h.tipo === "uso-sin-declarar").map((h) => [h.contrato, h.tipo, h.archivo])).toEqual([
      ["ctr-a", "uso-sin-declarar", "src/components/dos/b.tsx"],
      ["ctr-a", "uso-sin-declarar", "test/x.test.tsx"],
    ]);
  });

  it("el área que contiene la fuente queda eximida de declararlo, aunque otro archivo suyo use el contrato", () => {
    const r = comparar(DECLARACION_BASE, { "src/app/otra.tsx": tsx("caja") });
    expect(r.hallazgos).toEqual([]);
    // ...pero la exención no alcanza a las demás áreas.
    expect(vistos(comparar({ ...DECLARACION_BASE, "components/uno": [] })).sort()).toEqual([["dependencia-omitida", "components/uno"]]);
  });

  it("un tipo de ruta que no declara (pruebas, documentación) no genera hallazgos aunque use el contrato", () => {
    // `test/x.test.tsx` usa `caja` sin marco y `docs/notas.md` existe: ninguno tiene área ni se le pide declaración.
    const usos = usosDeContratos(arbol, [CONTRATO_A]);
    expect(usos[0].archivos.map((f) => f.ruta)).toContain("test/x.test.tsx");
    const r = comparar(DECLARACION_BASE);
    expect(r.hallazgos).toEqual([]);
    expect(r.areas.flatMap((a) => a.archivos)).not.toContain("test/x.test.tsx");
    expect(r.areas.flatMap((a) => a.archivos)).not.toContain("docs/notas.md");
  });

  it("un archivo de un tipo que declara y que no cae en ninguna área es area-sin-clasificar (seguro)", () => {
    const r = compararAreas({ tipos: new Map<string, TipoDeRuta>([["otra/x.ts", "scripts"]]), declaraciones: {}, usos: [], posicionDeEntrada: () => ({ linea: 1, columna: 1 }) });
    expect(vistos(r)).toEqual([["area-sin-clasificar", ""]]);
    expect(formatearHallazgoDeArea(r.hallazgos[0])).toContain("otra/x.ts:1:1  [areas · area-sin-clasificar]");
  });

  it("los hallazgos salen ordenados por archivo, línea y columna", () => {
    const r = comparar({ ...DECLARACION_BASE, "components/dos": [], "components/tres": ["ctr-a"], "core/borrado": [] }, { "src/core/dominio-nuevo/x.ts": "export const x = 1;\n" });
    const claves = r.hallazgos.map((h) => `${h.archivo}:${h.linea}:${h.columna}`);
    expect(claves).toEqual([...claves].sort((a, b) => a.localeCompare(b)));
    expect(r.hallazgos).toHaveLength(4);
  });
});

describe("posicionEnTexto", () => {
  it("encuentra la línea y la columna de la entrada de un área", () => {
    const texto = 'export const AREAS = {\n  "a": [],\n  "b/c": ["x"],\n};\n';
    expect(posicionEnTexto(texto, "b/c")).toEqual({ linea: 3, columna: 3 });
    expect(posicionEnTexto(texto, "no-esta")).toEqual({ linea: 1, columna: 1 });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Mutaciones sobre una COPIA EXACTA del repo real
// ---------------------------------------------------------------------------------------------------------------------------------

describe("mutaciones sobre una copia exacta del repo", () => {
  let copia: string;
  const correr = (declaraciones: DeclaracionDeAreas = AREAS): ResultadoDeAreas => revisarAreasDelRepo(copia, HOY, declaraciones);
  const mostrar = (titulo: string, r: ResultadoDeAreas): void => {
    console.info(`[mutacion] ${titulo}\n${r.hallazgos.map(formatearHallazgoDeArea).join("\n")}`);
  };
  const porTipo = (r: ResultadoDeAreas, tipo: HallazgoDeArea["tipo"]): HallazgoDeArea[] => r.hallazgos.filter((h) => h.tipo === tipo);

  beforeAll(() => {
    copia = mkdtempSync(join(tmpdir(), "areas-copia-"));
    // Copia exacta de lo versionado más lo nuevo sin versionar (el mismo recorrido de la clasificación), con su propio repo git para que el recorrido funcione.
    for (const ruta of listarRutasConGit(RAIZ_DEL_REPO).archivos) {
      const destino = join(copia, ...ruta.split("/"));
      mkdirSync(dirname(destino), { recursive: true });
      cpSync(join(RAIZ_DEL_REPO, ...ruta.split("/")), destino);
    }
    execFileSync("git", ["-C", copia, "init", "-q"]);
  }, 60_000);
  afterAll(() => {
    rmSync(copia, { recursive: true, force: true });
  });

  it("la copia exacta da el mismo veredicto que el repo: sin hallazgos y las mismas áreas", () => {
    const r = correr();
    expect(r.hallazgos.map(formatearHallazgoDeArea)).toEqual([]);
    expect(r.areas.map((a) => a.nombre).sort()).toEqual(Object.keys(AREAS).sort());
  }, 60_000);

  it("crear src/core/dominio-nuevo/x.ts → area-sin-declaracion con la línea para pegar", () => {
    const nuevo = join(copia, "src", "core", "dominio-nuevo", "x.ts");
    mkdirSync(dirname(nuevo), { recursive: true });
    writeFileSync(nuevo, "export const x = 1;\n");
    try {
      const r = correr();
      mostrar("crear src/core/dominio-nuevo/x.ts", r);
      expect(vistos(r)).toEqual([["area-sin-declaracion", "core/dominio-nuevo"]]);
      expect(r.hallazgos[0].como).toContain('"core/dominio-nuevo": [],');
    } finally {
      rmSync(join(copia, "src", "core", "dominio-nuevo"), { recursive: true, force: true });
    }
    expect(correr().hallazgos).toEqual([]);
  }, 60_000);

  it("renombrar una carpeta de src/ → falla: la nueva aparece sin declaración y la vieja queda fantasma", () => {
    const vieja = join(copia, "src", "components", "mesas");
    const nueva = join(copia, "src", "components", "mesas-renombrada");
    renameSync(vieja, nueva);
    try {
      const r = correr();
      mostrar("renombrar src/components/mesas → src/components/mesas-renombrada", r);
      expect(vistos(r).sort()).toEqual([["area-fantasma", "components/mesas"], ["area-sin-declaracion", "components/mesas-renombrada"]]);
    } finally {
      renameSync(nueva, vieja);
    }
    expect(correr().hallazgos).toEqual([]);
  }, 60_000);

  it("quitar los contratos de components/carta-publica de la declaración → dependencia-omitida (uno por contrato)", () => {
    const r = correr({ ...AREAS, "components/carta-publica": [] });
    mostrar("components/carta-publica: []", r);
    const omitidas = porTipo(r, "dependencia-omitida");
    expect(omitidas.map((h) => h.area)).toEqual(["components/carta-publica", "components/carta-publica"]);
    expect(omitidas.every((h) => h.archivo.startsWith("src/components/carta-publica/"))).toBe(true);
    expect(r.hallazgos).toHaveLength(2);
  }, 60_000);

  it("agregar un id falso → no compila, y si se cuela es dependencia-falsa", () => {
    // @ts-expect-error «id-falso» no es un IdDeContrato.
    const ids: DeclaracionDeAreas = { ...AREAS, lib: ["id-falso"] };
    const r = correr(ids);
    mostrar('lib: ["id-falso"]', r);
    expect(vistos(r)).toEqual([["dependencia-falsa", "lib"]]);
  }, 60_000);

  it("declarar un contrato real en un área que no lo usa → dependencia-falsa", () => {
    const r = correr({ ...AREAS, lib: ["borde-propio-de-carta"] });
    mostrar('lib: ["borde-propio-de-carta"]', r);
    expect(vistos(r)).toEqual([["dependencia-falsa", "lib"]]);
  }, 60_000);

  it("la copia se deshace sola: el repo real no se tocó", () => {
    expect(existsSync(join(RAIZ_DEL_REPO, "src", "core", "dominio-nuevo"))).toBe(false);
    expect(existsSync(join(RAIZ_DEL_REPO, "src", "components", "mesas-renombrada"))).toBe(false);
  });
});
