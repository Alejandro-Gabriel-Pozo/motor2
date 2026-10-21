import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sinVariantes } from "./adaptadores/clases-tsx";
import { leerReglas } from "./adaptadores/css";
import { formatearAviso, formatearHallazgo, formatearReporte, resumirContratos, revisarContratos } from "./motor";
import { evaluarVencimientos, fechaUtcDeHoy } from "./politica";
import type { CasoLegitimo, Contrato, Deuda, Excepcion, Resultado, TipoDeHallazgo } from "./tipos";

/**
 * Las MUTACIONES del propio motor de contratos, sobre un árbol TEMPORAL (nunca el repo; mismo criterio que `cercos/trinquete.test.ts`). Cada caso arma un árbol chico,
 * corre el motor y comprueba el TIPO de hallazgo y su posición `archivo:línea:columna`: lo que se usa sin declarar, una definición duplicada, dos marcas, un
 * consumidor fantasma, una fuente o un ancla ausentes, una excepción o una deuda que sobra o no tiene motivo, un alcance vacío y un contrato sin consumidores
 * dan rojo; una mención en un comentario o en un texto, y una declaración correcta, dan verde.
 */
let raiz: string;

function escribir(archivos: Record<string, string>): void {
  for (const [ruta, contenido] of Object.entries(archivos)) {
    const absoluta = join(raiz, ...ruta.split("/"));
    mkdirSync(dirname(absoluta), { recursive: true });
    writeFileSync(absoluta, contenido);
  }
}

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "contratos-"));
});
afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

/** El día de hoy de todas las corridas de prueba (se inyecta: el motor no mira el reloj). */
const HOY = "2026-10-21";
const correrCon = (hoy: string, ...contratos: Contrato[]): Resultado => revisarContratos({ raiz, contratos, hoy });
const correr = (...contratos: Contrato[]): Resultado => correrCon(HOY, ...contratos);
/** Lo esencial de cada hallazgo: tipo, archivo y posición. */
const vistos = (r: Resultado): [TipoDeHallazgo, string, number, number][] => r.hallazgos.map((h) => [h.tipo, h.archivo, h.linea, h.columna]);

const MOTIVO = "una razón escrita con más de veinte caracteres";
/** El gobierno completo y válido de una entrada (responsable, aprobación, creada HOY, sin renovaciones y vence a 59 días). */
const GOBIERNO = { responsable: "dueño", aprobacion: { por: "dueño", referencia: "PR #12" }, creada: "2026-10-21", renovaciones: [], vence: "2026-12-19" } as const;
const exc = (e: Pick<Excepcion, "archivo" | "fragmento"> & Partial<Excepcion>): Excepcion => ({ motivo: MOTIVO, ...GOBIERNO, ...e });
const deu = (d: Pick<Deuda, "archivo" | "fragmento"> & Partial<Deuda>): Deuda => ({ motivo: MOTIVO, resuelveEn: "paso M5", ...GOBIERNO, ...d });

// ---------------------------------------------------------------------------------------------------------------------------------
// Contrato de TypeScript: «redondeo de dinero» (se declara importando el ancla)
// ---------------------------------------------------------------------------------------------------------------------------------

const FUENTE_TS = `/** @contrato redondeo-de-dinero */
export function redondearMoneda(n: number): number {
  return n;
}
`;
const USO_OK = `import { redondearMoneda } from "@/core/moneda";
export const a = redondearMoneda(1.005);
`;
const USO_MALO = `export function f(n: number) {
  return Math.round(n * 100) / 100;
}
`;

function dinero(extra: Partial<Contrato> = {}): Contrato {
  return {
    id: "redondeo-de-dinero",
    porQue: "redondear mal el dinero cambia lo que se cobra",
    fuente: { archivo: "src/core/moneda.ts", ancla: "redondearMoneda" },
    alcance: { raices: ["src"], extensiones: [".ts", ".tsx"] },
    senales: [{ adaptador: "ts", tipo: "codigo", patron: /Math\.round\([^()]*\*\s*100\)\s*\/\s*100/g, que: "redondea a centavos con Math.round" }],
    declaracion: { tipo: "importar-ancla" },
    definicion: [{ adaptador: "ts", tipo: "declara", nombre: /^redondearMoneda$/, que: "declara otra `redondearMoneda`" }],
    consumidores: "descubiertos",
    casosLegitimos: [],
    excepciones: [],
    deuda: [],
    ...extra,
  };
}

function arbolDinero(extra: Record<string, string> = {}): void {
  escribir({ "src/core/moneda.ts": FUENTE_TS, "src/ok.ts": USO_OK, ...extra });
}

