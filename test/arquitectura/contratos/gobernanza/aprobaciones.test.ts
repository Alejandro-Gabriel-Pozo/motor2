import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RAIZ_DEL_REPO } from "../../cercos/trinquete";
import { BORDE_PROPIO_DE_CARTA } from "../contratos/borde-propio-de-carta";
import { MANIFIESTO } from "../manifiesto";
import type { Contrato } from "../tipos";
import { POLITICA_DE_TIPOS } from "./areas";
import {
  APROBACIONES,
  ARCHIVO_DE_APROBACIONES,
  RETIRADO,
  claveDeContrato,
  formatearHallazgoDeAprobacion,
  formatearReporteDeAprobaciones,
  huellaDeBlob,
  huellasActuales,
  idsDeContratosAprobados,
  normalizarWorkflow,
  resumirAprobaciones,
  revisarAprobaciones,
  rutasDelMecanismo,
  sinDatos,
  type Aprobacion,
  type EntradaDeAprobaciones,
  type HallazgoDeAprobacion,
} from "./aprobaciones";
import { EXCLUSIONES, type Exclusion } from "./exclusiones";

/**
 * Guardián «el mecanismo solo cambia con una aprobación registrada» (G6): el registro de `aprobaciones.ts` sobre el repo real (0 hallazgos) y, sobre una COPIA temporal del mecanismo
 * (nunca el repo real), lo que tiene que pasar cuando alguien lo cambia: un byte de `motor.ts`, `scripts.test`, un caso legítimo nuevo, una exclusión, la política de tipos. Cada cambio
 * pone el guardián en rojo con el archivo y la huella actual, y vuelve a verde solo cuando se suma la aprobación (referencia + motivo) al registro.
 */

const real = (extra: Partial<EntradaDeAprobaciones> = {}): EntradaDeAprobaciones => ({ raiz: RAIZ_DEL_REPO, contratos: MANIFIESTO, exclusiones: EXCLUSIONES, politicaDeTipos: POLITICA_DE_TIPOS, registro: APROBACIONES, ...extra });
const tipos = (hallazgos: readonly HallazgoDeAprobacion[]): string[] => hallazgos.map((h) => `${h.tipo} · ${h.clave}`);
const CARPETA = "test/arquitectura/contratos";

// ---------------------------------------------------------------------------------------------------------------------------------
// El repo real
// ---------------------------------------------------------------------------------------------------------------------------------

