import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FORMAS_DE_SALIR, MAXIMO_DE_COLUMNAS_DE_TABLA, formaDeSalir, type MiembroParaLaForma } from "@/core/carta/public";
import {
  CELDAS_DEL_CASO_BASE,
  ORACULO_DE_FORMA_DE_SALIR,
  type CantidadDeMedidasDelOraculo,
  type FilaDelOraculo,
  type MedidasDelOraculo,
  type MiembroDelOraculo,
  type PreciosDelOraculo,
} from "./familias-forma-de-salir-oraculo";

/**
 * Etapa F1, nivel 10: recorre TODAS las filas del oráculo (`familias-forma-de-salir-oraculo.ts`, escrito aparte del código) contra la función pura `formaDeSalir`, con CADA permutación de los productos (la forma no puede depender del orden en que
 * llegan de la base); recorre EXHAUSTIVAMENTE las combinaciones de las dimensiones contra la tabla de celdas del oráculo; verifica con `fast-check` que el resultado no depende del orden; y el GUARDIÁN de dimensiones: falla si aparece un dato nuevo
 * en la entrada de la función o una columna nueva en los modelos de la familia sin declarar si afecta la forma o no.
 */

function permutaciones<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]];
  return xs.flatMap((x, i) => permutaciones([...xs.slice(0, i), ...xs.slice(i + 1)]).map((resto) => [x, ...resto]));
}

/** Del miembro del oráculo (legible) al de la función (con todos los datos explícitos). */
const aMiembro = (m: MiembroDelOraculo): MiembroParaLaForma => ({
  precio: m.precio,
  oculto: m.oculto === true,
  desactivado: m.desactivado === true,
  seccionCartaId: m.seccion ?? "s1",
  medidas: m.medidas ?? [],
});

