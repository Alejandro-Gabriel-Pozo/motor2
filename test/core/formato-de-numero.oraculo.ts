/**
 * ORÁCULO del formateo de salida de números (regla del dueño, 2026-11-09; diseño: `docs/diseno-formato-de-numero-salida-2026-11-09.md`, nivel 10). Está escrito APARTE del
 * código y sin `Intl`: la tabla de reglas de abajo y la `referencia` (aritmética decimal exacta con `decimal.js` y el punto de miles puesto a mano) dicen qué tiene que salir;
 * `formato-de-numero.test.ts` recorre todas las combinaciones contra esto. Si cambia una regla, cambia ESTE archivo (y el diseño), no el código en silencio.
 *
 * DIMENSIONES que cambian lo que se ve: tipo (dinero, cantidad, cantidad con unidad, entero, porcentaje) × valor × decimales de la unidad × signo × vacío.
 * Un guardián (`formato-de-numero.test.ts`) falla si el módulo exporta algo que no está declarado acá.
 */
import { Decimal } from "decimal.js";

/** Todo lo que exporta `core/formato-de-numero.ts`, declarado: cada una dice qué dimensión es (o que es una constante). */
export const EXPORTACIONES_DECLARADAS = {
  SIN_DATO: "constante: lo que sale cuando no hay dato",
  DECIMALES_DE_CANTIDAD_SIN_UNIDAD: "constante: decimales máximos de una cantidad sin unidad conocida",
  IMPORTE_MINIMO_TEXTO: "constante: el piso de $ 0,01 escrito para un mensaje (dinero, vía formatearMonto)",
  formatearMonto: "tipo dinero",
  formatearMontoCarta: "tipo dinero de la carta pública: como dinero, sin «,00» si el importe es entero; probado aparte (describe «dinero de la carta») contra el oráculo de dinero",
  formatearDolares: "tipo dinero en USD: 2 decimales, sin símbolo (conversión informativa de EnDolares); probado aparte en el test",
  formatearCantidad: "tipo cantidad",
  formatearCantidadConUnidad: "tipo cantidad con unidad",
  formatearEntero: "tipo entero",
  formatearPorcentaje: "tipo porcentaje",
} as const;

export type Tipo = "dinero" | "cantidad" | "cantidad-con-unidad" | "entero" | "porcentaje";
export const TIPOS: readonly Tipo[] = ["dinero", "cantidad", "cantidad-con-unidad", "entero", "porcentaje"];

/** Magnitudes (positivas, en texto decimal exacto: el valor tal cual lo escribiría una persona). Incluye los bordes de redondeo. */
export const MAGNITUDES = ["0", "0.0004", "0.0005", "0.004", "0.005", "0.22", "0.5", "1", "1.005", "1.0005", "12.5", "128.045", "999.995", "1000", "1234.5678", "1234567.891", "9007199254740", "1000000000000000000000"] as const;

/** Decimales de la unidad (`Unidad.decimales`): 0 (unidades), 2 (el valor por defecto), 3 y 4 (kg), o ninguna conocida. */
export const DECIMALES_DE_UNIDAD: readonly (number | undefined)[] = [0, 2, 3, 4, undefined];
const DECIMALES_SIN_UNIDAD = 4;

export const SIGNOS = ["+", "-"] as const;
export const VACIOS = [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY] as const;

export const SIN_DATO = "—";
const NBSP = " ";