describe("registro de aprobaciones (repo real)", () => {
  it("cada pieza del mecanismo tiene la huella de su última aprobación: 0 hallazgos", () => {
    const t0 = performance.now();
    const r = revisarAprobaciones(real());
    console.info(`[aprobaciones] ${resumirAprobaciones(r)} · ${(performance.now() - t0).toFixed(0)} ms`);
    expect(r.hallazgos.map(formatearHallazgoDeAprobacion), `\n${formatearReporteDeAprobaciones(r)}`).toEqual([]);
  });

  it("el registro vigila el mecanismo entero: motor, tipos, política, índice, adaptadores, gobernanza, arnés, configuraciones, scripts, CI y la definición gobernada de cada contrato", () => {
    const claves = [...huellasActuales(real()).keys()];
    for (const esperada of [
      `${CARPETA}/motor.ts`,
      `${CARPETA}/tipos.ts`,
      `${CARPETA}/politica.ts`,
      `${CARPETA}/indice.ts`,
      `${CARPETA}/adaptadores/ts.ts`,
      `${CARPETA}/adaptadores/css.ts`,
      `${CARPETA}/gobernanza/clasificacion.ts`,
      `${CARPETA}/gobernanza/cumplimiento.ts`,
      `${CARPETA}/gobernanza/areas.ts#logica`,
      `${CARPETA}/gobernanza/areas.ts#politica-de-tipos`,
      `${CARPETA}/gobernanza/exclusiones.ts#logica`,
      `${CARPETA}/gobernanza/exclusiones.ts#exclusiones`,
      `${CARPETA}/gobernanza/aprobaciones.ts#logica`,
      `${CARPETA}/mutaciones/arnes.ts`,
      `${CARPETA}/mutaciones/operadores.ts`,
      "vitest.config.ts",
      "playwright.config.ts",
      ".gitignore",
      "package.json#scripts",
      ".github/workflows/ci.yml#sin-sha",
      ...MANIFIESTO.map((c) => claveDeContrato(c.id)),
    ]) {
      expect(claves, esperada).toContain(esperada);
    }
  });

  it("toda aprobación del registro está completa (huella de 40 hexadecimales o «retirado», referencia válida, motivo de 20 caracteres o más) y la línea de base cita a DEC-03", () => {
    expect(APROBACIONES.length).toBeGreaterThan(0);
    for (const a of APROBACIONES) {
      expect(a.blob === RETIRADO || /^[0-9a-f]{40}$/.test(a.blob), `${a.archivo}: ${a.blob}`).toBe(true);
      expect(/^(?:PR #\d+|commit [0-9a-f]{7,40}|DEC-\d{2,})$/.test(a.referencia), `${a.archivo}: ${a.referencia}`).toBe(true);
      expect(a.motivo.trim().length, a.archivo).toBeGreaterThanOrEqual(20);
    }
    expect(APROBACIONES[0].referencia).toBe("DEC-03");
    expect(APROBACIONES[0].motivo).toContain("línea de base del mecanismo, Fase 6");
  });

  it("el conjunto de ids de contratos aprobados es el del manifiesto", () => {
    expect(idsDeContratosAprobados(APROBACIONES)).toEqual(MANIFIESTO.map((c) => c.id).sort());
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// La huella
// ---------------------------------------------------------------------------------------------------------------------------------

describe("huella de blob de git", () => {
  const gitHashObject = (texto: string): string => execFileSync("git", ["hash-object", "--stdin"], { input: texto, encoding: "utf8" }).trim();

  it("coincide con `git hash-object` y no depende del fin de línea", () => {
    expect(huellaDeBlob("hola\n")).toBe(gitHashObject("hola\n"));
    expect(huellaDeBlob("línea con tilde y ñ\nsegunda\n")).toBe(gitHashObject("línea con tilde y ñ\nsegunda\n"));
    expect(huellaDeBlob("hola\r\nmundo\r\n")).toBe(huellaDeBlob("hola\nmundo\n"));
    expect(huellaDeBlob("hola\n")).not.toBe(huellaDeBlob("hola \n"));
  });

  it("el workflow sin SHA: una actualización de Dependabot (SHA y versión nuevos) no cambia la huella; cualquier otro cambio sí", () => {
    const sha1 = "a".repeat(40);
    const sha2 = "b".repeat(40);
    const ci = (sha: string, version: string): string => `jobs:\n  e:\n    steps:\n      - uses: actions/checkout@${sha} # ${version}\n      - uses: actions/setup-node@${sha}   # ${version}\n      - run: npm ci\n`;
    expect(normalizarWorkflow(ci(sha1, "v4.4.0"))).toBe(normalizarWorkflow(ci(sha2, "v4.5.1")));
    expect(normalizarWorkflow(ci(sha1, "v4.4.0"))).toContain("actions/checkout@SHA\n");
    expect(huellaDeBlob(normalizarWorkflow(ci(sha1, "v4.4.0")))).not.toBe(huellaDeBlob(normalizarWorkflow(ci(sha1, "v4.4.0").replace("npm ci", "npm install"))));
    // Una action que deja de estar fijada por SHA NO se normaliza: cambia la huella.
    expect(normalizarWorkflow(ci(sha1, "v4.4.0"))).not.toBe(normalizarWorkflow(ci(sha1, "v4.4.0").replace(`actions/checkout@${sha1}`, "actions/checkout@v4")));
  });

  it("sinDatos saca solo las constantes que son datos puros: cambiar un dato no cambia la lógica; una llamada o una cuenta se queda adentro", () => {
    const fuente = (dato: string, logica: string): string => `import { x } from "./x";\n/** datos */\nexport const AREAS = {\n  "a": ${dato},\n};\nexport function f() {\n  return ${logica};\n}\n`;
    const a = sinDatos(fuente("[]", "1"), "x.ts", ["AREAS"]);
    expect(sinDatos(fuente('["borde"]', "1"), "x.ts", ["AREAS"])).toBe(a);
    expect(sinDatos(fuente("[]", "2"), "x.ts", ["AREAS"])).not.toBe(a);
    expect(a).not.toContain("AREAS");
    expect(a).toContain("export function f()");
    const conLlamada = "export const AREAS = construir();\nexport function f() {}\n";
    expect(sinDatos(conLlamada, "x.ts", ["AREAS"])).toBe(conLlamada);
    const conCuenta = "export const AREAS = 1 + uno;\n";
    expect(sinDatos(conCuenta, "x.ts", ["AREAS"])).toBe(conCuenta);
    const conFuncion = "export const AREAS = { a: () => 1 };\n";
    expect(sinDatos(conFuncion, "x.ts", ["AREAS"])).toBe(conFuncion);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Mutaciones sobre una COPIA del mecanismo
// ---------------------------------------------------------------------------------------------------------------------------------

describe("cambiar el mecanismo pone el guardián en rojo hasta registrar la aprobación (copia temporal)", () => {
  let copia: string;
  const ruta = (r: string): string => join(copia, ...r.split("/"));
  const leer = (r: string): string => readFileSync(ruta(r), "utf8");
  const correr = (extra: Partial<EntradaDeAprobaciones> = {}): HallazgoDeAprobacion[] => revisarAprobaciones(real({ raiz: copia, ...extra })).hallazgos;
  const mostrar = (titulo: string, hallazgos: readonly HallazgoDeAprobacion[]): void => {
    console.info(`[mutacion] ${titulo}\n${hallazgos.map(formatearHallazgoDeAprobacion).join("\n")}`);
  };
  /** Cambia un archivo de la copia, corre el registro y lo deja como estaba. */
  const mutar = (archivo: string, de: string, a: string, titulo: string): HallazgoDeAprobacion[] => {
    const original = leer(archivo);
    expect(original.includes(de), `«${de}» tiene que estar en ${archivo}`).toBe(true);
    writeFileSync(ruta(archivo), original.replace(de, a));
    try {
      const r = correr();
      mostrar(titulo, r);
      return r;
    } finally {
      writeFileSync(ruta(archivo), original);
    }
  };
  /** La entrada de registro que aprueba la huella actual de `clave` (en la copia, con los cambios en curso). */
  const aprobar = (clave: string, extra: Partial<EntradaDeAprobaciones> = {}): Aprobacion => ({
    archivo: clave,
    blob: huellasActuales(real({ raiz: copia, ...extra })).get(clave)?.huella ?? RETIRADO,
    referencia: "DEC-03",
    motivo: "cambio de prueba aprobado a propósito en el test",
  });

  beforeAll(() => {
    copia = mkdtempSync(join(tmpdir(), "aprobaciones-copia-"));
    for (const r of rutasDelMecanismo(RAIZ_DEL_REPO)) {
      if (!existsSync(join(RAIZ_DEL_REPO, ...r.split("/")))) continue;
      mkdirSync(dirname(ruta(r)), { recursive: true });
      cpSync(join(RAIZ_DEL_REPO, ...r.split("/")), ruta(r));
    }
  }, 30_000);
  afterAll(() => {
    rmSync(copia, { recursive: true, force: true });
  });

  it("la copia sin mutar da 0 hallazgos", () => {
    expect(correr().map(formatearHallazgoDeAprobacion)).toEqual([]);
  });

  it("cambiar UN byte de motor.ts → rojo con el archivo, la huella actual y qué agregar; con la aprobación registrada → verde", () => {
    const original = leer(`${CARPETA}/motor.ts`);
    writeFileSync(ruta(`${CARPETA}/motor.ts`), `${original} `);
    try {
      const r = correr();
      mostrar("un byte más en motor.ts", r);
      expect(tipos(r)).toEqual([`huella-distinta · ${CARPETA}/motor.ts`]);
      expect(r[0].archivo).toBe(`${CARPETA}/motor.ts`);
      expect(r[0].huella).toBe(huellaDeBlob(`${original} `));
      expect(r[0].que).toContain(huellaDeBlob(`${original} `));
      expect(r[0].como).toContain("agregá la aprobación (referencia + motivo) al registro APROBACIONES");
      expect(formatearHallazgoDeAprobacion(r[0])).toContain(`${CARPETA}/motor.ts:1:1  [aprobaciones · huella-distinta]`);
      // Solo verde después de registrar la aprobación (la última entrada de la pieza manda).
      expect(correr({ registro: [...APROBACIONES, aprobar(`${CARPETA}/motor.ts`)] })).toEqual([]);
    } finally {
      writeFileSync(ruta(`${CARPETA}/motor.ts`), original);
    }
    expect(correr()).toEqual([]);
  });

  it("cambiar `scripts.test` de package.json → rojo; cambiar una dependencia → verde", () => {
    const r = mutar("package.json", '"test": "vitest run"', '"test": "echo ok"', "scripts.test cambiado");
    expect(tipos(r)).toEqual(["huella-distinta · package.json#scripts"]);
    expect(r[0].archivo).toBe("package.json");
    const original = leer("package.json");
    const json = JSON.parse(original) as { dependencies: Record<string, string> };
    json.dependencies["una-dependencia-nueva"] = "^1.0.0";
    writeFileSync(ruta("package.json"), `${JSON.stringify(json, null, 2)}\n`);
    try {
      expect(correr()).toEqual([]);
    } finally {
      writeFileSync(ruta("package.json"), original);
    }
  });

  it("agregar un caso legítimo a un contrato → rojo (la huella de sus campos gobernados cambió); verde solo con la aprobación", () => {
    const conCaso: Contrato = { ...BORDE_PROPIO_DE_CARTA, casosLegitimos: [...BORDE_PROPIO_DE_CARTA.casosLegitimos, { archivo: "src/components/zz.tsx", fragmento: "border-t", motivo: "un uso crudo que se quiere silenciar" }] };
    const contratos = MANIFIESTO.map((c) => (c.id === conCaso.id ? conCaso : c));
    const r = correr({ contratos });
    mostrar("un caso legítimo nuevo en borde-propio-de-carta", r);
    expect(tipos(r)).toEqual([`huella-distinta · ${claveDeContrato(conCaso.id)}`]);
    expect(r[0].archivo).toBe(`${CARPETA}/contratos/${conCaso.id}.ts`);
    expect(r[0].que).toContain("id, excepciones y casos legítimos");
    expect(correr({ contratos, registro: [...APROBACIONES, aprobar(claveDeContrato(conCaso.id), { contratos })] })).toEqual([]);
    // Sacar un caso legítimo existente también cambia la definición.
    const sinCaso: Contrato = { ...BORDE_PROPIO_DE_CARTA, casosLegitimos: BORDE_PROPIO_DE_CARTA.casosLegitimos.slice(1) };
    expect(tipos(correr({ contratos: MANIFIESTO.map((c) => (c.id === sinCaso.id ? sinCaso : c)) }))).toEqual([`huella-distinta · ${claveDeContrato(sinCaso.id)}`]);
  });

  it("agregar una excepción a un contrato → rojo; reordenar los casos legítimos o cambiar la deuda → verde (la deuda ya la gobiernan los vencimientos)", () => {
    const excepcion = { archivo: "src/zz.tsx", fragmento: "border-t", motivo: "una excepción que se quiere agregar", responsable: "dueño", aprobacion: { por: "dueño", referencia: "PR #12" }, creada: "2026-10-21", renovaciones: [], vence: "2026-12-20" } as const;
    const base = MANIFIESTO[0];
    expect(tipos(correr({ contratos: MANIFIESTO.map((c) => (c.id === base.id ? { ...c, excepciones: [excepcion] } : c)) }))).toEqual([`huella-distinta · ${claveDeContrato(base.id)}`]);
    const reordenado = { ...BORDE_PROPIO_DE_CARTA, casosLegitimos: [...BORDE_PROPIO_DE_CARTA.casosLegitimos].reverse() };
    expect(correr({ contratos: MANIFIESTO.map((c) => (c.id === reordenado.id ? reordenado : c)) })).toEqual([]);
    const otraDeuda = MANIFIESTO.map((c) => ({ ...c, deuda: [...c.deuda].reverse() }));
    expect(correr({ contratos: otraDeuda })).toEqual([]);
  });

  it("cambiar una exclusión (otra ruta, otra cantidad, una nueva) → rojo; verde con la aprobación", () => {
    const [primera] = EXCLUSIONES;
    const casos: { titulo: string; exclusiones: readonly Exclusion[] }[] = [
      { titulo: "una exclusión nueva", exclusiones: [...EXCLUSIONES, { ...primera, ruta: "src/ui/", archivos: 6 }] },
      { titulo: "la cantidad de archivos", exclusiones: [{ ...primera, archivos: primera.archivos + 1 }] },
      { titulo: "la ruta", exclusiones: [{ ...primera, ruta: "prisma/otra/" }] },
      { titulo: "ninguna exclusión", exclusiones: [] },
    ];
    for (const c of casos) {
      const r = correr({ exclusiones: c.exclusiones });
      mostrar(`exclusiones: ${c.titulo}`, r);
      expect(tipos(r), c.titulo).toEqual([`huella-distinta · ${CARPETA}/gobernanza/exclusiones.ts#exclusiones`]);
      expect(r[0].archivo).toBe(`${CARPETA}/gobernanza/exclusiones.ts`);
      expect(correr({ exclusiones: c.exclusiones, registro: [...APROBACIONES, aprobar(`${CARPETA}/gobernanza/exclusiones.ts#exclusiones`, { exclusiones: c.exclusiones })] }), c.titulo).toEqual([]);
    }
  });

  it("cambiar POLITICA_DE_TIPOS (un tipo que no declaraba pasa a declarar) → rojo; el texto del motivo de un tipo no cuenta", () => {
    const politica = { ...POLITICA_DE_TIPOS, pruebas: { declara: true } as const };
    const r = correr({ politicaDeTipos: politica });
    mostrar("POLITICA_DE_TIPOS: pruebas declara", r);
    expect(tipos(r)).toEqual([`huella-distinta · ${CARPETA}/gobernanza/areas.ts#politica-de-tipos`]);
    expect(correr({ politicaDeTipos: { ...POLITICA_DE_TIPOS, documentacion: { declara: false, motivo: "otro motivo, con otro texto" } } })).toEqual([]);
  });

  it("áreas.ts: cambiar un DATO (una declaración de AREAS) no pone nada en rojo; cambiar su LÓGICA, sí", () => {
    const original = leer(`${CARPETA}/gobernanza/areas.ts`);
    expect(original).toContain('"core/stock": [],');
    writeFileSync(ruta(`${CARPETA}/gobernanza/areas.ts`), original.replace('"core/stock": [],', '"core/stock": [],\n  "core/zz-nueva": [],'));
    try {
      expect(correr()).toEqual([]);
    } finally {
      writeFileSync(ruta(`${CARPETA}/gobernanza/areas.ts`), original);
    }
    const r = mutar(`${CARPETA}/gobernanza/areas.ts`, "export function areaDe(", "export function areaDe2(", "areas.ts: cambia la lógica");
    expect(tipos(r)).toEqual([`huella-distinta · ${CARPETA}/gobernanza/areas.ts#logica`]);
  });

  it("ci.yml: una actualización de Dependabot no pone rojo; un cambio del workflow, sí", () => {
    const original = leer(".github/workflows/ci.yml");
    writeFileSync(ruta(".github/workflows/ci.yml"), original.replace(/@[0-9a-f]{40} # v[\d.]+/g, `@${"c".repeat(40)} # v9.9.9`));
    try {
      expect(correr()).toEqual([]);
    } finally {
      writeFileSync(ruta(".github/workflows/ci.yml"), original);
    }
    const r = mutar(".github/workflows/ci.yml", "      - name: npm test\n", "      - name: npm test\n        continue-on-error: true\n", "ci.yml: continue-on-error");
    expect(tipos(r)).toEqual([`huella-distinta · .github/workflows/ci.yml#sin-sha`]);
    expect(r[0].archivo).toBe(".github/workflows/ci.yml");
  });

  it("vitest.config.ts, playwright.config.ts, .gitignore y politica.ts: un cambio → rojo con su archivo", () => {
    expect(tipos(mutar("vitest.config.ts", 'environment: "node",', 'environment: "node",\n    allowOnly: true,', "vitest.config.ts: allowOnly"))).toEqual(["huella-distinta · vitest.config.ts"]);
    expect(tipos(mutar("playwright.config.ts", "import", "import  ", "playwright.config.ts: un espacio"))).toEqual(["huella-distinta · playwright.config.ts"]);
    expect(tipos(mutar(".gitignore", "/node_modules", "/node_modules\n/src/oculto", ".gitignore: esconde src/oculto"))).toEqual(["huella-distinta · .gitignore"]);
    const r = mutar(`${CARPETA}/politica.ts`, "HORIZONTE_EXCEPCION_DIAS = 60;", "HORIZONTE_EXCEPCION_DIAS = 365;", "politica.ts: 60 → 365");
    expect(tipos(r)).toEqual([`huella-distinta · ${CARPETA}/politica.ts`]);
    expect(r[0].que).toContain("archivo del mecanismo, entero");
  });

  it("un adaptador nuevo → sin-aprobacion; un archivo del mecanismo borrado → archivo-ausente; su retiro aprobado → verde", () => {
    writeFileSync(ruta(`${CARPETA}/adaptadores/zz-nuevo.ts`), "export const x = 1;\n");
    try {
      const r = correr();
      mostrar("un adaptador nuevo", r);
      expect(tipos(r)).toEqual([`sin-aprobacion · ${CARPETA}/adaptadores/zz-nuevo.ts`]);
      expect(r[0].como).toContain("agregá la aprobación (referencia + motivo)");
    } finally {
      rmSync(ruta(`${CARPETA}/adaptadores/zz-nuevo.ts`));
    }
    const original = leer(`${CARPETA}/adaptadores/coincidencia.ts`);
    rmSync(ruta(`${CARPETA}/adaptadores/coincidencia.ts`));
    try {
      const r = correr();
      mostrar("un adaptador borrado", r);
      expect(tipos(r)).toEqual([`archivo-ausente · ${CARPETA}/adaptadores/coincidencia.ts`]);
      const retiro: Aprobacion = { archivo: `${CARPETA}/adaptadores/coincidencia.ts`, blob: RETIRADO, referencia: "PR #99", motivo: "se retira el adaptador a propósito en el test" };
      expect(correr({ registro: [...APROBACIONES, retiro] })).toEqual([]);
      // Si después reaparece, hace falta otra aprobación.
      writeFileSync(ruta(`${CARPETA}/adaptadores/coincidencia.ts`), original);
      expect(tipos(correr({ registro: [...APROBACIONES, retiro] }))).toEqual([`huella-distinta · ${CARPETA}/adaptadores/coincidencia.ts`]);
    } finally {
      writeFileSync(ruta(`${CARPETA}/adaptadores/coincidencia.ts`), original);
    }
    expect(correr()).toEqual([]);
  });

  it("un contrato que sale del manifiesto → archivo-ausente (hay que registrar su retiro); uno nuevo → sin-aprobacion", () => {
    const sinUno = MANIFIESTO.slice(1);
    expect(tipos(correr({ contratos: sinUno }))).toEqual([`archivo-ausente · ${claveDeContrato(MANIFIESTO[0].id)}`]);
    const nuevo: Contrato = { ...MANIFIESTO[0], id: "contrato-nuevo" };
    expect(tipos(correr({ contratos: [...MANIFIESTO, nuevo] }))).toEqual([`sin-aprobacion · ${claveDeContrato("contrato-nuevo")}`]);
    expect(correr({ contratos: [...MANIFIESTO, nuevo], registro: [...APROBACIONES, aprobar(claveDeContrato("contrato-nuevo"), { contratos: [...MANIFIESTO, nuevo] })] })).toEqual([]);
  });

  it("la última entrada de una pieza es la vigente: el historial se conserva y una huella vieja vuelve a ser rojo", () => {
    const clave = `${CARPETA}/politica.ts`;
    const vieja = huellasActuales(real({ raiz: copia })).get(clave)?.huella ?? "";
    const entradaNueva: Aprobacion = { archivo: clave, blob: "1".repeat(40), referencia: "DEC-03", motivo: "otra huella distinta, aprobada a propósito" };
    // Vigente = la última: una huella intermedia distinta de la actual es rojo aunque la actual esté en el historial.
    expect(tipos(correr({ registro: [...APROBACIONES, entradaNueva] }))).toEqual([`huella-distinta · ${clave}`]);
    expect(correr({ registro: [...APROBACIONES, entradaNueva, { ...entradaNueva, blob: vieja }] })).toEqual([]);
  });

  it("una aprobación mal armada es un hallazgo: motivo de 19 caracteres, referencia inventada, huella que no es un hash", () => {
    const buena = APROBACIONES[0];
    const casos: { titulo: string; entrada: Aprobacion; incluye: string }[] = [
      { titulo: "motivo de 19 caracteres", entrada: { ...buena, motivo: "a".repeat(19) }, incluye: "menos de 20 caracteres" },
      { titulo: "referencia inventada", entrada: { ...buena, referencia: "lo aprobé yo" }, incluye: "lo aprobé yo" },
      { titulo: "huella que no es un hash", entrada: { ...buena, blob: "abc" }, incluye: "no es un hash de blob de git" },
      { titulo: "sin pieza", entrada: { ...buena, archivo: " " }, incluye: "no dice a qué pieza" },
    ];
    for (const c of casos) {
      const invalidas = correr({ registro: [...APROBACIONES.slice(1), c.entrada] }).filter((h) => h.tipo === "aprobacion-invalida");
      expect(invalidas.length, c.titulo).toBe(1);
      expect(invalidas[0].que, c.titulo).toContain(c.incluye);
      expect(invalidas[0].archivo).toBe(ARCHIVO_DE_APROBACIONES);
      expect(invalidas[0].como).toContain("corregí la entrada");
    }
    // El borde: 20 caracteres exactos valen.
    expect(correr({ registro: [...APROBACIONES.slice(1), { ...buena, motivo: "a".repeat(20) }] }).filter((h) => h.tipo === "aprobacion-invalida")).toEqual([]);
  });

  it("la copia queda como el repo (nada de las mutaciones llegó al repo real)", () => {
    expect(correr()).toEqual([]);
    expect(revisarAprobaciones(real()).hallazgos).toEqual([]);
  });
});
