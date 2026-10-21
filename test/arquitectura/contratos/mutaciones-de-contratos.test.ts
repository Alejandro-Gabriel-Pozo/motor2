import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RAIZ_DEL_REPO } from "../cercos/trinquete";
import { AREAS, type TipoDeHallazgoDeArea } from "./gobernanza/areas";
import type { TipoDeHallazgoDeRuta } from "./gobernanza/clasificacion";
import { MANIFIESTO } from "./manifiesto";
import { CLASES_DE_MUTACION, CUBIERTOS_EN_MOTOR_TEST, DEUDA_DE_HUECOS, EJEMPLOS_DE_CONTRATOS, problemasDeLaDeuda, type Matriz } from "./mutaciones/matriz";
import { ejecutarMatriz, existeElTest, falla, tablaComoJson, tablaComoTexto, type ResultadoDelArnes } from "./mutaciones/arnes";
import { fechaUtcDeHoy } from "./politica";
import { TIPOS_DE_HALLAZGO, type Contrato } from "./tipos";

/**
 * El ARNÉS DE MUTACIONES del guardián de contratos (paso G6a). La pregunta que responde: «si alguien rompe algo que un invariante necesita, ¿el guardián FALLA, con un diagnóstico
 * útil (tipo de hallazgo, archivo, línea real, id del contrato, corrección sugerida)?». Corre cada mutación de la matriz (`mutaciones/matriz.ts`) sobre una COPIA del repo real
 * —nunca el repo—, compara con lo esperado, revierte y comprueba que el guardián vuelve a dar 0 hallazgos. Si una mutación SOBREVIVE falla con
 * «HUECO: invariante X · clase Y · elemento Z: el guardián no protege esto». Los meta-tests de abajo exigen que la matriz cubra cada clase, cada tipo de hallazgo y cada contrato.
 * Qué prueba y qué no: ver «Mutaciones» en `LEEME.md` (prueba el MECANISMO sobre los contratos declarados; mutar la lógica de una función de negocio lo cubren sus tests).
 */

const HOY = "2026-10-21";
const ARCHIVO_DEL_ARNES = "test/arquitectura/contratos/mutaciones-de-contratos.test.ts";

let real: ResultadoDelArnes;
let matriz: Matriz;

const corrida = (): Promise<ResultadoDelArnes> => ejecutarMatriz({ raizReal: RAIZ_DEL_REPO, contratos: MANIFIESTO, ejemplos: EJEMPLOS_DE_CONTRATOS, hoy: HOY, soloContratos: false });

beforeAll(async () => {
  real = await corrida();
  matriz = real.matriz;
  const por = (v: string): number => real.filas.filter((f) => f.veredicto === v).length;
  console.info(
    `[mutaciones] ${matriz.invariantes.length} invariantes · ${real.filas.length} mutaciones en la matriz · ${real.corridas} corridas · protegidas ${por("protegido")} · huecos conocidos ${por("hueco-conocido-confirmado")} · no aplican ${por("no-aplica")} · ${(real.milisegundos / 1000).toFixed(1)} s (motor ${(real.tiempos.motor / 1000).toFixed(1)} · clasificación ${(real.tiempos.clasificacion / 1000).toFixed(1)} · áreas ${(real.tiempos.areas / 1000).toFixed(1)})`
  );
}, 180_000);

// ---------------------------------------------------------------------------------------------------------------------------------
// 1. El arnés sobre el repo real
// ---------------------------------------------------------------------------------------------------------------------------------