describe("F1: el oráculo de la «forma de salir» de una familia", () => {
  it("el oráculo cubre cada forma, cada caso de la maqueta de Pedernal (7) y la fila D7, y las filas tienen id único", () => {
    expect(ORACULO_DE_FORMA_DE_SALIR.length).toBeGreaterThanOrEqual(8);
    expect(new Set(ORACULO_DE_FORMA_DE_SALIR.map((f) => f.id)).size).toBe(ORACULO_DE_FORMA_DE_SALIR.length);
    for (const forma of FORMAS_DE_SALIR) expect(ORACULO_DE_FORMA_DE_SALIR.some((f) => f.esperado === forma), `forma ${forma}`).toBe(true);
    for (const id of ["F1", "F3", "F4", "F5", "F6", "F7", "F8", "F13", "F15"]) expect(ORACULO_DE_FORMA_DE_SALIR.some((f) => f.id === id), id).toBe(true);
  });

  for (const fila of ORACULO_DE_FORMA_DE_SALIR) {
    it(`${fila.id}: ${fila.regla} (todas las permutaciones de los productos)`, () => {
      for (const miembros of permutaciones(fila.miembros)) {
        const forma = formaDeSalir({ agruparEnCarta: fila.agruparEnCarta, activa: fila.activa ?? true, miembros: miembros.map(aMiembro) });
        expect(forma, `con los productos en este orden: ${JSON.stringify(miembros.map((m) => m.precio))}`).toBe(fila.esperado);
      }
    });
  }

  it("el tope de columnas de la tabla es 3 (el oráculo lo da por sabido: F1 con 3 medidas es TABLA y F3 con 4 es LISTA)", () => {
    expect(MAXIMO_DE_COLUMNAS_DE_TABLA).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// COMBINACIONES (exhaustivo: son pocas)
// ---------------------------------------------------------------------------------------------------------------------

type EstadoDeMiembroDeMas = "NINGUNO" | "OCULTO" | "DESACTIVADO" | "SIN_PRECIO";
interface Dimensiones {
  agruparEnCarta: boolean;
  activa: boolean;
  aLaVista: 0 | 1 | 2 | 3;
  medidas: MedidasDelOraculo;
  precios: PreciosDelOraculo;
  cantidad: CantidadDeMedidasDelOraculo;
  mismaSeccion: boolean;
  miembroDeMas: EstadoDeMiembroDeMas;
}

const MEDIDAS: readonly MedidasDelOraculo[] = ["NINGUNA", "LAS_MISMAS", "DISTINTAS_CON_ALGUNA_EN_COMUN", "NINGUNA_EN_COMUN", "ALGUNO_SIN_MEDIDAS"];
const PRECIOS: readonly PreciosDelOraculo[] = ["IGUALES", "DISTINTOS"];
const CANTIDADES: readonly CantidadDeMedidasDelOraculo[] = ["HASTA_3", "MAS_DE_3"];
const DE_MAS: readonly EstadoDeMiembroDeMas[] = ["NINGUNO", "OCULTO", "DESACTIVADO", "SIN_PRECIO"];

/** Las medidas del miembro `i` de `k` según la dimensión (con `cantidad` de medidas distintas en total cuando tiene sentido). */
function medidasDelMiembro(medidas: MedidasDelOraculo, cantidad: CantidadDeMedidasDelOraculo, i: number): readonly string[] {
  switch (medidas) {
    case "NINGUNA":
      return [];
    case "LAS_MISMAS":
      return cantidad === "HASTA_3" ? ["A", "B"] : ["A", "B", "C", "D"];
    case "DISTINTAS_CON_ALGUNA_EN_COMUN":
      return cantidad === "HASTA_3" ? (i % 2 === 0 ? ["A", "B"] : ["A"]) : i === 0 ? ["A", "B", "C", "D"] : ["A"];
    case "NINGUNA_EN_COMUN":
      return [`unica${i}`];
    case "ALGUNO_SIN_MEDIDAS":
      return i === 0 ? [] : ["A", "B"];
  }
}

function entradaDe(d: Dimensiones) {
  const miembros: MiembroParaLaForma[] = Array.from({ length: d.aLaVista }, (_, i) => ({
    precio: d.precios === "IGUALES" ? 2500 : 2500 + 100 * i,
    oculto: false,
    desactivado: false,
    seccionCartaId: d.mismaSeccion ? "s1" : `s${i}`,
    medidas: medidasDelMiembro(d.medidas, d.cantidad, i),
  }));
  // Un miembro de más que NO tiene que contar: con todo lo que cambiaría la forma si contara (otro precio, otra sección, otra medida).
  if (d.miembroDeMas !== "NINGUNO") {
    miembros.push({ precio: d.miembroDeMas === "SIN_PRECIO" ? null : 7777, oculto: d.miembroDeMas === "OCULTO", desactivado: d.miembroDeMas === "DESACTIVADO", seccionCartaId: "otra", medidas: ["Z"] });
  }
  return { agruparEnCarta: d.agruparEnCarta, activa: d.activa, miembros };
}

/** Lo que dice el oráculo para una combinación: la celda del caso base, o SUELTOS si cualquier otra dimensión se aparta del caso base. */
function esperadoDe(d: Dimensiones) {
  const casoBase = d.agruparEnCarta && d.activa && d.aLaVista >= 2 && d.mismaSeccion;
  return casoBase ? CELDAS_DEL_CASO_BASE[`${d.medidas}|${d.precios}|${d.cantidad}`] : "SUELTOS";
}

describe("F1: combinaciones de las dimensiones de la forma de salir (exhaustivo)", () => {
  const combinaciones: Dimensiones[] = [];
  for (const agruparEnCarta of [true, false])
    for (const activa of [true, false])
      for (const aLaVista of [0, 1, 2, 3] as const)
        for (const medidas of MEDIDAS)
          for (const precios of PRECIOS)
            for (const cantidad of CANTIDADES)
              for (const mismaSeccion of [true, false])
                for (const miembroDeMas of DE_MAS) combinaciones.push({ agruparEnCarta, activa, aLaVista, medidas, precios, cantidad, mismaSeccion, miembroDeMas });

  it("la tabla de celdas del caso base tiene TODAS las celdas (medidas × precios × cantidad) y las formas de la lista cerrada", () => {
    expect(Object.keys(CELDAS_DEL_CASO_BASE)).toHaveLength(MEDIDAS.length * PRECIOS.length * CANTIDADES.length);
    for (const forma of Object.values(CELDAS_DEL_CASO_BASE)) expect(FORMAS_DE_SALIR as readonly string[]).toContain(forma);
  });

  it(`las ${combinaciones.length} combinaciones dan lo que dice la tabla, con los productos en cualquier orden (directo e invertido)`, () => {
    expect(combinaciones.length).toBe(2 * 2 * 4 * 5 * 2 * 2 * 2 * 4);
    const distintas = new Set<string>();
    for (const d of combinaciones) {
      const entrada = entradaDe(d);
      const esperado = esperadoDe(d);
      expect(formaDeSalir(entrada), JSON.stringify(d)).toBe(esperado);
      expect(formaDeSalir({ ...entrada, miembros: [...entrada.miembros].reverse() }), `invertido ${JSON.stringify(d)}`).toBe(esperado);
      distintas.add(esperado);
    }
    expect([...distintas].sort()).toEqual([...FORMAS_DE_SALIR].sort());
  });

  it("PROPIEDAD (fast-check): el resultado no depende del orden en que llegan los productos y siempre es una de las cuatro formas", () => {
    const miembro = fc.record({
      precio: fc.option(fc.constantFrom(0, 1000, 2500, 2600), { nil: null }),
      oculto: fc.boolean(),
      desactivado: fc.boolean(),
      seccionCartaId: fc.constantFrom("s1", "s2"),
      medidas: fc.subarray(["Chico", "Mediano", "Grande", "Familiar", "chico"]),
    });
    fc.assert(
      fc.property(
        fc.array(miembro, { maxLength: 6 }).chain((ms) => fc.tuple(fc.constant(ms), fc.shuffledSubarray(ms, { minLength: ms.length, maxLength: ms.length }))),
        fc.boolean(),
        fc.boolean(),
        ([ms, barajados], agruparEnCarta, activa) => {
          const a = formaDeSalir({ agruparEnCarta, activa, miembros: ms });
          return a === formaDeSalir({ agruparEnCarta, activa, miembros: barajados }) && (FORMAS_DE_SALIR as readonly string[]).includes(a);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("falla CERRADO ante lo que no es exactamente lo permitido: un interruptor que no es `true`, una familia que no es `activa === true` o un miembro con `oculto`/`desactivado` que no es `false` no agrupan", () => {
    const dos = [aMiembro({ precio: 2500 }), aMiembro({ precio: 2500 })];
    expect(formaDeSalir({ agruparEnCarta: true, activa: true, miembros: dos })).toBe("UNA_LINEA");
    expect(formaDeSalir({ agruparEnCarta: "si" as never, activa: true, miembros: dos })).toBe("SUELTOS");
    expect(formaDeSalir({ agruparEnCarta: true, activa: undefined as never, miembros: dos })).toBe("SUELTOS");
    expect(formaDeSalir({ agruparEnCarta: true, activa: true, miembros: [dos[0], { ...dos[1], oculto: undefined as never }] })).toBe("SUELTOS");
    expect(formaDeSalir({ agruparEnCarta: true, activa: true, miembros: [dos[0], { ...dos[1], precio: NaN }] })).toBe("SUELTOS");
    expect(formaDeSalir({ agruparEnCarta: true, activa: true, miembros: [dos[0], { ...dos[1], precio: "2500" as never }] })).toBe("SUELTOS");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// GUARDIÁN DE DIMENSIONES
// ---------------------------------------------------------------------------------------------------------------------

interface Declaracion {
  afecta: boolean;
  motivo: string;
}

const RAIZ = join(__dirname, "../..");
const FUENTE_DE_LA_FORMA = readFileSync(join(RAIZ, "src/core/carta/familias/forma-de-salir.ts"), "utf8");
const SCHEMA = readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8");

/** Los campos de una `interface` de TypeScript (una propiedad por línea, con la sangría de dos espacios). */
function camposDeLaInterfaz(nombre: string): string[] {
  const bloque = new RegExp(`export interface ${nombre} \\{\\r?\\n([\\s\\S]*?)\\r?\\n\\}`, "m").exec(FUENTE_DE_LA_FORMA);
  if (!bloque) throw new Error(`No encontré la interfaz ${nombre}`);
  return bloque[1]
    .split("\n")
    .map((l) => /^ {2}(\w+)\??:/.exec(l)?.[1])
    .filter((c): c is string => c !== undefined);
}

/** Los campos (columnas y relaciones) de un modelo de `schema.prisma`. */
function camposDelModelo(modelo: string): string[] {
  const bloque = new RegExp(`^model ${modelo} \\{\\r?\\n([\\s\\S]*?)\\r?\\n\\}`, "m").exec(SCHEMA);
  if (!bloque) throw new Error(`No encontré el modelo ${modelo} en schema.prisma`);
  return bloque[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("//") && !l.startsWith("@@"))
    .map((l) => l.split(/\s+/)[0]);
}

const ENTRADA: Record<string, Declaracion> = {
  agruparEnCarta: { afecta: true, motivo: "DIMENSIÓN: el interruptor «Agrupar en la carta» (apagado = SUELTOS, F8)." },
  activa: { afecta: true, motivo: "DIMENSIÓN: una familia desactivada no se agrupa (F17)." },
  miembros: { afecta: true, motivo: "los productos de la fila; cada uno con las dimensiones de abajo." },
};
const MIEMBRO: Record<string, Declaracion> = {
  precio: { afecta: true, motivo: "DIMENSIÓN precios (iguales o distintos) y «sin precio» (F5, F11, F12)." },
  oculto: { afecta: true, motivo: "DIMENSIÓN estado del miembro: un oculto queda fuera (F9, F13)." },
  desactivado: { afecta: true, motivo: "DIMENSIÓN estado del miembro: un desactivado queda fuera (F10)." },
  seccionCartaId: { afecta: true, motivo: "DIMENSIÓN secciones: la familia no tiene sección propia, salen sueltos si no están todos en la misma (D7, F15, F16)." },
  medidas: { afecta: true, motivo: "DIMENSIONES medidas y cantidad de medidas: tabla, lista o sueltos (F1 a F3, F6, F7, F18)." },
};
const COLUMNAS: Record<string, Record<string, Declaracion>> = {
  FamiliaDeProducto: {
    id: { afecta: false, motivo: "identidad de la fila (la manda la aplicación: clave del alta)." },
    empresaId: { afecta: false, motivo: "aislamiento por empresa." },
    empresa: { afecta: false, motivo: "relación de empresaId." },
    nombre: { afecta: false, motivo: "el rótulo de la familia (lo muestra la carta, pero no decide su forma)." },
    nombreClave: { afecta: false, motivo: "clave de comparación del nombre (único por empresa)." },
    agruparEnCarta: { afecta: true, motivo: "DIMENSIÓN: «Agrupar en la carta» (F8)." },
    agruparEnPos: { afecta: false, motivo: "«Agrupar en el POS»: se guarda y nada más lo lee todavía (decisión confirmada, fila 231); no cambia la carta." },
    activa: { afecta: true, motivo: "DIMENSIÓN: familia desactivada (F17)." },
    creadoPorId: { afecta: false, motivo: "trazabilidad: quién la creó." },
    version: { afecta: false, motivo: "control de versión del cambio; no cambia cómo sale la carta." },
    creadoEn: { afecta: false, motivo: "trazabilidad." },
    actualizadoEn: { afecta: false, motivo: "trazabilidad." },
    miembros: { afecta: true, motivo: "relación con los miembros (cada uno con las dimensiones de MiembroParaLaForma)." },
  },
  MiembroDeFamilia: {
    id: { afecta: false, motivo: "identidad de la fila." },
    empresaId: { afecta: false, motivo: "aislamiento por empresa." },
    empresa: { afecta: false, motivo: "relación de empresaId." },
    familiaId: { afecta: true, motivo: "a qué familia pertenece el producto." },
    familia: { afecta: false, motivo: "relación de familiaId." },
    productoId: { afecta: true, motivo: "qué producto es el miembro (de él salen precio, estado, sección y medidas)." },
    producto: { afecta: false, motivo: "relación de productoId." },
    posicion: { afecta: false, motivo: "el orden de los miembros dentro de la familia: la forma NO depende del orden (propiedad de arriba); reordenar miembros no existe en F1." },
    agregadoPorId: { afecta: false, motivo: "trazabilidad: quién lo agregó." },
    agregadoEn: { afecta: false, motivo: "trazabilidad." },
    quitadoPorId: { afecta: true, motivo: "junto con quitadoEn: un miembro quitado ya no es miembro vigente y no entra a la fila." },
    quitadoEn: { afecta: true, motivo: "un miembro quitado ya no es miembro vigente y no entra a la fila." },
  },
};

describe("F1: guardián de dimensiones de la forma de salir (un dato o una columna nueva sin declarar rompe este test)", () => {
  it("cada dato de la ENTRADA de la función y de cada MIEMBRO está declarado con su motivo, y no sobra ninguna declaración", () => {
    for (const [interfaz, declaradas] of [["EntradaDeLaForma", ENTRADA], ["MiembroParaLaForma", MIEMBRO]] as const) {
      const reales = camposDeLaInterfaz(interfaz);
      expect(reales.filter((c) => !(c in declaradas)), `${interfaz}: datos nuevos sin declarar si afectan la forma (agregalos acá con su motivo y una fila al oráculo)`).toEqual([]);
      expect(Object.keys(declaradas).filter((c) => !reales.includes(c)), `${interfaz}: declaraciones de datos que ya no existen`).toEqual([]);
      for (const [campo, d] of Object.entries(declaradas)) expect(d.motivo.trim().length, `${interfaz}.${campo}: falta el motivo`).toBeGreaterThanOrEqual(5);
    }
  });

  it("cada columna de los modelos de la familia está declarada con su motivo, y no sobra ninguna declaración", () => {
    for (const [modelo, declaradas] of Object.entries(COLUMNAS)) {
      const reales = camposDelModelo(modelo);
      expect(reales.filter((c) => !(c in declaradas)), `${modelo}: columnas nuevas sin declarar si afectan la forma (agregalas a COLUMNAS con su motivo, y una fila al oráculo si afectan)`).toEqual([]);
      expect(Object.keys(declaradas).filter((c) => !reales.includes(c)), `${modelo}: declaraciones de columnas que ya no existen`).toEqual([]);
      for (const [campo, d] of Object.entries(declaradas)) expect(d.motivo.trim().length, `${modelo}.${campo}: falta el motivo`).toBeGreaterThanOrEqual(5);
    }
  });

  it("cada forma de la lista cerrada aparece en el oráculo, y el oráculo no usa una que la lista no tenga", () => {
    const usadas = new Set(ORACULO_DE_FORMA_DE_SALIR.map((f: FilaDelOraculo) => f.esperado));
    for (const forma of FORMAS_DE_SALIR) expect(usadas.has(forma), `la forma ${forma} no tiene fila en el oráculo`).toBe(true);
    for (const forma of usadas) expect(FORMAS_DE_SALIR as readonly string[]).toContain(forma);
  });
});
