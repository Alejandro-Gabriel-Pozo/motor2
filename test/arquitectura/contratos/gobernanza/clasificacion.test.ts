import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RAIZ_DEL_REPO } from "../../cercos/trinquete";
import { fechaUtcDeHoy } from "../politica";
import {
  REGLAS_DE_RUTA,
  TIPOS_DE_RUTA,
  clasificarRutas,
  formatearHallazgoDeRuta,
  formatearReporteDeClasificacion,
  leerCronsDeVercel,
  listarRutasConGit,
  resumirClasificacion,
  revisarClasificacionDelRepo,
  type EntradaDeClasificacion,
  type ReglaDeRuta,
  type ResultadoDeClasificacion,
} from "./clasificacion";
import { EXCLUSIONES, type Exclusion } from "./exclusiones";

/**
 * Guardián «clasificación de rutas» (G2): corre `clasificacion.ts` sobre el repo real (UNA prueba) y prueba el mecanismo con listas sintéticas y con un repo git
 * temporal (nunca el repo real). Las pruebas de borde usan LITERALES (19 y 20 caracteres, el día del vencimiento y el siguiente, 59, 60 y 61 días), no las constantes de
 * `politica.ts`: bajar un umbral en la política rompe estas pruebas.
 */

// ---------------------------------------------------------------------------------------------------------------------------------
// El repo real
// ---------------------------------------------------------------------------------------------------------------------------------