describe("arnés de mutaciones (repo real)", () => {
  it("la copia sin mutar da 0 hallazgos: sin eso las mutaciones no prueban nada", () => {
    expect(real.baseLimpia.map((o) => `${o.verifica}/${o.tipo} ${o.archivo}:${o.linea}`)).toEqual([]);
  });

  it("ninguna mutación sobrevive: cada una da el hallazgo esperado (tipo, archivo, línea real, mensaje), y el guardián vuelve a 0 al revertir", () => {
    const fallas = real.filas.filter(falla);
    expect(fallas.map((f) => `${f.veredicto} · ${f.invariante} · ${f.clase}`), `\n${tablaComoTexto(real.filas, true)}`).toEqual([]);
  });

  it("la tabla (invariante · clase · elemento · mutación · esperado · real) sale como texto y como JSON para el ejecutor de evidencia", () => {
    expect(tablaComoTexto(real.filas)).toContain("mutación:");
    const json = JSON.parse(tablaComoJson(real.filas)) as { invariante: string; clase: string; elemento: string; mutacion: string; esperado: string; real: string; veredicto: string }[];
    expect(json).toHaveLength(real.filas.length);
    expect(Object.keys(json[0]).sort()).toEqual(expect.arrayContaining(["clase", "elemento", "esperado", "invariante", "mutacion", "real", "veredicto"]));
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// 2. Meta-tests: la matriz cubre todo
// ---------------------------------------------------------------------------------------------------------------------------------

describe("meta-tests de la matriz", () => {
  it("(i) cada invariante cubre CADA clase de mutación con una mutación que aplica, o declara noAplica con un motivo de 20 caracteres o más", () => {
    const problemas: string[] = [];
    for (const inv of matriz.invariantes) {
      for (const clase of CLASES_DE_MUTACION) {
        const no = inv.noAplica.find((n) => n.clase === clase);
        const cubiertas = real.filas.filter((f) => f.invariante === inv.id && f.clase === clase && (f.veredicto === "protegido" || f.veredicto === "hueco-conocido-confirmado"));
        if (no !== undefined && no.motivo.trim().length < 20) problemas.push(`${inv.id} · ${clase}: el motivo de noAplica tiene menos de 20 caracteres`);
        if (no !== undefined && inv.mutaciones.some((m) => m.clase === clase)) problemas.push(`${inv.id} · ${clase}: declara noAplica y tiene mutaciones`);
        if (no === undefined && cubiertas.length === 0) {
          const razones = real.filas.filter((f) => f.invariante === inv.id && f.clase === clase).map((f) => f.detalle || f.veredicto);
          problemas.push(`${inv.id} · ${clase}: ninguna mutación aplicó (${razones.join(" | ") || "no hay mutaciones"}); agregá un operador o declará noAplica con su motivo`);
        }
      }
    }
    expect(problemas).toEqual([]);
  });

  it("(i) cada invariante dice qué lo define, qué lo aplica y qué lo verifica, con la ruta de cada elemento; los ids de mutación son únicos", () => {
    for (const inv of matriz.invariantes) {
      for (const lista of [inv.elementos.definen, inv.elementos.aplican, inv.elementos.verifican]) {
        expect(lista.length, inv.id).toBeGreaterThan(0);
        for (const e of lista) expect(e.ruta.trim() !== "" && e.que.trim().length >= 5, `${inv.id}: ${JSON.stringify(e)}`).toBe(true);
      }
      expect(inv.mecanismo.length, inv.id).toBeGreaterThan(0);
      expect(inv.descripcion.length, inv.id).toBeGreaterThanOrEqual(40);
    }
    const ids = matriz.invariantes.flatMap((i) => i.mutaciones.map((m) => m.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("(ii) cada tipo de hallazgo del motor, de las áreas y de la clasificación lo produce alguna mutación protegida, o lo cubre un test que existe (CUBIERTOS_EN_MOTOR_TEST)", () => {
    // Exhaustivos por tipo: un tipo nuevo en `areas.ts` o `clasificacion.ts` no compila hasta que se lo lista acá.
    const deAreas: Record<TipoDeHallazgoDeArea, true> = { "area-sin-declaracion": true, "area-fantasma": true, "dependencia-omitida": true, "dependencia-falsa": true, "area-sin-clasificar": true };
    const deRutas: Record<TipoDeHallazgoDeRuta, true> = {
      "ruta-sin-clasificar": true,
      "clasificacion-ambigua": true,
      "exclusion-ampliada": true,
      "exclusion-sin-uso": true,
      "ignorado-en-raiz-de-codigo": true,
      "cron-mal-clasificado": true,
      "excepcion-sin-motivo": true,
      "excepcion-sin-responsable": true,
      "excepcion-sin-aprobacion": true,
      "excepcion-vencida": true,
      "horizonte-excedido": true,
      "alcance-vacio": true,
    };
    const producidos = new Set(real.filas.filter((f) => f.veredicto === "protegido").map((f) => f.esperado.split(" · ")[0]));
    const requeridos = [...TIPOS_DE_HALLAZGO.map((t) => `motor/${t}`), ...Object.keys(deAreas).map((t) => `areas/${t}`), ...Object.keys(deRutas).map((t) => `clasificacion/${t}`)];
    const sinCubrir = requeridos.filter((r) => !producidos.has(r) && !(r.split("/")[1] in CUBIERTOS_EN_MOTOR_TEST));
    expect(sinCubrir, "ningún invariante de la matriz produce estos tipos de hallazgo: agregá una mutación o listalos en CUBIERTOS_EN_MOTOR_TEST con el test que los cubre").toEqual([]);
    for (const [tipo, { archivo, titulo }] of Object.entries(CUBIERTOS_EN_MOTOR_TEST)) {
      expect(existeElTest(readFileSync(join(RAIZ_DEL_REPO, ...archivo.split("/")), "utf8"), titulo), `${tipo}: no existe el test «${titulo}» en ${archivo}`).toBe(true);
    }
  });

  it("(ii) existeElTest encuentra un test por su título exacto y no confunde otro título", () => {
    const texto = 'describe("x", () => {\n  it("uno exacto", () => {});\n  it.skip(\'otro\', () => {});\n  test(`tres`, () => {});\n});\n';
    expect(existeElTest(texto, "uno exacto")).toBe(true);
    expect(existeElTest(texto, "otro")).toBe(true);
    expect(existeElTest(texto, "tres")).toBe(true);
    expect(existeElTest(texto, "uno")).toBe(false);
    expect(existeElTest(texto, "x")).toBe(false);
  });

  it("(iii) un contrato o un área nuevos sin entradas de matriz fallan: «actualizá la matriz»", () => {
    expect(matriz.sinEjemplos.map((id) => `actualizá la matriz: el contrato «${id}» no tiene ejemplos en EJEMPLOS_DE_CONTRATOS`)).toEqual([]);
    for (const c of MANIFIESTO) {
      const inv = matriz.invariantes.find((i) => i.id === `contrato/${c.id}`);
      expect(inv, `actualizá la matriz: no hay invariante para el contrato «${c.id}»`).toBeDefined();
      const protegidas = real.filas.filter((f) => f.invariante === `contrato/${c.id}` && f.veredicto === "protegido").length;
      expect(protegidas, `contrato ${c.id}: ninguna mutación aplicable lo protege (invariante sin proteger)`).toBeGreaterThan(0);
    }
    // Cada área que declara un contrato del manifiesto tiene su mutación «el área deja de declararlo».
    for (const [area, ids] of Object.entries(AREAS)) {
      for (const id of ids.filter((x) => MANIFIESTO.some((c) => c.id === x))) {
        const hay = matriz.invariantes.some((i) => i.mutaciones.some((m) => m.operador === "area" && m.parametros.modo === "vaciar" && m.parametros.area === area && m.parametros.contrato === id));
        expect(hay, `actualizá la matriz: el área «${area}» declara «${id}» y ninguna mutación la desconecta`).toBe(true);
      }
    }
    // Y un invariante del guardián sin mutaciones no es un invariante.
    for (const inv of matriz.invariantes) expect(inv.mutaciones.length, inv.id).toBeGreaterThan(0);
  });

  it("(iv) cada hueco conocido tiene su deuda vigente (motivo, responsable, aprobación, 60 días como máximo, resuelve en G6), y cada deuda corresponde a un hueco", () => {
    const huecos = matriz.invariantes.flatMap((i) => i.mutaciones.filter((m) => m.estado === "hueco-conocido"));
    const problemas: string[] = [];
    for (const h of huecos) {
      const deuda = DEUDA_DE_HUECOS.filter((d) => d.fragmento === h.hueco);
      if (deuda.length !== 1) problemas.push(`el hueco «${h.hueco}» (${h.id}) tiene ${deuda.length} entradas de deuda en DEUDA_DE_HUECOS (tiene que tener una)`);
    }
    for (const d of DEUDA_DE_HUECOS) {
      if (!huecos.some((h) => h.hueco === d.fragmento)) problemas.push(`la deuda «${d.fragmento}» no corresponde a ningún hueco conocido de la matriz: sobra`);
      problemas.push(...problemasDeLaDeuda(d, fechaUtcDeHoy()));
    }
    expect(problemas).toEqual([]);
    for (const h of matriz.invariantes.flatMap((i) => i.mutaciones)) expect(h.estado === "protegido" ? h.hueco : "-", h.id).toBe(h.estado === "protegido" ? "" : "-");
  });

  it("(iv) problemasDeLaDeuda rechaza una deuda vencida, sin motivo, sin resolver en G6, con más de 60 días o con otro responsable", () => {
    const [d] = DEUDA_DE_HUECOS;
    expect(problemasDeLaDeuda(d, "2026-10-21")).toEqual([]);
    expect(problemasDeLaDeuda(d, "2026-12-20")).toEqual([]);
    expect(problemasDeLaDeuda(d, "2026-12-21").join("|")).toContain("venció el 2026-12-20");
    expect(problemasDeLaDeuda({ ...d, motivo: "corto" }, "2026-10-21").join("|")).toContain("no tiene motivo");
    expect(problemasDeLaDeuda({ ...d, resuelveEn: "M5" }, "2026-10-21").join("|")).toContain("G6");
    expect(problemasDeLaDeuda({ ...d, vence: "2027-01-01" }, "2026-10-21").join("|")).toContain("más de 60 días");
    expect(problemasDeLaDeuda({ ...d, responsable: "tercero" as never }, "2026-10-21").join("|")).toContain("responsable");
    expect(problemasDeLaDeuda({ ...d, aprobacion: { por: "dueño", referencia: "nada" } }, "2026-10-21").join("|")).toContain("aprobación");
  });

  it("(v) el arnés corre dentro de npm test: es un .test.ts bajo test/ y vitest.config.ts no lo excluye", () => {
    expect(ARCHIVO_DEL_ARNES.startsWith("test/") && ARCHIVO_DEL_ARNES.endsWith(".test.ts")).toBe(true);
    const config = readFileSync(join(RAIZ_DEL_REPO, "vitest.config.ts"), "utf8");
    const exclude = /exclude:\s*\[([^\]]*)\]/.exec(config)?.[1] ?? "";
    expect(exclude).not.toContain("arquitectura");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// 3. El propio arnés: una mutación que sobrevive tiene que hacerlo fallar
// ---------------------------------------------------------------------------------------------------------------------------------

describe("el arnés detecta cuando el guardián NO protege", () => {
  const soloEstas = (...ids: string[]) => (_inv: string, m: { id: string }): boolean => ids.some((i) => m.id.includes(i));

  it("una mutación que sobrevive y se marca protegida es un HUECO, con el invariante, la clase y el elemento", async () => {
    const r = await ejecutarMatriz({
      raizReal: RAIZ_DEL_REPO,
      contratos: MANIFIESTO,
      ejemplos: EJEMPLOS_DE_CONTRATOS,
      hoy: HOY,
      soloContratos: false,
      filtro: soloEstas("evasion/texto[test/arquitectura/contratos/contratos.test.ts"),
      // El describe.skip sobrevive HOY (es un hueco conocido): quien lo marque protegido tiene que ver el rojo.
      alterar: (m): Matriz => ({ ...m, invariantes: m.invariantes.map((i) => ({ ...i, mutaciones: i.mutaciones.map((x) => ({ ...x, estado: "protegido" as const, hueco: "" })) })) }),
    });
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].veredicto).toBe("HUECO");
    expect(tablaComoTexto(r.filas, true)).toMatch(/^HUECO: guardian\/guardian-no-neutralizable · evasion · test\/arquitectura\/contratos\/contratos\.test\.ts · .*: el guardián no protege esto/);
  }, 60_000);

  it("un hueco conocido que ya se detecta pide pasarlo a protegido; y un esperado equivocado es un HUECO con el resultado real", async () => {
    const r = await ejecutarMatriz({
      raizReal: RAIZ_DEL_REPO,
      contratos: MANIFIESTO,
      ejemplos: EJEMPLOS_DE_CONTRATOS,
      hoy: HOY,
      soloContratos: false,
      filtro: soloEstas("eliminacion/ancla[", "eliminacion/vaciar-manifiesto"),
      alterar: (m): Matriz => ({
        ...m,
        invariantes: m.invariantes.map((i) => ({
          ...i,
          mutaciones: i.mutaciones.map((x) => (x.operador === "ancla" ? { ...x, estado: "hueco-conocido" as const, hueco: "falso" } : x.operador === "vaciar-manifiesto" ? { ...x, esperado: { ...x.esperado, tipo: "alcance-vacio" } } : x)),
        })),
      }),
    });
    const veredictos = r.filas.map((f) => f.veredicto);
    expect(veredictos).toContain("hueco-ya-protegido");
    expect(veredictos).toContain("HUECO");
    const hueco = r.filas.find((f) => f.veredicto === "HUECO");
    expect(hueco?.real).toContain("motor/marca-desconocida");
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// 4. Los operadores sobre contratos de TypeScript y de nombres (árbol sintético, sin git)
// ---------------------------------------------------------------------------------------------------------------------------------

describe("el catálogo de operadores sobre contratos de TypeScript y de nombres (árbol sintético)", () => {
  let raiz: string;
  const DINERO: Contrato = {
    id: "redondeo-de-dinero",
    porQue: "redondear mal el dinero cambia lo que se cobra",
    fuente: { archivo: "src/core/moneda.ts", ancla: "redondearMoneda" },
    alcance: { raices: ["src/app"], extensiones: [".ts"] },
    senales: [{ adaptador: "ts", tipo: "codigo", patron: /Math\.round\([^()]*\*\s*100\)\s*\/\s*100/g, que: "redondea a centavos con Math.round" }],
    declaracion: { tipo: "importar-ancla" },
    definicion: [{ adaptador: "ts", tipo: "declara", nombre: /^redondearMoneda$/, que: "declara otra `redondearMoneda`" }],
    consumidores: "descubiertos",
    casosLegitimos: [],
    excepciones: [],
    deuda: [],
  };
  const VARIABLES: Contrato = {
    id: "variables-de-carta",
    porQue: "una variable mal escrita cae en silencio al valor heredado",
    fuente: { archivo: "src/estilos/tema.css", ancla: ":root" },
    alcance: { raices: ["src/componentes"], extensiones: [".css"] },
    senales: [{ adaptador: "css", tipo: "variable", nombre: /^--carta-/, que: "lee una variable de la carta" }],
    declaracion: { tipo: "nombre-definido-en-la-fuente" },
    definicion: [{ adaptador: "css", tipo: "define-variable", nombre: /^--carta-/, que: "define una variable de la carta" }],
    consumidores: "descubiertos",
    casosLegitimos: [],
    excepciones: [],
    deuda: [],
  };
  const EJEMPLOS = {
    "redondeo-de-dinero": {
      uso: "export function f(n: number) {\n  return Math.round(n * 100) / 100;\n}\n",
      definicion: "export function redondearMoneda(n: number) {\n  return n;\n}\n",
    },
    "variables-de-carta": { uso: ".x {\n  color: var(--carta-inventada);\n}\n", definicion: ":root {\n  --carta-otra: red;\n}\n" },
  };
  const escribir = (ruta: string, contenido: string): void => {
    mkdirSync(dirname(join(raiz, ...ruta.split("/"))), { recursive: true });
    writeFileSync(join(raiz, ...ruta.split("/")), contenido);
  };

  beforeAll(() => {
    raiz = mkdtempSync(join(tmpdir(), "mutaciones-sintetico-"));
    escribir("test/arquitectura/contratos/contratos/redondeo-de-dinero.ts", '// definición\nexport const C = {\n  id: "redondeo-de-dinero",\n};\n');
    escribir("test/arquitectura/contratos/contratos/variables-de-carta.ts", '// definición\nexport const C = {\n  id: "variables-de-carta",\n};\n');
    escribir("src/core/moneda.ts", "// uno\n/** @contrato redondeo-de-dinero */\nexport function redondearMoneda(n: number): number {\n  return n;\n}\n");
    escribir("src/app/ok.ts", 'import { redondearMoneda } from "@/core/moneda";\nexport const a = redondearMoneda(1.005) + Math.round(2 * 100) / 100;\n');
    escribir("src/estilos/tema.css", "/* @contrato variables-de-carta */\n:root {\n  --carta-tinta: #111;\n  --carta-papel: #fff;\n}\n");
    escribir("src/componentes/uno.css", ".a {\n  color: var(--carta-tinta);\n  background: var(--carta-papel);\n}\n");
  });
  afterAll(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  it("cada clase (menos la evasión, que es transversal) tiene una mutación protegida en cada contrato, y ninguna sobrevive", async () => {
    const r = await ejecutarMatriz({ raizReal: raiz, contratos: [DINERO, VARIABLES], ejemplos: EJEMPLOS, hoy: HOY, soloContratos: true });
    expect(r.baseLimpia).toEqual([]);
    expect(r.filas.filter(falla).map((f) => `${f.veredicto} · ${f.invariante} · ${f.clase} · ${f.operador}: ${f.detalle}`), `\n${tablaComoTexto(r.filas, true)}`).toEqual([]);
    for (const id of ["contrato/redondeo-de-dinero", "contrato/variables-de-carta"]) {
      for (const clase of ["eliminacion", "alteracion", "duplicacion", "desconexion", "exclusion-del-analisis"]) {
        expect(r.filas.some((f) => f.invariante === id && f.clase === clase && f.veredicto === "protegido"), `${id} · ${clase}`).toBe(true);
      }
    }
    const tipos = new Set(r.filas.filter((f) => f.veredicto === "protegido").map((f) => f.esperado.split(" · ")[0]));
    for (const t of ["motor/fuente-ausente", "motor/marca-desconocida", "motor/marca-duplicada", "motor/definicion-duplicada", "motor/uso-sin-declarar", "motor/declaracion-sin-uso", "motor/alcance-vacio"]) expect(tipos.has(t), t).toBe(true);
  }, 60_000);
});