describe("motor: contrato de TypeScript (importar el ancla)", () => {
  it("la declaración correcta da verde, y el resumen cuenta contratos y archivos leídos una vez", () => {
    arbolDinero();
    const r = correr(dinero());
    expect(vistos(r)).toEqual([]);
    expect(r.resumen).toMatchObject({ contratos: 1, deudaTotal: 0, excepcionesTotal: 0 });
    expect(resumirContratos(r)).toContain("1 contratos");
  });

  it("usar sin declarar da rojo, con el archivo, la línea y la columna del uso", () => {
    arbolDinero({ "src/malo.ts": USO_MALO });
    expect(vistos(correr(dinero()))).toEqual([["uso-sin-declarar", "src/malo.ts", 2, 10]]);
  });

  it("importar OTRO símbolo de la fuente no declara el ancla", () => {
    arbolDinero({
      "src/core/moneda.ts": `${FUENTE_TS}export const otra = 1;\n`,
      // El comentario nombra el ancla: el filtro de texto lo deja pasar y es el AST el que decide que no se importó.
      "src/malo.ts": `import { otra } from "@/core/moneda"; // ver redondearMoneda\nexport const x = otra + Math.round(1 * 100) / 100;\n`,
    });
    expect(vistos(correr(dinero()))).toEqual([["uso-sin-declarar", "src/malo.ts", 2, 25]]);
  });

  it("el import relativo, con alias y por espacio de nombres (usándolo) también declaran", () => {
    arbolDinero({
      "src/a/relativo.ts": `import { redondearMoneda as r } from "../core/moneda";\nexport const x = r(1) + Math.round(2 * 100) / 100;\n`,
      "src/b/espacio.ts": `import * as m from "@/core/moneda";\nexport const x = m.redondearMoneda(1) + Math.round(2 * 100) / 100;\n`,
    });
    expect(vistos(correr(dinero()))).toEqual([]);
  });

  it("una mención en un comentario, en un string o en una plantilla es verde (sin falso positivo)", () => {
    arbolDinero({
      "src/menciona.ts": [
        "// Math.round(n * 100) / 100 era el redondeo viejo",
        "/* y también Math.round(n * 100) / 100 */",
        'export const s = "Math.round(n * 100) / 100";',
        "export const t = `Math.round(n * 100) / 100 ${1}`;",
        "export const r = /Math.round(n * 100) \\/ 100/;",
        "",
      ].join("\n"),
    });
    expect(vistos(correr(dinero()))).toEqual([]);
  });

  it("una definición duplicada fuera de la fuente da rojo, en el nombre declarado", () => {
    arbolDinero({ "src/otro.ts": "export function redondearMoneda(n: number): number {\n  return n;\n}\n" });
    expect(vistos(correr(dinero()))).toEqual([["definicion-duplicada", "src/otro.ts", 1, 17]]);
  });

  it("la fuente misma no cuenta como consumidor ni como duplicado de sí misma", () => {
    arbolDinero({ "src/core/moneda.ts": `${FUENTE_TS}export const interno = Math.round(1 * 100) / 100;\n` });
    expect(vistos(correr(dinero()))).toEqual([]);
  });

  it("importar el ancla sin usarlo ni usar nada del contrato es una declaración sin uso", () => {
    arbolDinero({ "src/inutil.ts": 'import { redondearMoneda } from "./core/moneda";\nexport const z = 1;\n' });
    expect(vistos(correr(dinero()))).toEqual([["declaracion-sin-uso", "src/inutil.ts", 1, 10]]);
  });

  it("un contrato sin consumidores (ningún archivo declara) da consumidor-fantasma, en la fuente", () => {
    escribir({ "src/core/moneda.ts": FUENTE_TS, "src/nada.ts": "export const n = 1;\n" });
    expect(vistos(correr(dinero()))).toEqual([["consumidor-fantasma", "src/core/moneda.ts", 1, 1]]);
  });

  it("lista cerrada: un listado que no existe, que no declara o que está fuera del alcance es fantasma; uno que declara y no figura, uso sin declarar", () => {
    arbolDinero({ "src/dos.ts": USO_OK, "src/malo.ts": USO_MALO, "fuera/x.ts": USO_OK });
    const lista = ["src/ok.ts", "src/no-existe.ts", "src/malo.ts", "fuera/x.ts"];
    expect(vistos(correr(dinero({ consumidores: lista })))).toEqual([
      ["consumidor-fantasma", "fuera/x.ts", 1, 1],
      ["uso-sin-declarar", "src/dos.ts", 1, 10],
      ["consumidor-fantasma", "src/malo.ts", 1, 1],
      ["uso-sin-declarar", "src/malo.ts", 2, 10],
      ["consumidor-fantasma", "src/no-existe.ts", 1, 1],
    ]);
  });

  it("lista cerrada exacta: verde; vacía: fantasma", () => {
    arbolDinero();
    expect(vistos(correr(dinero({ consumidores: ["src/ok.ts"] })))).toEqual([]);
    expect(vistos(correr(dinero({ consumidores: [] })))).toEqual([
      ["consumidor-fantasma", "src/core/moneda.ts", 1, 1],
      ["uso-sin-declarar", "src/ok.ts", 1, 10],
    ]);
  });
});

describe("motor: la fuente y sus marcas", () => {
  it("la fuente ausente da fuente-ausente", () => {
    escribir({ "src/ok.ts": USO_OK });
    expect(vistos(correr(dinero()))).toEqual([["fuente-ausente", "src/core/moneda.ts", 1, 1]]);
  });

  it("el ancla ausente da fuente-ausente", () => {
    arbolDinero({ "src/core/moneda.ts": "/** @contrato redondeo-de-dinero */\nexport function otraCosa() {}\n" });
    const r = correr(dinero());
    expect(r.hallazgos.filter((h) => h.tipo === "fuente-ausente").map((h) => [h.archivo, h.linea, h.columna])).toEqual([["src/core/moneda.ts", 1, 1]]);
    expect(r.hallazgos[0].que).toContain("el ancla `redondearMoneda`");
  });

  it("la fuente sin marca da fuente-ausente", () => {
    arbolDinero({ "src/core/moneda.ts": "export function redondearMoneda(n: number) {\n  return n;\n}\n" });
    const r = correr(dinero());
    expect(vistos(r)).toEqual([["fuente-ausente", "src/core/moneda.ts", 1, 1]]);
    expect(r.hallazgos[0].que).toContain("marca");
  });

  it("dos marcas en la fuente: la segunda es marca-duplicada, en su posición", () => {
    arbolDinero({ "src/core/moneda.ts": `${FUENTE_TS}// @contrato redondeo-de-dinero\n` });
    expect(vistos(correr(dinero()))).toEqual([["marca-duplicada", "src/core/moneda.ts", 5, 4]]);
  });

  it("la marca copiada en otro archivo es marca-duplicada (y su copia de la función, definición duplicada)", () => {
    arbolDinero({ "src/copia.ts": "// @contrato redondeo-de-dinero\nexport function redondearMoneda(n: number) {\n  return n;\n}\n" });
    expect(vistos(correr(dinero()))).toEqual([
      ["marca-duplicada", "src/copia.ts", 1, 4],
      ["definicion-duplicada", "src/copia.ts", 2, 17],
    ]);
  });

  it("una marca de un contrato que no está en el manifiesto es marca-desconocida", () => {
    arbolDinero({ "src/x.ts": "// @contrato fantasma-x\nexport const x = 1;\n", "test/y.css": "/* @contrato otro-fantasma */\n" });
    expect(vistos(correr(dinero()))).toEqual([
      ["marca-desconocida", "src/x.ts", 1, 4],
      ["marca-desconocida", "test/y.css", 1, 4],
    ]);
  });

  it("la marca dentro de un string no es una marca", () => {
    arbolDinero({ "src/x.ts": 'export const m = "@contrato fantasma-x";\n' });
    expect(vistos(correr(dinero()))).toEqual([]);
  });

  it("con el manifiesto vacío solo quedan las marcas sueltas", () => {
    escribir({ "src/x.ts": "// @contrato fantasma-x\n", "src/y.ts": "export const y = 1;\n" });
    expect(vistos(correr())).toEqual([["marca-desconocida", "src/x.ts", 1, 4]]);
    rmSync(join(raiz, "src", "x.ts"));
    const vacio = correr();
    expect(vacio.hallazgos).toEqual([]);
    expect(resumirContratos(vacio)).toContain("0 contratos");
  });

  it("alcance vacío: un contrato que no encuentra archivos da rojo, no pasa en vacío", () => {
    arbolDinero();
    expect(vistos(correr(dinero({ alcance: { raices: ["no-existe"], extensiones: [".ts"] } })))).toEqual([["alcance-vacio", "src/core/moneda.ts", 1, 1]]);
    expect(vistos(correr(dinero({ alcance: { raices: ["src"], extensiones: [".vue"] } })))).toEqual([["alcance-vacio", "src/core/moneda.ts", 1, 1]]);
  });
});