describe("clasificación de rutas (repo real)", () => {
  let memo: ResultadoDeClasificacion | undefined;
  const real = (): ResultadoDeClasificacion => (memo ??= revisarClasificacionDelRepo(RAIZ_DEL_REPO, fechaUtcDeHoy()));

  it("todo archivo del repo tiene un tipo; nada ignorado esconde código; exclusiones al día", () => {
    const r = real();
    const resumen = resumirClasificacion(r);
    // El conteo por tipo sale siempre, también en verde.
    console.info(`[clasificacion] ${[...r.avisos, resumen].join("\n")}`);
    expect(r.hallazgos.map(formatearHallazgoDeRuta), `\n${formatearReporteDeClasificacion(r, 40)}`).toEqual([]);
    expect(r.hallazgos.filter((h) => h.tipo === "ruta-sin-clasificar"), `0 rutas sin clasificar. ${resumen}`).toHaveLength(0);
  });

  it("la cuenta cierra: cada archivo es clasificado o excluido, y el repo tiene código de los tipos que importan", () => {
    const r = real();
    expect(r.clasificados + r.excluidos).toBe(r.total);
    expect(Object.values(r.porTipo).reduce((a, b) => a + b, 0)).toBe(r.clasificados);
    for (const tipo of TIPOS_DE_RUTA) if (tipo !== "generado") expect(r.porTipo[tipo], `el tipo «${tipo}» no tiene archivos: ${resumirClasificacion(r)}`).toBeGreaterThan(0);
  });

  it("no se versiona código generado sin declararlo: el tipo `generado` no tiene reglas ni archivos", () => {
    expect(REGLAS_DE_RUTA.filter((r) => r.tipo === "generado")).toEqual([]);
    expect(real().porTipo.generado).toBe(0);
  });

  it("los crons de vercel.json se leen y quedan como trabajo-programado", () => {
    const crons = leerCronsDeVercel(RAIZ_DEL_REPO);
    expect(crons.length).toBeGreaterThan(0);
    expect(real().porTipo["trabajo-programado"]).toBeGreaterThanOrEqual(crons.length);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Listas sintéticas
// ---------------------------------------------------------------------------------------------------------------------------------

const HOY = "2026-10-21";
const FASE_A = ["prisma/fase-a/a.sql", "prisma/fase-a/b.sql", "prisma/fase-a/prisma.config.ts", "prisma/fase-a/schema.prisma", "prisma/fase-a/smoke-test.ts"];
/** Un repo chico y válido: al menos un archivo de cada tipo y los 5 de la exclusión de `prisma/fase-a/`. */
const BASE: readonly string[] = [
  "src/app/page.tsx",
  "src/app/globals.css",
  "src/app/favicon.ico",
  "src/app/api/cron/sincronizar-ipc/route.ts",
  "src/components/a.tsx",
  "src/ui/b.tsx",
  "src/core/a.ts",
  "src/server/a.ts",
  "src/lib/a.ts",
  "src/types/a.d.ts",
  "src/env.ts",
  "src/fonts/Geist-latin.woff2",
  "plataforma/src/app/page.tsx",
  "plataforma/package.json",
  "prisma/schema.prisma",
  "prisma/seed.ts",
  "prisma.config.ts",
  "prisma/migrations/migration_lock.toml",
  "prisma/migrations/20260101_a/migration.sql",
  "prisma/migrations/20260101_a/down.sql",
  "scripts/a.ts",
  "test/a.test.ts",
  ".github/workflows/ci.yml",
  "package.json",
  ".gitignore",
  "AGENTS.md",
  ".claude/agents/a.md",
  "docs/a.md",
  "README.md",
  "public/file.svg",
  ".zap/reglas.tsv",
  ...FASE_A,
];
const CRON = "/api/cron/sincronizar-ipc";

const entrada = (extra: Partial<EntradaDeClasificacion> = {}): EntradaDeClasificacion => ({ archivos: BASE, ignorados: [], crons: [CRON], reglas: REGLAS_DE_RUTA, exclusiones: EXCLUSIONES, hoy: HOY, ...extra });
const con = (...mas: string[]): EntradaDeClasificacion => entrada({ archivos: [...BASE, ...mas] });
const vistos = (r: ResultadoDeClasificacion): [string, string][] => r.hallazgos.map((h) => [h.tipo, h.archivo]);

describe("la base sintética es válida (sin ella las mutaciones no prueban nada)", () => {
  it("no da ningún hallazgo y clasifica cada tipo", () => {
    const r = clasificarRutas(entrada());
    expect(vistos(r)).toEqual([]);
    expect(r.excluidos).toBe(5);
    expect(r.clasificados + r.excluidos).toBe(r.total);
    for (const tipo of TIPOS_DE_RUTA) if (tipo !== "generado") expect(r.porTipo[tipo], tipo).toBeGreaterThan(0);
  });

  it("un archivo se clasifica con el tipo de la regla más específica", () => {
    const r = clasificarRutas(entrada());
    expect(r.porTipo["trabajo-programado"]).toBe(1);
    expect(r.porTipo.activos).toBe(2 + 1);
    expect(r.porTipo.migraciones).toBe(3);
  });
});

describe("lo que ninguna regla reconoce falla (fail-closed)", () => {
  it.each([
    ["un .ts escondido en docs/", "docs/escondido.ts"],
    ["un .ts escondido en public/", "public/escondido.ts"],
    ["un .js en public/", "public/app.js"],
    ["un .ts en src/fonts/", "src/fonts/x.ts"],
    ["una carpeta nueva src/modulo-nuevo/", "src/modulo-nuevo/x.ts"],
    ["una carpeta de src renombrada (server → servidor)", "src/servidor/a.ts"],
    ["un .js en el frontend", "src/app/x.js"],
    ["un .tsx en el núcleo", "src/core/x.tsx"],
    ["un archivo suelto nuevo en src/ que no es .ts", "src/suelto.js"],
    ["un archivo nuevo en la raíz", "suelto.ts"],
    ["un .ts en la raíz que no es de la lista cerrada", "otra.config.ts"],
    ["un .ts entre las migraciones", "prisma/migrations/20260101_a/hook.ts"],
    ["un .sql con nombre no previsto entre las migraciones", "prisma/migrations/20260101_a/otro.sql"],
    ["un .ts en prisma/ que no es el esquema ni la siembra", "prisma/otro.ts"],
    ["un script de .js en scripts/", "scripts/a.js"],
    ["un .sh en el frontend", "src/app/x.sh"],
    ["una carpeta con nombre parecido a .github", "github/x.yml"],
    ["un script en .github/", ".github/hook.sh"],
    ["un .ts dentro de .claude/", ".claude/hook.ts"],
    ["un .ts en .zap/", ".zap/x.ts"],
    ["un .ts en plataforma/ (fuera de src)", "plataforma/extra.ts"],
    ["un .js en plataforma/src", "plataforma/src/x.js"],
    ["una carpeta nueva en la raíz", "tools/x.ts"],
    ["una extensión en mayúscula", "src/core/X.TS"],
  ])("%s → ruta-sin-clasificar", (_caso, ruta) => {
    const r = clasificarRutas(con(ruta));
    expect(vistos(r)).toEqual([["ruta-sin-clasificar", ruta]]);
    expect(r.clasificados + r.excluidos + 1).toBe(r.total);
  });

  it("la carpeta de un .ts escondido en docs/ dice qué regla la cubre y qué admite", () => {
    const h = clasificarRutas(con("docs/escondido.ts")).hallazgos[0];
    expect(formatearHallazgoDeRuta(h)).toBe(
      "docs/escondido.ts:1:1  [clasificacion · ruta-sin-clasificar]\n" +
        "  ninguna regla de clasificación reconoce este archivo (ni su carpeta con esa extensión) → la regla documentacion («docs/», recursiva) solo admite .md: si el archivo es código escondido en esa carpeta, movelo a donde corresponde; si es legítimo, ampliá esa regla en `gobernanza/clasificacion.ts`; o, si es código que no se analiza a propósito, una exclusión en `gobernanza/exclusiones.ts` (motivo, responsable, aprobación, vence, cantidad exacta)"
    );
  });

  it("una carpeta nueva trae la línea para pegar; un archivo de la raíz, la lista donde agregarlo", () => {
    expect(formatearHallazgoDeRuta(clasificarRutas(con("src/modulo-nuevo/x.ts")).hallazgos[0])).toContain('{ tipo: "<tipo>", prefijo: "src/modulo-nuevo/", profundidad: "recursiva", extensiones: [".ts"], nombres: [], motivo: "<20 caracteres o más>" }');
    expect(formatearHallazgoDeRuta(clasificarRutas(con("suelto.ts")).hallazgos[0])).toContain("agregá «suelto.ts» a la lista de `nombres`");
  });

  it("renombrar una carpeta entera da un hallazgo por archivo, y el reporte lo recorta", () => {
    const archivos = BASE.map((r) => r.replace("src/core/", "src/nucleo/"));
    const r = clasificarRutas(entrada({ archivos: [...archivos, ...Array.from({ length: 60 }, (_, i) => `src/nucleo/m${i}.ts`)] }));
    expect(r.hallazgos.filter((h) => h.tipo === "ruta-sin-clasificar")).toHaveLength(61);
    const reporte = formatearReporteDeClasificacion(r, 40);
    expect(reporte).toContain("… y 21 hallazgos más");
    expect(reporte.split("\n").filter((l) => l.includes("[clasificacion ·"))).toHaveLength(40);
  });

  it("el listado vacío es rojo (alcance-vacio), no verde", () => {
    expect(vistos(clasificarRutas(entrada({ archivos: [], exclusiones: [], crons: [] })))).toEqual([["alcance-vacio", "."]]);
  });

  it("sin reglas, o con una regla que acepta cualquier cosa, lanza", () => {
    expect(() => clasificarRutas(entrada({ reglas: [] }))).toThrow(/no hay ninguna regla/);
    const abierta: ReglaDeRuta = { tipo: "pruebas", prefijo: "src/", profundidad: "recursiva", extensiones: [], nombres: [], motivo: "una regla que lo acepta todo, mal armada" };
    expect(() => clasificarRutas(entrada({ reglas: [...REGLAS_DE_RUTA, abierta] }))).toThrow(/acepta cualquier archivo/);
  });

  it("una regla mal armada lanza: prefijo sin barra final, extensión sin punto, motivo de 19 caracteres, tipo sin reglas", () => {
    const base: ReglaDeRuta = { tipo: "pruebas", prefijo: "x/", profundidad: "recursiva", extensiones: [".ts"], nombres: [], motivo: "un motivo con 20 chars" };
    expect(() => clasificarRutas(entrada({ reglas: [...REGLAS_DE_RUTA, { ...base, prefijo: "x" }] }))).toThrow(/prefijo/);
    expect(() => clasificarRutas(entrada({ reglas: [...REGLAS_DE_RUTA, { ...base, extensiones: ["ts"] }] }))).toThrow(/extensión/);
    expect(() => clasificarRutas(entrada({ reglas: [...REGLAS_DE_RUTA, { ...base, motivo: "1234567890123456789" }] }))).toThrow(/motivo/);
    expect(() => clasificarRutas(entrada({ reglas: [...REGLAS_DE_RUTA, { ...base, motivo: "12345678901234567890" }] }))).not.toThrow();
    expect(() => clasificarRutas(entrada({ reglas: REGLAS_DE_RUTA.filter((r) => r.tipo !== "ci") }))).toThrow(/el tipo «ci» no tiene ninguna regla/);
  });

  it("dos reglas de tipos distintos igual de específicas son clasificacion-ambigua; del mismo tipo no", () => {
    const a: ReglaDeRuta = { tipo: "scripts", prefijo: "docs/", profundidad: "recursiva", extensiones: [".ts"], nombres: [], motivo: "una regla repetida para la prueba" };
    const b: ReglaDeRuta = { ...a, tipo: "pruebas" };
    const r = clasificarRutas({ ...con("docs/x.ts"), reglas: [...REGLAS_DE_RUTA, a, b] });
    expect(vistos(r)).toEqual([["clasificacion-ambigua", "docs/x.ts"]]);
    expect(r.hallazgos[0].que).toContain("scripts («docs/»), pruebas («docs/»)");
    expect(vistos(clasificarRutas({ ...con("docs/x.ts"), reglas: [...REGLAS_DE_RUTA, a, { ...a }] }))).toEqual([]);
  });

  it("dos reglas de la raíz que listan el mismo nombre son ambiguas", () => {
    const dup: ReglaDeRuta = { tipo: "agentes", prefijo: "", profundidad: "directa", extensiones: [], nombres: ["package.json"], motivo: "el mismo archivo en dos listas cerradas" };
    expect(vistos(clasificarRutas({ ...entrada(), reglas: [...REGLAS_DE_RUTA, dup] }))).toEqual([["clasificacion-ambigua", "package.json"]]);
  });
});

describe("el cron: la regla de trabajo-programado le gana a la del frontend", () => {
  it("el orden de la lista no cambia el resultado", () => {
    const alReves = clasificarRutas(entrada({ reglas: [...REGLAS_DE_RUTA].reverse() }));
    expect(vistos(alReves)).toEqual([]);
    expect(alReves.porTipo["trabajo-programado"]).toBe(1);
  });

  it("un cron que cae en el frontend (la carpeta se renombró en la regla) → cron-mal-clasificado", () => {
    const reglas = REGLAS_DE_RUTA.map((r) => (r.tipo === "trabajo-programado" ? { ...r, prefijo: "src/app/api/cron-viejo/" } : r));
    const r = clasificarRutas(entrada({ reglas }));
    expect(vistos(r)).toEqual([["cron-mal-clasificado", "src/app/api/cron/sincronizar-ipc/route.ts"]]);
    expect(r.hallazgos[0].que).toContain("clasificado como frontend");
  });

  it("sin ninguna regla de trabajo-programado, lanza", () => {
    expect(() => clasificarRutas(entrada({ reglas: REGLAS_DE_RUTA.filter((r) => r.tipo !== "trabajo-programado") }))).toThrow(/trabajo-programado/);
  });

  it("un cron de vercel.json sin archivo de ruta → cron-mal-clasificado", () => {
    const r = clasificarRutas(entrada({ crons: [CRON, "/api/cron/no-existe"] }));
    expect(vistos(r)).toEqual([["cron-mal-clasificado", "src/app/api/cron/no-existe/route.ts"]]);
  });
});

describe("exclusiones: cantidad exacta", () => {
  it("un archivo más bajo la exclusión → exclusion-ampliada", () => {
    const r = clasificarRutas(con("prisma/fase-a/nuevo.ts"));
    expect(vistos(r)).toEqual([["exclusion-ampliada", "prisma/fase-a/"]]);
    expect(r.hallazgos[0].que).toContain("declara 5 archivos y hay 6 (");
    expect(r.hallazgos[0].que).toContain("prisma/fase-a/nuevo.ts");
  });

  it("código movido a una carpeta anidada de la exclusión también cuenta", () => {
    expect(vistos(clasificarRutas(con("prisma/fase-a/escondido/src/x.ts")))).toEqual([["exclusion-ampliada", "prisma/fase-a/"]]);
  });

  it("una exclusión sin archivos → exclusion-sin-uso", () => {
    const r = clasificarRutas(entrada({ archivos: BASE.filter((a) => !a.startsWith("prisma/fase-a/")) }));
    expect(vistos(r)).toEqual([["exclusion-sin-uso", "prisma/fase-a/"]]);
    expect(r.hallazgos[0].que).toBe("la exclusión no cubre ningún archivo");
  });

  it("declarar 0 archivos tampoco la salva: sin archivos sigue siendo exclusion-sin-uso", () => {
    const e: Exclusion = { ...EXCLUSIONES[0], ruta: "scripts/viejo/", archivos: 0 };
    expect(vistos(clasificarRutas({ ...entrada(), exclusiones: [...EXCLUSIONES, e] }))).toEqual([["exclusion-sin-uso", "scripts/viejo/"]]);
  });

  it("menos archivos que los declarados también falla (la cantidad es exacta)", () => {
    const r = clasificarRutas(entrada({ archivos: BASE.filter((a) => a !== "prisma/fase-a/b.sql") }));
    expect(vistos(r)).toEqual([["exclusion-sin-uso", "prisma/fase-a/"]]);
    expect(r.hallazgos[0].que).toBe("la exclusión declara 5 archivos y hay 4");
  });

  it("una exclusión de un archivo suelto cubre solo ese archivo", () => {
    const e: Exclusion = { ...EXCLUSIONES[0], ruta: "scripts/viejo.ts", archivos: 1 };
    const r = clasificarRutas({ ...con("scripts/viejo.ts", "scripts/viejo.ts.bak"), exclusiones: [e] });
    expect(vistos(r).sort()).toEqual([["ruta-sin-clasificar", "prisma/fase-a/a.sql"], ["ruta-sin-clasificar", "prisma/fase-a/b.sql"], ["ruta-sin-clasificar", "prisma/fase-a/prisma.config.ts"], ["ruta-sin-clasificar", "prisma/fase-a/schema.prisma"], ["ruta-sin-clasificar", "prisma/fase-a/smoke-test.ts"], ["ruta-sin-clasificar", "scripts/viejo.ts.bak"]].sort());
  });

  it("lo excluido no cuenta como clasificado: se informa aparte", () => {
    const r = clasificarRutas(entrada());
    expect(r.excluidos).toBe(5);
    expect(resumirClasificacion(r)).toContain("5 excluidos · 0 sin clasificar");
  });
});

describe("exclusiones: gobierno (literales)", () => {
  // Con LITERALES: 19 y 20 caracteres, el día del vencimiento y el siguiente, 59, 60 y 61 días desde HOY (2026-10-21).
  const E: Exclusion = {
    ruta: "prisma/fase-a/",
    motivo: "un motivo escrito con más de veinte caracteres",
    responsable: "dueño",
    aprobacion: { por: "dueño", referencia: "PR #12" },
    vence: "2026-12-19",
    archivos: 5,
  };
  const con1 = (cambio: Partial<Exclusion>): ResultadoDeClasificacion => clasificarRutas(entrada({ exclusiones: [{ ...E, ...cambio }] }));

  it("la exclusión de partida está en verde", () => {
    expect(vistos(con1({}))).toEqual([]);
  });

  it("vencida ayer → excepcion-vencida; vence hoy → vigente, con aviso", () => {
    expect(vistos(con1({ vence: "2026-10-20" }))).toEqual([["excepcion-vencida", "prisma/fase-a/"]]);
    const hoy = con1({ vence: "2026-10-21" });
    expect(vistos(hoy)).toEqual([]);
    expect(hoy.avisos).toEqual(["aviso: [clasificacion] la exclusión de «prisma/fase-a/» vence hoy"]);
  });

  it("vence en 14 días avisa; en 15, no", () => {
    expect(con1({ vence: "2026-11-04" }).avisos).toEqual(["aviso: [clasificacion] la exclusión de «prisma/fase-a/» vence en 14 días (2026-11-04)"]);
    expect(con1({ vence: "2026-11-05" }).avisos).toEqual([]);
  });

  it("la fecha es la inyectada: la misma exclusión vence si hoy avanza", () => {
    expect(vistos(clasificarRutas(entrada({ exclusiones: [E], hoy: "2026-12-19" })))).toEqual([]);
    expect(vistos(clasificarRutas(entrada({ exclusiones: [E], hoy: "2026-12-20" })))).toEqual([["excepcion-vencida", "prisma/fase-a/"]]);
  });

  it("motivo de 19 caracteres → excepcion-sin-motivo; de 20, verde", () => {
    expect(vistos(con1({ motivo: "1234567890123456789" }))).toEqual([["excepcion-sin-motivo", "prisma/fase-a/"]]);
    expect(vistos(con1({ motivo: "12345678901234567890" }))).toEqual([]);
    expect(vistos(con1({ motivo: "                    " }))).toEqual([["excepcion-sin-motivo", "prisma/fase-a/"]]);
  });

  it("vence a 59 y a 60 días → verde; a 61 → horizonte-excedido (tope de toda excepción, decisión del dueño)", () => {
    expect(vistos(con1({ vence: "2026-12-19" }))).toEqual([]);
    expect(vistos(con1({ vence: "2026-12-20" }))).toEqual([]);
    expect(vistos(con1({ vence: "2026-12-21" }))).toEqual([["horizonte-excedido", "prisma/fase-a/"]]);
    // Lo que antes era el tope (365 y 366 días) ya no pasa.
    expect(vistos(con1({ vence: "2027-10-21" }))).toEqual([["horizonte-excedido", "prisma/fase-a/"]]);
  });

  it("responsable fuera de la lista cerrada → excepcion-sin-responsable", () => {
    expect(vistos(con1({ responsable: "gerente" as never }))).toEqual([["excepcion-sin-responsable", "prisma/fase-a/"]]);
  });

  it.each([
    ["referencia sin forma", { por: "dueño", referencia: "PR 12" }],
    ["referencia vacía", { por: "dueño", referencia: "" }],
    ["sha de 6 caracteres", { por: "dueño", referencia: "commit 2a3286" }],
    ["sin quién aprobó", { por: "  ", referencia: "PR #12" }],
  ])("aprobación inválida (%s) → excepcion-sin-aprobacion", (_caso, aprobacion) => {
    expect(vistos(con1({ aprobacion }))).toEqual([["excepcion-sin-aprobacion", "prisma/fase-a/"]]);
  });

  it.each([
    ["commit <sha>", "commit 2a328632"],
    ["PR #n", "PR #73"],
    ["DEC-nn", "DEC-07"],
  ])("aprobación válida (%s)", (_caso, referencia) => {
    expect(vistos(con1({ aprobacion: { por: "dueño", referencia } }))).toEqual([]);
  });

  it.each([
    ["una fecha que no existe", { vence: "2027-02-30" }],
    ["una fecha mal escrita", { vence: "30/04/2027" }],
    ["la raíz de código entera", { ruta: "src/" }],
    ["un solo tramo", { ruta: "docs/" }],
    ["un comodín", { ruta: "prisma/*/" }],
    ["una ruta absoluta", { ruta: "/prisma/fase-a/" }],
    ["un tramo ..", { ruta: "prisma/../src/" }],
    ["una cantidad negativa", { archivos: -1 }],
    ["una cantidad fraccionaria", { archivos: 2.5 }],
    ["una cantidad de 51 (no es una exclusión acotada)", { archivos: 51 }],
  ] as [string, Partial<Exclusion>][])("una exclusión mal armada lanza: %s", (_caso, cambio) => {
    expect(() => con1(cambio)).toThrow(/Exclusiones de rutas mal armadas/);
  });

  it("una cantidad de 50 es el tope y vale", () => {
    expect(() => con1({ archivos: 50 })).not.toThrow();
  });

  it("repetida o anidada lanza", () => {
    expect(() => clasificarRutas(entrada({ exclusiones: [E, E] }))).toThrow(/repetida/);
    expect(() => clasificarRutas(entrada({ exclusiones: [E, { ...E, ruta: "prisma/fase-a/migraciones-manuales/", archivos: 2 }] }))).toThrow(/está dentro de/);
  });

  it("los campos de gobierno de la exclusión REAL pasan la misma revisión con una fecha de hoy fija", () => {
    // La exclusión real, con la fecha inyectada: no depende del reloj del día.
    expect(vistos(clasificarRutas(entrada({ hoy: "2026-10-21" })))).toEqual([]);
  });
});

describe("lo ignorado por git no puede esconder código", () => {
  it.each([
    ["un patrón que esconde src/x.ts", "src/x.ts"],
    ["una carpeta de src oculta", "src/oculto/a.ts"],
    ["código de la consola", "plataforma/src/oculto.ts"],
    ["una migración", "prisma/migrations/2026_x/migration.sql"],
    ["un script", "scripts/oculto.ts"],
    ["una prueba", "test/oculta.test.ts"],
  ])("%s → ignorado-en-raiz-de-codigo", (_caso, ruta) => {
    const r = clasificarRutas(entrada({ ignorados: [ruta] }));
    expect(vistos(r)).toEqual([["ignorado-en-raiz-de-codigo", ruta]]);
    expect(formatearHallazgoDeRuta(r.hallazgos[0])).toContain("git check-ignore -v");
  });

  it("los generados declarados (next-env.d.ts y *.tsbuildinfo) pueden estar ignorados; lo que cuelga fuera de las raíces no se mira", () => {
    expect(vistos(clasificarRutas(entrada({ ignorados: ["src/next-env.d.ts", "test/x/tsconfig.tsbuildinfo", "plataforma/src/otro.tsbuildinfo", "node_modules/a/b.ts", ".next/x.js", "plataforma/.next/x.js", "test-results/a.json"] })))).toEqual([]);
  });

  it("un nombre parecido al generado declarado no pasa", () => {
    expect(vistos(clasificarRutas(entrada({ ignorados: ["src/next-env.d.ts.ts", "src/tsbuildinfo.ts"] })))).toEqual([
      ["ignorado-en-raiz-de-codigo", "src/next-env.d.ts.ts"],
      ["ignorado-en-raiz-de-codigo", "src/tsbuildinfo.ts"],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Un repo git temporal (los comandos reales de git, nunca el repo real)
// ---------------------------------------------------------------------------------------------------------------------------------

describe("recorrido con git (repo temporal)", () => {
  let raiz: string;
  const escribir = (ruta: string, contenido = "x\n"): void => {
    const absoluta = join(raiz, ...ruta.split("/"));
    mkdirSync(dirname(absoluta), { recursive: true });
    writeFileSync(absoluta, contenido);
  };
  const git = (...args: string[]): void => {
    execFileSync("git", ["-C", raiz, ...args], { stdio: "ignore" });
  };

  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), "clasificacion-"));
    git("init", "-q");
  });
  afterEach(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  it("lista lo versionado y lo nuevo sin versionar, y no lista lo ignorado ni lo borrado", () => {
    escribir(".gitignore", "src/x.ts\n/src/oculto/\nnext-env.d.ts\n*.tsbuildinfo\n");
    escribir("src/ok.ts");
    escribir("src/nuevo.ts");
    escribir("src/x.ts");
    escribir("src/oculto/a.ts");
    escribir("src/generado.tsbuildinfo");
    escribir("src/borrado.ts");
    escribir("docs/ñandú café.md");
    git("add", ".gitignore", "src/ok.ts", "src/borrado.ts");
    rmSync(join(raiz, "src", "borrado.ts"));
    const { archivos, ignorados } = listarRutasConGit(raiz);
    expect(archivos).toEqual([".gitignore", "docs/ñandú café.md", "src/nuevo.ts", "src/ok.ts"]);
    expect(ignorados).toEqual(["src/generado.tsbuildinfo", "src/oculto/a.ts", "src/x.ts"]);
  });

  it("un patrón de .gitignore que esconde src/x.ts → ignorado-en-raiz-de-codigo; un generado declarado, no", () => {
    escribir(".gitignore", "src/x.ts\n*.tsbuildinfo\n");
    escribir("src/ok.ts");
    escribir("src/x.ts");
    escribir("src/generado.tsbuildinfo");
    const { archivos, ignorados } = listarRutasConGit(raiz);
    const r = clasificarRutas({ archivos, ignorados, crons: [], reglas: REGLAS_DE_RUTA, exclusiones: [], hoy: HOY });
    expect(vistos(r)).toEqual([["ignorado-en-raiz-de-codigo", "src/x.ts"]]);
    // Sin el patrón, el archivo entra al listado y se clasifica.
    escribir(".gitignore", "*.tsbuildinfo\n");
    const sin = listarRutasConGit(raiz);
    expect(sin.archivos).toContain("src/x.ts");
    expect(vistos(clasificarRutas({ archivos: sin.archivos, ignorados: sin.ignorados, crons: [], reglas: REGLAS_DE_RUTA, exclusiones: [], hoy: HOY }))).toEqual([]);
  });

  it("un archivo nuevo sin versionar en un lugar que ninguna regla reconoce falla", () => {
    escribir("src/ok.ts");
    escribir("src/modulo-nuevo/x.ts");
    const { archivos, ignorados } = listarRutasConGit(raiz);
    expect(vistos(clasificarRutas({ archivos, ignorados, crons: [], reglas: REGLAS_DE_RUTA, exclusiones: [], hoy: HOY }))).toEqual([["ruta-sin-clasificar", "src/modulo-nuevo/x.ts"]]);
  });

  it("vercel.json: lee los crons; sin el archivo o con otra forma, lanza", () => {
    expect(() => leerCronsDeVercel(raiz)).toThrow();
    escribir("vercel.json", JSON.stringify({ regions: ["pdx1"] }));
    expect(leerCronsDeVercel(raiz)).toEqual([]);
    escribir("vercel.json", JSON.stringify({ crons: [{ path: "/api/cron/a", schedule: "0 12 * * *" }, { path: "/api/cron/b", schedule: "0 13 * * *" }] }));
    expect(leerCronsDeVercel(raiz)).toEqual(["/api/cron/a", "/api/cron/b"]);
    escribir("vercel.json", JSON.stringify({ crons: "no" }));
    expect(() => leerCronsDeVercel(raiz)).toThrow(/lista/);
    escribir("vercel.json", JSON.stringify({ crons: [{ path: "cron/a" }] }));
    expect(() => leerCronsDeVercel(raiz)).toThrow(/\/api\//);
  });
});
