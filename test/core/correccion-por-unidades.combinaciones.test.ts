import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluarCorreccionPorUnidades, type EntradaDeLaCorreccion, type ResultadoDeLaCorreccion } from "../../src/core/movimientos/correccion-por-unidades";

/**
 * Recorre TODAS las combinaciones de las dimensiones del oráculo `docs/oraculo-combinaciones-correccion-e1-2026-11-06.md` y compara cada una contra la
 * decisión pura. Las reglas se LEEN del documento (no están copiadas acá): el oráculo es la tabla, no el test.
 */
const ORACULO = readFileSync("docs/oraculo-combinaciones-correccion-e1-2026-11-06.md", "utf8");

const DIMENSIONES = {
  PERM: ["LOS_DOS", "FALTA_ANULAR", "FALTA_EMITIR"],
  REP: ["NUEVA", "MISMA_IGUAL", "MISMA_DISTINTA"],
  ESTADO: ["VIGENTE", "REEMPLAZADA", "ANULADA", "NO_ES_VENTA"],
  VISTO: ["IGUAL", "DISTINTO"],
  PROMO: ["NO", "SI"],
  ADIC: ["NINGUNO", "CON_ADICIONALES", "ES_ADICIONAL"],
  UNID: ["PARTE", "TOTAL", "INVALIDA"],
  POST: ["NINGUNO", "CONTEO", "PAGO", "AMBOS"],
} as const;
type Clave = keyof typeof DIMENSIONES;
type Combinacion = { [K in Clave]: (typeof DIMENSIONES)[K][number] };

interface Regla {
  n: string;
  condiciones: Partial<Record<Clave, string[]>>;
  resultado: string;
}

function leerReglas(): Regla[] {
  const seccion = ORACULO.split("## Reglas")[1]?.split("## Campos declarados")[0] ?? "";
  const reglas = seccion
    .split("\n")
    .filter((l) => /^\| R\d+ \|/.test(l))
    .map((l) => {
      const [, n, cond, resultado] = l.split("|").map((c) => c.trim());
      const condiciones: Regla["condiciones"] = {};
      for (const parte of cond.split(";").map((p) => p.trim()).filter(Boolean)) {
        const [clave, valores] = parte.split("=");
        condiciones[clave as Clave] = valores.split(",").map((v) => v.trim());
      }
      return { n, condiciones, resultado };
    });
  return reglas;
}

function combinaciones(): Combinacion[] {
  const claves = Object.keys(DIMENSIONES) as Clave[];
  return claves.reduce<Partial<Combinacion>[]>((acc, clave) => acc.flatMap((c) => DIMENSIONES[clave].map((v) => ({ ...c, [clave]: v }))), [{}]) as Combinacion[];
}

const esperado = (c: Combinacion, reglas: Regla[]): string => {
  const regla = reglas.find((r) => (Object.entries(r.condiciones) as [Clave, string[]][]).every(([clave, valores]) => valores.includes(c[clave])));
  if (!regla) throw new Error(`El oráculo no cubre la combinación ${JSON.stringify(c)}`);
  return regla.resultado;
};

const UNIDADES = 4;
function entradaDe(c: Combinacion): EntradaDeLaCorreccion {
  return {
    permisos: { anularVenta: c.PERM !== "FALTA_ANULAR", emitirTicketCorregido: c.PERM !== "FALTA_EMITIR" },
    repeticion: c.REP === "NUEVA" ? "NUEVA" : c.REP === "MISMA_IGUAL" ? "MISMA_CLAVE_IGUAL" : "MISMA_CLAVE_DISTINTA",
    venta: {
      proceso: c.ESTADO === "NO_ES_VENTA" ? "MERMA" : "VENTA",
      anuladaEn: c.ESTADO === "ANULADA" ? new Date("2026-11-06T15:00:00Z") : null,
      yaReemplazada: c.ESTADO === "REEMPLAZADA",
      promoCuentaId: c.PROMO === "SI" ? "promo-1" : null,
      operacionPadreId: c.ADIC === "ES_ADICIONAL" ? "op-padre" : null,
      hijasVigentes: c.ADIC === "CON_ADICIONALES" ? ["op-hija"] : [],
      unidades: UNIDADES,
    },
    unidadesVistas: c.VISTO === "IGUAL" ? UNIDADES : UNIDADES + 1,
    unidadesAQuitar: c.UNID === "PARTE" ? 1 : c.UNID === "TOTAL" ? UNIDADES : 0,
    posteriores: {
      controlesOAjustes: c.POST === "CONTEO" || c.POST === "AMBOS" ? [{ productoNombre: "Cerveza Patagonia", seccionNombre: "Salón" }] : [],
      pagosAConsignantes: c.POST === "PAGO" || c.POST === "AMBOS" ? ["Bodega Don Pepe"] : [],
    },
  };
}

const comoTexto = (r: ResultadoDeLaCorreccion): string => (r.ok ? `ACEPTA ${r.alcance}` : `RECHAZA ${r.motivo}`);

describe("corregir unidades de un ticket: oráculo de combinaciones (E1)", () => {
  const reglas = leerReglas();

  it("el documento trae las 15 reglas y cubre cada combinación con exactamente una que manda", () => {
    expect(reglas.map((r) => r.n)).toEqual(Array.from({ length: 15 }, (_, i) => `R${i + 1}`));
    // Cada valor que nombra una regla existe como valor de su dimensión (una errata en la tabla no pasa inadvertida).
    for (const r of reglas) for (const [clave, valores] of Object.entries(r.condiciones)) for (const v of valores) expect((DIMENSIONES as Record<string, readonly string[]>)[clave], `${r.n} ${clave}`).toContain(v);
  });

  it("recorre TODAS las combinaciones (5.184) y la decisión coincide con la tabla", () => {
    const todas = combinaciones();
    expect(todas).toHaveLength(3 * 3 * 4 * 2 * 2 * 3 * 3 * 4);
    const distintas: string[] = [];
    for (const c of todas) {
      const obtenido = comoTexto(evaluarCorreccionPorUnidades(entradaDe(c)));
      if (obtenido !== esperado(c, reglas)) distintas.push(`${JSON.stringify(c)} → obtuvo ${obtenido}, el oráculo dice ${esperado(c, reglas)}`);
    }
    expect(distintas).toEqual([]);
  });

  it("guardián: todo campo de la entrada está declarado en el oráculo (una dimensión nueva sin declarar hace fallar)", () => {
    const e = entradaDe({ PERM: "LOS_DOS", REP: "NUEVA", ESTADO: "VIGENTE", VISTO: "IGUAL", PROMO: "NO", ADIC: "NINGUNO", UNID: "PARTE", POST: "NINGUNO" });
    const campos = [...Object.keys(e).filter((k) => k !== "venta"), ...Object.keys(e.venta).map((k) => `venta.${k}`)];
    const declarados = ORACULO.split("## Campos declarados")[1] ?? "";
    for (const campo of campos) expect(declarados, `campo sin declarar: ${campo}`).toContain(`\`${campo}\``);
  });
});