describe("motor: excepciones (por fragmento exacto, con motivo, en las dos direcciones)", () => {
  const USO = "Math.round(n * 100) / 100";

  it("una excepción con motivo deja pasar ese uso", () => {
    arbolDinero({ "src/malo.ts": USO_MALO });
    expect(vistos(correr(dinero({ excepciones: [exc({ archivo: "src/malo.ts", fragmento: USO })] })))).toEqual([]);
  });

  it("una excepción que ya no corresponde a ningún uso sobra", () => {
    arbolDinero();
    expect(vistos(correr(dinero({ excepciones: [exc({ archivo: "src/malo.ts", fragmento: USO })] })))).toEqual([["excepcion-sobrante", "src/malo.ts", 1, 1]]);
  });

  it("una excepción con otro fragmento no cubre el uso: el uso sigue en rojo y la excepción sobra", () => {
    arbolDinero({ "src/malo.ts": USO_MALO });
    expect(vistos(correr(dinero({ excepciones: [exc({ archivo: "src/malo.ts", fragmento: "Math.round(x * 100) / 100" })] })))).toEqual([
      ["excepcion-sobrante", "src/malo.ts", 1, 1],
      ["uso-sin-declarar", "src/malo.ts", 2, 10],
    ]);
  });

  it("una excepción sin motivo (menos de 20 caracteres) da rojo aunque se use", () => {
    arbolDinero({ "src/malo.ts": USO_MALO });
    expect(vistos(correr(dinero({ excepciones: [exc({ archivo: "src/malo.ts", fragmento: USO, motivo: "porque sí" })] })))).toEqual([["excepcion-sin-motivo", "src/malo.ts", 1, 1]]);
  });
});

describe("motor: casos legítimos (parte de la definición del contrato: sin vencimiento, archivo + fragmento exacto)", () => {
  const USO = "Math.round(n * 100) / 100";
  const caso = (c: Partial<CasoLegitimo> = {}): CasoLegitimo => ({ archivo: "src/malo.ts", fragmento: USO, motivo: MOTIVO, ...c });
  const tipos = (r: Resultado): TipoDeHallazgo[] => r.hallazgos.map((h) => h.tipo);

  it("un caso legítimo con motivo deja pasar ese uso, y el reporte lo cuenta por contrato", () => {
    arbolDinero({ "src/malo.ts": USO_MALO });
    const r = correr(dinero({ casosLegitimos: [caso()] }));
    expect(vistos(r)).toEqual([]);
    expect(r.resumen.casosLegitimosTotal).toBe(1);
    expect(r.resumen.casosLegitimosPorContrato).toEqual({ "redondeo-de-dinero": 1 });
    expect(resumirContratos(r)).toContain("excepciones: 0 · casos legítimos: 1 (redondeo-de-dinero: 1)");
    // Sin casos, la cuenta es cero y no nombra contratos.
    expect(resumirContratos(correr(dinero()))).toContain("casos legítimos: 0");
    expect(resumirContratos(correr(dinero()))).not.toContain("casos legítimos: 0 (");
  });

  it("un caso legítimo que ya no corresponde a ningún uso es caso-legitimo-sobrante", () => {
    arbolDinero();
    expect(vistos(correr(dinero({ casosLegitimos: [caso()] })))).toEqual([["caso-legitimo-sobrante", "src/malo.ts", 1, 1]]);
  });

  it("un caso con otro fragmento no cubre el uso: el uso sigue en rojo y el caso sobra", () => {
    arbolDinero({ "src/malo.ts": USO_MALO });
    expect(vistos(correr(dinero({ casosLegitimos: [caso({ fragmento: "Math.round(x * 100) / 100" })] })))).toEqual([
      ["caso-legitimo-sobrante", "src/malo.ts", 1, 1],
      ["uso-sin-declarar", "src/malo.ts", 2, 10],
    ]);
  });

  it("motivo de 19 caracteres: rojo (aunque se use); de 20: verde", () => {
    arbolDinero({ "src/malo.ts": USO_MALO });
    const m19 = "abcdefghijklmnopqrs";
    const m20 = "abcdefghijklmnopqrst";
    expect([m19.length, m20.length]).toEqual([19, 20]);
    expect(vistos(correr(dinero({ casosLegitimos: [caso({ motivo: m19 })] })))).toEqual([["caso-legitimo-sin-motivo", "src/malo.ts", 1, 1]]);
    expect(tipos(correr(dinero({ casosLegitimos: [caso({ motivo: "                    " })] })))).toEqual(["caso-legitimo-sin-motivo"]);
    expect(tipos(correr(dinero({ casosLegitimos: [caso({ motivo: m20 })] })))).toEqual([]);
  });

  it("el alcance es archivo + fragmento: el mismo uso en OTRO archivo sigue en rojo", () => {
    arbolDinero({ "src/malo.ts": USO_MALO, "src/otro.ts": USO_MALO.replace("f(", "g(") });
    expect(vistos(correr(dinero({ casosLegitimos: [caso()] })))).toEqual([["uso-sin-declarar", "src/otro.ts", 2, 10]]);
  });

  it("el caso de un archivo equivocado no cubre nada: el uso sigue en rojo y el caso sobra", () => {
    arbolDinero({ "src/malo.ts": USO_MALO });
    expect(vistos(correr(dinero({ casosLegitimos: [caso({ archivo: "src/otro.ts" })] })))).toEqual([
      ["uso-sin-declarar", "src/malo.ts", 2, 10],
      ["caso-legitimo-sobrante", "src/otro.ts", 1, 1],
    ]);
  });

  it("no vence: el mismo caso sigue en verde años después (a diferencia de una excepción)", () => {
    arbolDinero({ "src/malo.ts": USO_MALO });
    expect(tipos(correrCon("2040-01-01", dinero({ casosLegitimos: [caso()] })))).toEqual([]);
    expect(tipos(correrCon("2040-01-01", dinero({ excepciones: [exc({ archivo: "src/malo.ts", fragmento: USO })] })))).toEqual(["excepcion-vencida"]);
  });

  it("cubre también una definición duplicada con el mismo archivo y fragmento", () => {
    arbolDinero({ "src/dup.ts": "export function redondearMoneda(n: number): number {\n  return n;\n}\n" });
    const r = correr(dinero());
    expect(r.hallazgos.map((h) => [h.tipo, h.archivo])).toEqual([["definicion-duplicada", "src/dup.ts"]]);
    expect(tipos(correr(dinero({ casosLegitimos: [caso({ archivo: "src/dup.ts", fragmento: r.hallazgos[0].fragmento })] })))).toEqual([]);
  });

  it("tiene prioridad sobre una excepción o una deuda del mismo uso: ésas sobran", () => {
    arbolDinero({ "src/malo.ts": USO_MALO });
    const r = correr(dinero({ casosLegitimos: [caso()], excepciones: [exc({ archivo: "src/malo.ts", fragmento: USO })], deuda: [deu({ archivo: "src/malo.ts", fragmento: USO })] }));
    expect(tipos(r).sort()).toEqual(["deuda-sobrante", "excepcion-sobrante"]);
  });
});

