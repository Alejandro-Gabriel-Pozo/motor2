import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CODIGOS_DE_UNIDAD, DIMENSIONES_DE_UNIDAD, MOTIVOS_DE_CONVERSION, UNIDADES_DE_MEDIDA } from "@/core/catalogo/unidades-de-medida";

/**
 * GUARDIÁN DE DIMENSIONES de las unidades de medida (docs/diseno-unidades-de-medida-como-pedernal-2026-11-15.md, U0; regla de
 * combinaciones del 2026-10-28). Falla si aparece una dimensión NUEVA sin declarar si afecta o no, en cuatro lugares:
 *  (a) una unidad nueva en la lista cerrada, o un campo nuevo en la definición de una unidad;
 *  (b) una dimensión (magnitud) nueva;
 *  (c) un motivo de rechazo nuevo;
 *  (d) un valor nuevo del enum `MagnitudUnidad` de Prisma: hay que declarar a qué dimensión de las 14 pasa (o que no pasa a ninguna).
 * Cada declaración lleva su motivo. Una unidad nueva de la lista es además una migración, no una pantalla (diseño I11).
 *
 * LÍMITES (alarma para errores honestos, no un límite de seguridad): (a) y (b) miran las listas del módulo, no los tipos de TypeScript;
 * (d) lee el TEXTO de `prisma/schema.prisma`.
 */
interface Declaracion {
  readonly afecta: boolean;
  readonly motivo: string;
}

const UNIDADES_DECLARADAS: Record<string, Declaracion> = Object.fromEntries(
  ["UNIDAD", "GRAMO", "KILOGRAMO", "TONELADA", "MILILITRO", "LITRO", "METRO_CUBICO", "MILIMETRO", "CENTIMETRO", "METRO", "CENTIMETRO_CUADRADO", "METRO_CUADRADO", "MINUTO", "HORA"].map((c) => [
    c,
    { afecta: true, motivo: "una de las 14 de Pedernal: cambia el resultado de toda conversión (recorrida por test/catalogo/unidades-de-medida-oraculo.ts)." },
  ]),
);

const CAMPOS_DE_DEFINICION: Record<string, Declaracion> = {
  dimension: { afecta: true, motivo: "decide qué parejas se pueden convertir (DIMENSION_DISTINTA)." },
  simbolo: { afecta: false, motivo: "etiqueta corta; no entra en ninguna cuenta." },
  factor: { afecta: true, motivo: "el factor entero a la base: es la cuenta de la conversión." },
};

const DIMENSIONES_DECLARADAS: Record<string, Declaracion> = Object.fromEntries(
  ["CONTEO", "MASA", "VOLUMEN", "LONGITUD", "SUPERFICIE", "TIEMPO"].map((d) => [d, { afecta: true, motivo: "agrupa unidades convertibles entre sí; recorrida por el oráculo." }]),
);

const MOTIVOS_DECLARADOS: Record<string, Declaracion> = Object.fromEntries(
  ["UNIDAD_DESCONOCIDA", "CANTIDAD_INVALIDA", "DIMENSION_DISTINTA", "CONVERSION_NO_EXACTA", "FUERA_DE_RANGO"].map((m) => [m, { afecta: true, motivo: "rechazo cerrado de la conversión; lo fija test/catalogo/unidades-de-medida.test.ts." }]),
);

/** (d) Valores de `MagnitudUnidad` (hoy en Motor2) → dimensión de las 14 a la que pasan en U1b (o `null`: no pasan a ninguna). */
const MAGNITUDES_DE_PRISMA: Record<string, Declaracion & { readonly dimension: string | null }> = {
  PESO: { afecta: true, dimension: "MASA", motivo: "diseño §6.2: PESO → MASA (kg, g)." },
  VOLUMEN: { afecta: true, dimension: "VOLUMEN", motivo: "diseño §6.2: VOLUMEN → VOLUMEN (l, ml)." },
  CANTIDAD: { afecta: true, dimension: "CONTEO", motivo: "diseño §6.2: CANTIDAD → CONTEO (unidad; «caja», «pack» → UNIDAD por decisión del dueño, Q-U2)." },
};

function ordenados(x: Iterable<string>): string[] {
  return [...x].sort();
}

describe("guardián de dimensiones de las unidades de medida", () => {
  it("(a) toda unidad de la lista cerrada está declarada, con motivo, y no sobra ninguna declaración", () => {
    expect(ordenados(CODIGOS_DE_UNIDAD), "una unidad nueva sin declarar, o una declarada que ya no existe").toEqual(ordenados(Object.keys(UNIDADES_DECLARADAS)));
    for (const [c, d] of Object.entries(UNIDADES_DECLARADAS)) expect(d.motivo.length, c).toBeGreaterThan(10);
  });

  it("(a) todo campo de la definición de una unidad está declarado", () => {
    for (const c of CODIGOS_DE_UNIDAD) expect(ordenados(Object.keys(UNIDADES_DE_MEDIDA[c])), c).toEqual(ordenados(Object.keys(CAMPOS_DE_DEFINICION)));
  });

  it("(b) toda dimensión está declarada y las unidades solo usan dimensiones declaradas", () => {
    expect(ordenados(DIMENSIONES_DE_UNIDAD)).toEqual(ordenados(Object.keys(DIMENSIONES_DECLARADAS)));
    for (const c of CODIGOS_DE_UNIDAD) expect(DIMENSIONES_DECLARADAS[UNIDADES_DE_MEDIDA[c].dimension], c).toBeDefined();
  });

  it("(c) todo motivo de rechazo está declarado", () => {
    expect(ordenados(MOTIVOS_DE_CONVERSION)).toEqual(ordenados(Object.keys(MOTIVOS_DECLARADOS)));
  });

  it("(d) todo valor de MagnitudUnidad de Prisma está declarado y apunta a una dimensión que existe", () => {
    const esquema = readFileSync(join(__dirname, "../../prisma/schema.prisma"), "utf8");
    const bloque = /enum MagnitudUnidad \{([^}]*)\}/.exec(esquema)?.[1];
    expect(bloque, "no se encontró el enum MagnitudUnidad").toBeDefined();
    const valores = (bloque ?? "")
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, "").trim())
      .filter((l) => l.length > 0);
    expect(ordenados(valores), "un valor nuevo de MagnitudUnidad sin declarar a qué dimensión pasa").toEqual(ordenados(Object.keys(MAGNITUDES_DE_PRISMA)));
    for (const [v, d] of Object.entries(MAGNITUDES_DE_PRISMA)) {
      if (d.dimension !== null) expect(DIMENSIONES_DE_UNIDAD as readonly string[], v).toContain(d.dimension);
      expect(d.motivo.length, v).toBeGreaterThan(10);
    }
  });
});