/** Tabla de casos escritos a mano (los que dijo el dueño y los bordes que más duelen). [tipo, valor, decimales de la unidad, unidad, esperado]. */
export const CASOS_ESCRITOS: readonly [Tipo, number | null | undefined, number | undefined, string, string][] = [
  ["cantidad-con-unidad", 0.22, 3, "kg", "0,22 kg"],
  ["cantidad-con-unidad", 0.22, 4, "kg", "0,22 kg"],
  ["cantidad-con-unidad", 1, 0, "unidad", "1 unidad"],
  ["cantidad-con-unidad", 1250, 3, "g", "1.250 g"],
  ["cantidad-con-unidad", 0.0004, 3, "kg", "0 kg"],
  ["cantidad", 1000, undefined, "", "1.000"],
  ["cantidad", 12.5, 0, "", "13"],
  ["dinero", 1000, undefined, "", `$${NBSP}1.000,00`],
  ["dinero", 0, undefined, "", `$${NBSP}0,00`],
  ["dinero", -1000.5, undefined, "", `-$${NBSP}1.000,50`],
  ["dinero", 1.005, undefined, "", `$${NBSP}1,01`],
  ["dinero", 128.045, undefined, "", `$${NBSP}128,05`],
  ["dinero", -128.045, undefined, "", `-$${NBSP}128,05`],
  ["dinero", -0.004, undefined, "", `$${NBSP}0,00`],
  ["dinero", null, undefined, "", SIN_DATO],
  ["entero", 1234.5, undefined, "", "1.235"],
  ["porcentaje", 12.5, undefined, "", "12,5 %"],
  ["porcentaje", 7.125, undefined, "", "7,13 %"],
  ["porcentaje", 100, undefined, "", "100 %"],
];

const D = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });

/** Punto de miles puesto a mano: «1234567» → «1.234.567». */
function conMiles(entero: string): string {
  return entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** `magnitud` (texto decimal) redondeada a `decimales` (empates alejándose del cero) y escrita con coma; con `relleno`, completa los ceros hasta `decimales`. */
function escribir(magnitud: string, decimales: number, relleno: boolean): { texto: string; esCero: boolean } {
  const redondeado = new D(magnitud).toDecimalPlaces(decimales, Decimal.ROUND_HALF_UP);
  const [entera, fraccion = ""] = (relleno ? redondeado.toFixed(decimales) : redondeado.toFixed()).split(".");
  const fraccionLimpia = relleno ? fraccion : fraccion.replace(/0+$/, "");
  return { texto: conMiles(entera) + (fraccionLimpia ? `,${fraccionLimpia}` : ""), esCero: redondeado.isZero() };
}

/**
 * Qué tiene que salir para `tipo` con la magnitud `magnitud` (texto, positiva), el `signo` y los decimales de la unidad. Reglas:
 *  - dinero: siempre 2 decimales con relleno, «$ » delante (espacio que no se parte);
 *  - cantidad: hasta los decimales de la unidad (4 si no se conoce), sin relleno; con unidad, «cantidad unidad»;
 *  - entero: 0 decimales; porcentaje: hasta 2 decimales, sin relleno, y « %»;
 *  - negativo: «-» delante (en dinero, delante del «$»); un resultado que redondea a cero no lleva signo.
 */
export function referencia(tipo: Tipo, magnitud: string, signo: "+" | "-", decimalesDeLaUnidad: number | undefined, unidad = "kg"): string {
  let cuerpo: { texto: string; esCero: boolean };
  let pre = "";
  let post = "";
  switch (tipo) {
    case "dinero":
      cuerpo = escribir(magnitud, 2, true);
      pre = `$${NBSP}`;
      break;
    case "cantidad":
      cuerpo = escribir(magnitud, decimalesDeLaUnidad ?? DECIMALES_SIN_UNIDAD, false);
      break;
    case "cantidad-con-unidad":
      cuerpo = escribir(magnitud, decimalesDeLaUnidad ?? DECIMALES_SIN_UNIDAD, false);
      post = ` ${unidad}`;
      break;
    case "entero":
      cuerpo = escribir(magnitud, 0, false);
      break;
    case "porcentaje":
      cuerpo = escribir(magnitud, 2, false);
      post = " %";
      break;
  }
  const menos = signo === "-" && !cuerpo.esCero ? "-" : "";
  return `${menos}${pre}${cuerpo.texto}${post}`;
}