describe("motor: deuda escrita uso por uso (nada de líneas de base que solo cuentan)", () => {
  const USO = "Math.round(n * 100) / 100";
  const entrada = deu({ archivo: "src/malo.ts", fragmento: USO });

  it("una entrada de deuda por cada uso real deja pasar, y el resumen informa la cantidad", () => {
    arbolDinero({ "src/malo.ts": USO_MALO, "src/malo2.ts": USO_MALO.replace("f(", "g(") });
    const r = correr(dinero({ deuda: [entrada, { ...entrada, archivo: "src/malo2.ts" }] }));
    expect(vistos(r)).toEqual([]);
    expect(r.resumen.deudaTotal).toBe(2);
    expect(r.resumen.deudaPorContrato).toEqual({ "redondeo-de-dinero": 2 });
    expect(resumirContratos(r)).toContain("deuda declarada: 2 usos (redondeo-de-dinero: 2)");
  });

  it("dos usos iguales con UNA sola entrada: queda uno en rojo (la deuda cubre un uso por entrada)", () => {
    arbolDinero({ "src/malo.ts": "export const a = Math.round(n * 100) / 100;\nexport const b = Math.round(n * 100) / 100;\n" });
    expect(vistos(correr(dinero({ deuda: [entrada] })))).toEqual([["uso-sin-declarar", "src/malo.ts", 2, 18]]);
  });

  it("una deuda sin uso real (sobrante) da rojo", () => {
    arbolDinero();
    expect(vistos(correr(dinero({ deuda: [entrada] })))).toEqual([["deuda-sobrante", "src/malo.ts", 1, 1]]);
  });

  it("una deuda sin motivo, o sin dónde se resuelve, da rojo", () => {
    arbolDinero({ "src/malo.ts": USO_MALO });
    expect(vistos(correr(dinero({ deuda: [{ ...entrada, motivo: "pendiente" }] })))).toEqual([["deuda-sin-motivo", "src/malo.ts", 1, 1]]);
    expect(vistos(correr(dinero({ deuda: [{ ...entrada, resuelveEn: "  " }] })))).toEqual([["deuda-sin-motivo", "src/malo.ts", 1, 1]]);
  });

  it("una excepción tiene prioridad: si cubre el uso, la deuda del mismo uso sobra", () => {
    arbolDinero({ "src/malo.ts": USO_MALO });
    const r = correr(dinero({ excepciones: [exc({ archivo: "src/malo.ts", fragmento: USO })], deuda: [entrada] }));
    expect(vistos(r)).toEqual([["deuda-sobrante", "src/malo.ts", 1, 1]]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Contrato de clases y CSS: «borde de la carta» (se declara con la clase compañera)
// ---------------------------------------------------------------------------------------------------------------------------------

const GLOBALS = `/* @contrato separador-de-borde */
.carta-shell .carta-borde {
  border-color: var(--carta-border);
}
`;

function borde(extra: Partial<Contrato> = {}): Contrato {
  return {
    id: "separador-de-borde",
    porQue: "un borde sin color cae al color del texto",
    fuente: { archivo: "src/app/globals.css", ancla: ".carta-shell .carta-borde" },
    alcance: { raices: ["src/components"], extensiones: [".tsx", ".css"] },
    senales: [
      { adaptador: "clases", token: /^border(?:-[tblrxy])?$/, que: "dibuja un borde con ancho" },
      { adaptador: "css", tipo: "declaracion", propiedad: /^border(?:-(?:top|bottom|left|right))?$/, valor: /\d/, que: "declara un borde con ancho" },
    ],
    declaracion: { tipo: "clase-companera", clase: "carta-borde", equivalentes: ["carta-linea-fina"] },
    definicion: [
      { adaptador: "ts", tipo: "propiedad", nombre: /^borderColor$/, valor: /#|rgb\(|carta-border/, que: "escribe el color del borde en un style" },
      { adaptador: "clases", token: /^border-\[#/, que: "escribe un color literal en una clase" },
    ],
    consumidores: "descubiertos",
    casosLegitimos: [],
    excepciones: [],
    deuda: [],
    ...extra,
  };
}

const TSX_OK = "export const A = () => (\n  <div className=\"carta-borde mt-2 border-t\">x</div>\n);\n";

function arbolBorde(extra: Record<string, string> = {}): void {
  escribir({ "src/app/globals.css": GLOBALS, "src/components/ok.tsx": TSX_OK, ...extra });
}

describe("motor: contrato de clases (clase compañera) y de CSS", () => {
  it("la clase compañera en la misma cadena da verde", () => {
    arbolBorde();
    expect(vistos(correr(borde()))).toEqual([]);
  });

  it("un borde con ancho sin la clase compañera da rojo, en el token que molesta", () => {
    arbolBorde({ "src/components/malo.tsx": 'export const B = () => (\n  <div className="mt-2 border-t">x</div>\n);\n' });
    expect(vistos(correr(borde()))).toEqual([["uso-sin-declarar", "src/components/malo.tsx", 2, 24]]);
  });

  it("con variantes, en una plantilla y en una constante: se informa el token tal como está escrito", () => {
    arbolBorde({
      "src/components/v.tsx": 'export const C = () => <div className="p-1 sm:hover:border-b">x</div>;\n',
      "src/components/p.tsx": "export const D = (x: string) => <div className={`md:border ${x}`}>x</div>;\n",
      "src/components/k.tsx": 'const CLASES = "flex !border-t!";\nexport const E = CLASES;\n',
    });
    expect(vistos(correr(borde()))).toEqual([
      ["uso-sin-declarar", "src/components/k.tsx", 1, 22],
      ["uso-sin-declarar", "src/components/p.tsx", 1, 50],
      ["uso-sin-declarar", "src/components/v.tsx", 1, 44],
    ]);
  });

  it("la clase equivalente declarada en la fuente del contrato también cuenta", () => {
    arbolBorde({ "src/components/fina.tsx": 'export const F = () => <hr className="carta-linea-fina border-b" />;\n' });
    expect(vistos(correr(borde()))).toEqual([]);
  });

  it("lo que no es un ancho de borde, y una mención en un comentario, es verde", () => {
    arbolBorde({
      "src/components/otros.tsx": [
        "// <div className=\"mt-2 border-t\"> en un comentario",
        'export const G = () => <table className="w-full border-collapse border-dotted border-transparent rounded-full">x</table>;',
        "",
      ].join("\n"),
    });
    expect(vistos(correr(borde()))).toEqual([]);
  });

  it("la definición suelta (un color escrito en un style o en una clase) es definicion-duplicada", () => {
    arbolBorde({
      "src/components/def.tsx": 'export const H = () => (\n  <li style={{ borderColor: "var(--carta-border)" }} className="carta-borde border-b border-[#e7e5e4]">x</li>\n);\n',
    });
    expect(vistos(correr(borde()))).toEqual([
      ["definicion-duplicada", "src/components/def.tsx", 2, 16],
      ["definicion-duplicada", "src/components/def.tsx", 2, 86],
    ]);
  });

  it("una cadena exceptuada por su texto exacto pasa; la excepción se revisa en las dos direcciones", () => {
    const cadena = "min-w-3 border-b-[1.5px] border-dotted";
    arbolBorde({ "src/components/punt.tsx": `export const P = () => <i className="${cadena}" />;\n` });
    const sinExcepcion = exc({ archivo: "src/components/punt.tsx", fragmento: cadena });
    expect(vistos(correr(borde()))).toEqual([]);
    expect(vistos(correr(borde({ excepciones: [sinExcepcion] })))).toEqual([["excepcion-sobrante", "src/components/punt.tsx", 1, 1]]);
    arbolBorde({ "src/components/punt.tsx": `export const P = () => <i className="min-w-3 border-b border-dotted" />;\n` });
    expect(vistos(correr(borde({ excepciones: [{ ...sinExcepcion, fragmento: "min-w-3 border-b border-dotted" }] })))).toEqual([]);
  });

  it("la clase compañera sin ningún borde que la necesite es una declaración sin uso", () => {
    arbolBorde({ "src/components/sobra.tsx": 'export const S = () => <div className="p-2 carta-borde">x</div>;\n' });
    expect(vistos(correr(borde()))).toEqual([["declaracion-sin-uso", "src/components/sobra.tsx", 1, 44]]);
  });

  it("en CSS: la regla con un borde de ancho sin la clase en su selector da rojo (también dentro de @media); con la clase, verde", () => {
    arbolBorde({
      "src/components/t.css": '.tarjeta {\n  border: 1px solid red;\n}\n@media (min-width: 40rem) {\n  .otra {\n    border-top: 2px solid;\n  }\n}\n.buena.carta-borde {\n  border: 1px solid;\n  content: "}";\n}\n',
    });
    expect(vistos(correr(borde()))).toEqual([
      ["uso-sin-declarar", "src/components/t.css", 2, 3],
      ["uso-sin-declarar", "src/components/t.css", 6, 5],
    ]);
  });

  it("una fuente CSS sin el selector ancla, o sin la clase compañera, da fuente-ausente", () => {
    arbolBorde();
    expect(vistos(correr(borde({ fuente: { archivo: "src/app/globals.css", ancla: ".carta-shell .carta-nada" } })))).toEqual([["fuente-ausente", "src/app/globals.css", 1, 1]]);
    const sinClase = correr(borde({ declaracion: { tipo: "clase-companera", clase: "carta-nada", equivalentes: [] } })).hallazgos.filter((h) => h.tipo === "fuente-ausente");
    expect(sinClase.map((h) => [h.archivo, h.linea, h.columna])).toEqual([["src/app/globals.css", 1, 1]]);
    expect(sinClase[0].que).toContain("`.carta-nada`");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Contrato de nombres: «variables de la carta» (el nombre usado tiene que estar definido en la fuente)
// ---------------------------------------------------------------------------------------------------------------------------------

function variables(extra: Partial<Contrato> = {}): Contrato {
  return {
    id: "variables-de-carta",
    porQue: "una variable mal escrita cae en silencio al valor heredado",
    fuente: { archivo: "src/app/tema.css", ancla: ":root" },
    alcance: { raices: ["src/components"], extensiones: [".css"] },
    senales: [{ adaptador: "css", tipo: "variable", nombre: /^--carta-/, que: "lee una variable de la carta" }],
    declaracion: { tipo: "nombre-definido-en-la-fuente" },
    definicion: [{ adaptador: "css", tipo: "define-variable", nombre: /^--carta-/, que: "define una variable de la carta" }],
    consumidores: "descubiertos",
    casosLegitimos: [],
    excepciones: [],
    deuda: [],
    ...extra,
  };
}

const TEMA = "/* @contrato variables-de-carta */\n:root {\n  --carta-tinta: #111;\n  --carta-papel: #fff;\n}\n";

describe("motor: contrato de nombres (nombre definido en la fuente)", () => {
  it("usar solo nombres que la fuente define, y todos los que define, es verde", () => {
    escribir({ "src/app/tema.css": TEMA, "src/components/uso.css": ".a {\n  color: var(--carta-tinta);\n  background: var(--carta-papel, white);\n}\n" });
    expect(vistos(correr(variables()))).toEqual([]);
  });

  it("un nombre que la fuente no define da rojo, en el nombre", () => {
    escribir({ "src/app/tema.css": TEMA, "src/components/uso.css": ".a {\n  color: var(--carta-tinta);\n  background: var(--carta-papel);\n  border-color: var(--carta-fondo);\n}\n" });
    expect(vistos(correr(variables()))).toEqual([["uso-sin-declarar", "src/components/uso.css", 4, 21]]);
  });

  it("un nombre definido en la fuente que nadie usa es una declaración sin uso, en la fuente", () => {
    escribir({ "src/app/tema.css": TEMA, "src/components/uso.css": ".a {\n  color: var(--carta-tinta);\n}\n" });
    expect(vistos(correr(variables()))).toEqual([["declaracion-sin-uso", "src/app/tema.css", 4, 3]]);
  });

  it("redefinir un nombre fuera de la fuente es definicion-duplicada", () => {
    escribir({ "src/app/tema.css": TEMA, "src/components/uso.css": ".a {\n  --carta-tinta: red;\n  color: var(--carta-tinta);\n  background: var(--carta-papel);\n}\n" });
    expect(vistos(correr(variables()))).toEqual([["definicion-duplicada", "src/components/uso.css", 2, 3]]);
  });

  it("la fuente en TS: los nombres son los `--x` escritos en su código", () => {
    escribir({
      "src/app/tema.ts": "// @contrato variables-de-carta\nexport const tema = { '--carta-tinta': '#111' };\n",
      "src/components/uso.css": ".a {\n  color: var(--carta-tinta);\n  fill: var(--carta-otra);\n}\n",
    });
    expect(vistos(correr(variables({ fuente: { archivo: "src/app/tema.ts", ancla: "tema" } })))).toEqual([["uso-sin-declarar", "src/components/uso.css", 3, 13]]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// El reporte, el orden y el manifiesto mal armado
// ---------------------------------------------------------------------------------------------------------------------------------

describe("motor: reporte determinista y manifiesto mal armado", () => {
  it("cada hallazgo es una línea archivo:línea:columna [contrato · tipo], el qué-falta → cómo-corregirlo y el fragmento", () => {
    arbolDinero({ "src/malo.ts": USO_MALO });
    const r = correr(dinero());
    expect(formatearHallazgo(r.hallazgos[0])).toBe(
      [
        "src/malo.ts:2:10  [redondeo-de-dinero · uso-sin-declarar]",
        "  redondea a centavos con Math.round sin declarar el contrato → importá `redondearMoneda` de «src/core/moneda.ts»",
        "  fuente: src/core/moneda.ts:2 · fragmento (para excepción o deuda): «Math.round(n * 100) / 100»",
      ].join("\n")
    );
    expect(formatearReporte(r).split("\n").at(-1)).toBe("1 contratos · 3 archivos leídos · deuda declarada: 0 usos · excepciones: 0 · casos legítimos: 0");
  });

  it("los hallazgos salen ordenados por archivo, línea y columna, y dos corridas dan lo mismo", () => {
    arbolDinero({ "src/z.ts": USO_MALO, "src/b.ts": `${USO_MALO}export const k = Math.round(1 * 100) / 100;\n`, "src/a.ts": USO_MALO });
    const primera = vistos(correr(dinero()));
    expect(primera).toEqual([
      ["uso-sin-declarar", "src/a.ts", 2, 10],
      ["uso-sin-declarar", "src/b.ts", 2, 10],
      ["uso-sin-declarar", "src/b.ts", 4, 18],
      ["uso-sin-declarar", "src/z.ts", 2, 10],
    ]);
    expect(vistos(correr(dinero()))).toEqual(primera);
  });

  it("dos contratos sobre el mismo árbol conviven: cada archivo se lee una vez", () => {
    arbolDinero({ "src/app/globals.css": GLOBALS, "src/components/ok.tsx": TSX_OK });
    const r = correr(dinero(), borde());
    expect(vistos(r)).toEqual([]);
    expect(r.resumen.archivosLeidos).toBe(4);
  });

  it("un manifiesto mal armado lanza: id repetido o no kebab-case, declaración incompatible con las señales, sin señales, lista repetida", () => {
    arbolDinero();
    expect(() => correr(dinero(), dinero())).toThrow(/id repetido/);
    expect(() => correr(dinero({ id: "NoKebab" }))).toThrow(/kebab-case/);
    expect(() => correr(dinero({ senales: [] }))).toThrow(/sin `senales`/);
    expect(() => correr(dinero({ declaracion: { tipo: "clase-companera", clase: "x", equivalentes: [] } }))).toThrow(/clase-companera/);
    expect(() => correr(dinero({ senales: [{ adaptador: "clases", token: /^x$/, que: "x" }] }))).toThrow(/importar-ancla/);
    expect(() => correr(dinero({ consumidores: ["src/ok.ts", "src/ok.ts"] }))).toThrow(/repite/);
    expect(() => correr(dinero({ porQue: "corto" }))).toThrow(/porQue/);
  });
});

describe("adaptador de CSS: el lector de reglas", () => {
  it("separa selectores y declaraciones con anidación, cadenas, url() y última declaración sin punto y coma", () => {
    const css = '@import "x.css";\n@theme static {\n  --color-a: red;\n}\n.a, .b > .c { color: red; content: "};{"; background: url(data:image/png;base64,AA) }\n@media (min-width: 1px) { .d { margin: 0 } }\n.e { @apply p-2; top: 0; }\n';
    const reglas = leerReglas(css);
    expect(reglas.map((r) => [r.selector, r.declaraciones.map((d) => d.propiedad)])).toEqual([
      ["@theme static", ["--color-a"]],
      [".a, .b > .c", ["color", "content", "background"]],
      ["@media (min-width: 1px)", []],
      [".d", ["margin"]],
      [".e", ["top"]],
    ]);
    // CSS anidado: lo que viene después de una regla hija sigue siendo del padre.
    expect(leerReglas(".n { color: blue; &:hover { color: red } margin: 0 }").map((r) => [r.selector, r.declaraciones.map((d) => d.propiedad)])).toEqual([
      [".n", ["color", "margin"]],
      ["&:hover", ["color"]],
    ]);
    expect(reglas[1].declaraciones[2].valor).toBe("url(data:image/png;base64,AA)");
    expect(css.slice(reglas[0].declaraciones[0].desde, reglas[0].declaraciones[0].desde + 9)).toBe("--color-a");
  });
});

describe("adaptador de clases: las variantes", () => {
  it("quita variantes, variantes arbitrarias con ':' adentro y el '!' de importante, delante o detrás", () => {
    expect(sinVariantes("border-t")).toBe("border-t");
    expect(sinVariantes("sm:hover:border-t")).toBe("border-t");
    expect(sinVariantes("[&:hover]:border-t")).toBe("border-t");
    expect(sinVariantes("data-[x=a:b]:p-1")).toBe("p-1");
    expect(sinVariantes("!border-t!")).toBe("border-t");
    expect(sinVariantes("bg-[color:var(--x)]")).toBe("bg-[color:var(--x)]");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Gobierno de excepciones y deuda: responsable, aprobación, vencimiento, renovaciones y tope. Los bordes se prueban con LITERALES (hoy = 2026-10-21, creadas el mismo día),
// nunca con las constantes de `politica.ts`.
// ---------------------------------------------------------------------------------------------------------------------------------

describe("motor: gobierno de excepciones y deuda (bordes con literales)", () => {
  const USO = "Math.round(n * 100) / 100";
  const conExcepcion = (e: Partial<Excepcion>, hoy = HOY): Resultado => correrCon(hoy, dinero({ excepciones: [exc({ archivo: "src/malo.ts", fragmento: USO, ...e })] }));
  const conDeuda = (d: Partial<Deuda>, hoy = HOY): Resultado => correrCon(hoy, dinero({ deuda: [deu({ archivo: "src/malo.ts", fragmento: USO, ...d })] }));
  const tipos = (r: Resultado): TipoDeHallazgo[] => r.hallazgos.map((h) => h.tipo);
  const aprobada = { por: "dueño", referencia: "PR #13" };

  beforeEach(() => arbolDinero({ "src/malo.ts": USO_MALO }));

  it("motivo de 19 caracteres: rojo; de 20: verde (excepción y deuda)", () => {
    const m19 = "abcdefghijklmnopqrs";
    const m20 = "abcdefghijklmnopqrst";
    expect([m19.length, m20.length]).toEqual([19, 20]);
    expect(tipos(conExcepcion({ motivo: m19 }))).toEqual(["excepcion-sin-motivo"]);
    expect(tipos(conExcepcion({ motivo: m20 }))).toEqual([]);
    expect(tipos(conDeuda({ motivo: m19 }))).toEqual(["deuda-sin-motivo"]);
    expect(tipos(conDeuda({ motivo: m20 }))).toEqual([]);
  });

  it("vence ayer: vencida; vence hoy: vigente (rige hasta el final de su día) y con aviso", () => {
    const ayer = conExcepcion({ vence: "2026-10-20" });
    expect(vistos(ayer)).toEqual([["excepcion-vencida", "src/malo.ts", 1, 1]]);
    expect(ayer.hallazgos[0].que).toContain("venció el 2026-10-20");
    expect(tipos(conDeuda({ vence: "2026-10-20" }))).toEqual(["deuda-vencida"]);
    const hoy = conExcepcion({ vence: "2026-10-21" });
    expect(tipos(hoy)).toEqual([]);
    expect(hoy.avisos).toEqual([{ contrato: "redondeo-de-dinero", clase: "excepcion", archivo: "src/malo.ts", fragmento: USO, tipo: "vence-pronto", vence: "2026-10-21", dias: 0 }]);
    expect(tipos(conDeuda({ vence: "2026-10-21" }))).toEqual([]);
  });

  it("el mismo vencimiento cambia con el `hoy` inyectado, no con el reloj", () => {
    expect(tipos(conExcepcion({ vence: "2026-12-19" }, "2026-12-19"))).toEqual([]);
    expect(tipos(conExcepcion({ vence: "2026-12-19" }, "2026-12-20"))).toEqual(["excepcion-vencida"]);
  });

  it("tope de una excepción desde su creación: 59 y 60 días pasan; 61, horizonte-excedido (el mismo tope que la deuda)", () => {
    expect(tipos(conExcepcion({ vence: "2026-12-19" }))).toEqual([]);
    expect(tipos(conExcepcion({ vence: "2026-12-20" }))).toEqual([]);
    expect(vistos(conExcepcion({ vence: "2026-12-21" }))).toEqual([["horizonte-excedido", "src/malo.ts", 1, 1]]);
    // Lo que antes era el tope de una excepción (365 y 366 días) ya no pasa.
    expect(tipos(conExcepcion({ vence: "2027-10-21" }))).toEqual(["horizonte-excedido"]);
    expect(tipos(conExcepcion({ vence: "2027-10-22" }))).toEqual(["horizonte-excedido"]);
  });

  it("tope de una deuda desde su creación: 59 y 60 días pasan; 61, horizonte-excedido", () => {
    expect(tipos(conDeuda({ vence: "2026-12-19" }))).toEqual([]);
    expect(tipos(conDeuda({ vence: "2026-12-20" }))).toEqual([]);
    expect(vistos(conDeuda({ vence: "2026-12-21" }))).toEqual([["horizonte-excedido", "src/malo.ts", 1, 1]]);
  });

  it("el plazo se cuenta desde la última renovación: 59/60 días pasan, 61 no; renovar con justificación corre el plazo", () => {
    const renovada = (vence: string) => ({ creada: "2026-06-01", renovaciones: [{ fecha: "2026-10-01", motivo: MOTIVO, aprobacion: aprobada }], vence });
    expect(tipos(conDeuda(renovada("2026-11-29")))).toEqual([]);
    expect(tipos(conDeuda(renovada("2026-11-30")))).toEqual([]);
    expect(tipos(conDeuda(renovada("2026-12-01")))).toEqual(["horizonte-excedido"]);
    // Sin la renovación, el mismo vencimiento (desde la creación del 1 de junio) está muy lejos del tope.
    expect(tipos(conDeuda({ creada: "2026-06-01", vence: "2026-11-30" }))).toEqual(["horizonte-excedido"]);
    // La última es la de fecha más nueva, aunque no esté al final de la lista.
    const dos = [
      { fecha: "2026-10-01", motivo: MOTIVO, aprobacion: aprobada },
      { fecha: "2026-08-01", motivo: MOTIVO, aprobacion: aprobada },
    ];
    expect(tipos(conDeuda({ creada: "2026-06-01", renovaciones: dos, vence: "2026-11-30" }))).toEqual([]);
    expect(tipos(conDeuda({ creada: "2026-06-01", renovaciones: dos, vence: "2026-12-01" }))).toEqual(["horizonte-excedido"]);
    // Excepción: 59 y 60 días desde la renovación pasan; 61, no.
    const renovadaExc = (vence: string) => ({ creada: "2026-01-01", renovaciones: [{ fecha: "2026-10-01", motivo: MOTIVO, aprobacion: aprobada }], vence });
    expect(tipos(conExcepcion(renovadaExc("2026-11-29")))).toEqual([]);
    expect(tipos(conExcepcion(renovadaExc("2026-11-30")))).toEqual([]);
    expect(tipos(conExcepcion(renovadaExc("2026-12-01")))).toEqual(["horizonte-excedido"]);
  });

  it("una renovación sin motivo, o con un motivo de 19 caracteres, da rojo; con 20, verde", () => {
    const renovar = (motivo: string) => ({ renovaciones: [{ fecha: "2026-10-21", motivo, aprobacion: aprobada }] });
    expect(vistos(conDeuda(renovar("")))).toEqual([["deuda-sin-motivo", "src/malo.ts", 1, 1]]);
    expect(tipos(conDeuda(renovar("abcdefghijklmnopqrs")))).toEqual(["deuda-sin-motivo"]);
    expect(tipos(conDeuda(renovar("abcdefghijklmnopqrst")))).toEqual([]);
    expect(tipos(conExcepcion(renovar("abcdefghijklmnopqrs")))).toEqual(["excepcion-sin-motivo"]);
    expect(tipos(conExcepcion(renovar("abcdefghijklmnopqrst")))).toEqual([]);
    expect(conDeuda(renovar("corto")).hallazgos[0].que).toContain("la renovación del 2026-10-21");
  });

  it("una renovación sin aprobación válida da rojo", () => {
    const renovar = (aprobacion: { por: string; referencia: string }) => ({ renovaciones: [{ fecha: "2026-10-21", motivo: MOTIVO, aprobacion }] });
    expect(vistos(conDeuda(renovar({ por: "dueño", referencia: "PR 13" })))).toEqual([["excepcion-sin-aprobacion", "src/malo.ts", 1, 1]]);
    expect(tipos(conDeuda(renovar({ por: "", referencia: "PR #13" })))).toEqual(["excepcion-sin-aprobacion"]);
    expect(tipos(conExcepcion(renovar({ por: "dueño", referencia: "" })))).toEqual(["excepcion-sin-aprobacion"]);
    expect(tipos(conDeuda(renovar({ por: "dueño", referencia: "DEC-07" })))).toEqual([]);
  });

  it("un inicio posterior a hoy (creada o renovada en el futuro) no regala plazo: horizonte-excedido", () => {
    expect(tipos(conDeuda({ creada: "2026-10-22", vence: "2026-12-19" }))).toEqual(["horizonte-excedido"]);
    expect(tipos(conDeuda({ renovaciones: [{ fecha: "2026-10-22", motivo: MOTIVO, aprobacion: aprobada }], vence: "2026-12-19" }))).toEqual(["horizonte-excedido"]);
    expect(tipos(conDeuda({ creada: "2026-10-21", vence: "2026-12-19" }))).toEqual([]);
  });

  it("más de 2 renovaciones de una misma deuda avisan sin fallar; 2 no", () => {
    const una = (fecha: string) => ({ fecha, motivo: MOTIVO, aprobacion: aprobada });
    const dos = conDeuda({ creada: "2026-08-01", renovaciones: [una("2026-09-01"), una("2026-10-01")], vence: "2026-11-30" });
    expect(tipos(dos)).toEqual([]);
    expect(dos.avisos).toEqual([]);
    const tres = conDeuda({ creada: "2026-07-01", renovaciones: [una("2026-08-01"), una("2026-09-01"), una("2026-10-01")], vence: "2026-11-30" });
    expect(tipos(tres)).toEqual([]);
    expect(tres.avisos).toEqual([{ contrato: "redondeo-de-dinero", clase: "deuda", archivo: "src/malo.ts", fragmento: USO, tipo: "muchas-renovaciones", renovaciones: 3 }]);
    expect(formatearReporte(tres)).toContain("aviso: [redondeo-de-dinero] la deuda de «Math.round(n * 100) / 100» en src/malo.ts ya se renovó 3 veces");
  });

  it("aviso (sin fallar) si vence en 14 días o menos: 14 avisa, 15 no; el reporte lo muestra", () => {
    const catorce = conExcepcion({ vence: "2026-11-04" });
    expect(tipos(catorce)).toEqual([]);
    expect(catorce.avisos.map((a) => (a.tipo === "vence-pronto" ? a.dias : -1))).toEqual([14]);
    expect(formatearAviso(catorce.avisos[0])).toBe("aviso: [redondeo-de-dinero] la excepción de «Math.round(n * 100) / 100» en src/malo.ts vence en 14 días (2026-11-04)");
    expect(formatearReporte(catorce)).toContain("aviso: [redondeo-de-dinero]");
    expect(conExcepcion({ vence: "2026-11-05" }).avisos).toEqual([]);
    expect(conDeuda({ vence: "2026-11-04" }).avisos.map((a) => [a.clase, a.tipo])).toEqual([["deuda", "vence-pronto"]]);
  });

  it("un responsable que no es de la lista cerrada da excepcion-sin-responsable (también en la deuda)", () => {
    const otro = "cualquiera" as unknown as Excepcion["responsable"];
    expect(vistos(conExcepcion({ responsable: otro }))).toEqual([["excepcion-sin-responsable", "src/malo.ts", 1, 1]]);
    expect(tipos(conDeuda({ responsable: otro }))).toEqual(["excepcion-sin-responsable"]);
    expect(tipos(conExcepcion({ responsable: "dueño" }))).toEqual([]);
  });

  it("la referencia de la aprobación se valida por forma: PR #n, commit <sha> o DEC-nn", () => {
    for (const bien of ["PR #1", "PR #1234", "commit 1f8d2c5c", "commit 1f8d2c5", "commit 86283b7d1f8d2c5c86283b7d1f8d2c5c86283b7d", "DEC-01", "DEC-123"]) {
      expect(tipos(conExcepcion({ aprobacion: { por: "dueño", referencia: bien } })), bien).toEqual([]);
    }
    for (const mal of ["", "PR 12", "PR #", "PR #12a", "pr #12", "#12", "commit 1f8d2c", "commit 1F8D2C5C", "commit 1f8d2c5g", "commit 86283b7d1f8d2c5c86283b7d1f8d2c5c86283b7d1", "DEC-1", "DEC-", "dec-01", "https://x/pull/1"]) {
      expect(vistos(conExcepcion({ aprobacion: { por: "dueño", referencia: mal } })), mal).toEqual([["excepcion-sin-aprobacion", "src/malo.ts", 1, 1]]);
    }
    expect(tipos(conDeuda({ aprobacion: { por: "dueño", referencia: "PR 12" } }))).toEqual(["excepcion-sin-aprobacion"]);
  });

  it("una aprobación sin quién la dio es excepcion-sin-aprobacion", () => {
    expect(tipos(conExcepcion({ aprobacion: { por: "  ", referencia: "PR #12" } }))).toEqual(["excepcion-sin-aprobacion"]);
  });

  it("varios problemas de gobierno en la misma entrada se informan todos", () => {
    const r = conExcepcion({ motivo: "corto", responsable: "x" as unknown as Excepcion["responsable"], aprobacion: { por: "dueño", referencia: "nada" }, vence: "2026-10-20" });
    expect(tipos(r).sort()).toEqual(["excepcion-sin-aprobacion", "excepcion-sin-motivo", "excepcion-sin-responsable", "excepcion-vencida"]);
  });

  it("una fecha (vence, creada o de una renovación) que no es AAAA-MM-DD válida es un manifiesto mal armado (lanza)", () => {
    expect(() => conExcepcion({ vence: "2026-02-30" })).toThrow(/AAAA-MM-DD/);
    expect(() => conDeuda({ vence: "21/10/2026" })).toThrow(/AAAA-MM-DD/);
    expect(() => conDeuda({ vence: "" })).toThrow(/AAAA-MM-DD/);
    expect(() => conDeuda({ creada: "ayer" })).toThrow(/creada/);
    expect(() => conDeuda({ renovaciones: [{ fecha: "2026-13-01", motivo: MOTIVO, aprobacion: aprobada }] })).toThrow(/renovación/);
  });
});

describe("evaluarVencimientos: función pura con `hoy` inyectado", () => {
  const e = (clase: "excepcion" | "deuda", vence: string, inicio = "2026-10-21") => ({ clase, archivo: "a.ts", fragmento: "f", inicio, vence });

  it("clasifica vencidas, excedidas y por vencer con literales", () => {
    const r = evaluarVencimientos(
      [e("excepcion", "2026-10-20"), e("excepcion", "2026-10-21"), e("excepcion", "2026-12-20"), e("excepcion", "2026-12-21"), e("deuda", "2026-12-20"), e("deuda", "2026-12-21"), e("deuda", "2026-11-04"), e("deuda", "2026-11-05")],
      "2026-10-21"
    );
    expect(r.vencidas.map((x) => x.vence)).toEqual(["2026-10-20"]);
    expect(r.excedidas.map((x) => [x.clase, x.vence, x.tope])).toEqual([
      ["excepcion", "2026-12-21", 60],
      ["deuda", "2026-12-21", 60],
    ]);
    expect(r.porVencer.map((x) => [x.vence, x.dias])).toEqual([
      ["2026-10-21", 0],
      ["2026-11-04", 14],
    ]);
  });

  it("cruza el fin de año y los años bisiestos por el calendario, no por un mes de largo fijo", () => {
    expect(evaluarVencimientos([e("deuda", "2028-02-29", "2028-02-29")], "2028-02-29").porVencer.map((x) => x.dias)).toEqual([0]);
    // 60 días desde el 1 de enero: en un año bisiesto (febrero de 29 días) son hasta el 1 de marzo; en uno común, hasta el 2 de marzo.
    expect(evaluarVencimientos([e("excepcion", "2028-03-01", "2028-01-01")], "2028-01-01").excedidas).toEqual([]);
    expect(evaluarVencimientos([e("excepcion", "2028-03-02", "2028-01-01")], "2028-01-01").excedidas).toHaveLength(1);
    expect(evaluarVencimientos([e("deuda", "2027-03-02", "2027-01-01")], "2027-01-01").excedidas).toEqual([]);
    expect(evaluarVencimientos([e("deuda", "2027-03-03", "2027-01-01")], "2027-01-01").excedidas).toHaveLength(1);
    expect(evaluarVencimientos([e("deuda", "2027-01-01", "2026-12-31")], "2026-12-31").porVencer.map((x) => x.dias)).toEqual([1]);
  });

  it("el reloj real es la fecha UTC y no se puede torcer con variables de entorno", () => {
    expect(fechaUtcDeHoy()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fechaUtcDeHoy()).toBe(new Date().toISOString().slice(0, 10));
    expect(readFileSync(join(__dirname, "politica.ts"), "utf8")).not.toContain("process.env");
    expect(readFileSync(join(__dirname, "motor.ts"), "utf8")).not.toContain("process.env");
  });
});
