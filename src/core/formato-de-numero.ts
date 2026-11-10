/**
 * LA ÚNICA función de formateo de SALIDA de números del sistema (regla del dueño, 2026-11-09; diseño en
 * `docs/diseno-formato-de-numero-salida-2026-11-09.md`): todo número que se le muestra a una persona sale como «1.000,00» (punto de miles, coma
 * decimal, es-AR), con la unidad pegada a la cantidad («0,22 kg») y, cuando no hay dato, «—» (nunca un 0 inventado).
 *
 * Alcance: solo cómo se MUESTRAN. Cómo se escriben y se leen los números tecleados vive en `core/datos/numero-tecleado.ts` (otra sesión, no se toca
 * acá). Las fechas tampoco son de este módulo (`core/tiempo`). Las exportaciones a Excel siguen mandando el valor NUMÉRICO (el formato lo pone la planilla).
 *
 * Puro: sin base, sin reloj, sin React. Entra `number` (un `Decimal` de Prisma se convierte con `Number()` en el borde, como en todo el repo: un importe
 * de hasta 2 decimales cabe EXACTO en un double mientras no pase de 2^53 centavos); salen textos.
 *
 * Reglas:
 *  - El separador de miles se pone SIEMPRE (`useGrouping: "always"`: sin eso, ICU de algunas localidades no agrupa los de 4 cifras).
 *  - Dinero: siempre 2 decimales, moneda ARS fija (`MONEDA_FIJA`). Se redondea con `redondearMoneda` (decimal exacto, empates alejándose del cero, igual que
 *    `NUMERIC` de Postgres) ANTES de formatear: lo que se muestra es lo que se guardaría.
 *  - Cantidad: hasta los decimales de su unidad (`Unidad.decimales`, 0 a 6), SIN ceros de relleno («0,22», no «0,220»). Sin unidad conocida: hasta 4, la
 *    precisión de las columnas de cantidad.
 *  - Porcentaje: hasta 2 decimales, sin relleno, con « %» pegado.
 *  - Negativo con «-» delante; un resto que redondea a cero sale «0» sin signo (`signDisplay: "negative"`).
 *  - `null`, `undefined`, `NaN` y `±Infinity` salen «—» (`SIN_DATO`).
 */
import { IMPORTE_MINIMO, MONEDA_FIJA, redondearMoneda } from "@/core/moneda";

/** Lo que se muestra cuando no hay dato (nunca un 0 inventado). Es el patrón que ya usaban los reportes. */
export const SIN_DATO = "—";

/** Decimales máximos de una cantidad cuya unidad no se conoce: la precisión de las columnas de cantidad. */
export const DECIMALES_DE_CANTIDAD_SIN_UNIDAD = 4;

/** Separador entre el número y su unidad («0,22 kg») o su «%»: un espacio común (las celdas numéricas llevan `whitespace-nowrap` para que no se parta). */
const PEGADO = "\u0020";

const DECIMALES_MAXIMOS = 6;

type Valor = number | null | undefined;

const esDato = (n: Valor): n is number => typeof n === "number" && Number.isFinite(n);

const DINERO = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: MONEDA_FIJA,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: "always",
  signDisplay: "negative",
});

const DINERO_ENTERO = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: MONEDA_FIJA,
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
  useGrouping: "always",
  signDisplay: "negative",
});

const DOLARES = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always", signDisplay: "negative" });

const formatosDeNumero = new Map<number, Intl.NumberFormat>();
function formatoConDecimales(decimales: number): Intl.NumberFormat {
  let f = formatosDeNumero.get(decimales);
  if (!f) {
    f = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: decimales, useGrouping: "always", signDisplay: "negative" });
    formatosDeNumero.set(decimales, f);
  }
  return f;
}

/** Decimales válidos (entero de 0 a 6); cualquier otra cosa cae en los de «sin unidad conocida». */
function decimalesValidos(decimales: number | undefined): number {
  return decimales !== undefined && Number.isInteger(decimales) && decimales >= 0 && decimales <= DECIMALES_MAXIMOS ? decimales : DECIMALES_DE_CANTIDAD_SIN_UNIDAD;
}

/** «$ 1.000,00». Siempre 2 decimales; moneda ARS. */
export function formatearMonto(n: Valor): string {
  return esDato(n) ? DINERO.format(redondearMoneda(n)) : SIN_DATO;
}

/**
 * «$ 15.000» / «$ 1.234,50»: el dinero de la CARTA PÚBLICA (decisión del dueño, 2026-11-10: «el ,00 solo si hay decimales que mostrar»). Importe entero (ya redondeado a centavos con `redondearMoneda`, el mismo
 * redondeo que `formatearMonto`) sin decimales; con centavos, SIEMPRE 2 (nunca 1: «$ 0,50»). Es SOLO presentación y SOLO para la carta del cliente final (`core/carta/precio-carta.ts`): el resto del sistema sigue
 * con `formatearMonto` («siempre 2 decimales») hasta que el dueño diga otra cosa. Lo vigila `test/arquitectura/cerco-numero-sin-formato-central.test.ts` (no se usa fuera de la carta).
 */
export function formatearMontoCarta(n: Valor): string {
  if (!esDato(n)) return SIN_DATO;
  const redondeado = redondearMoneda(n);
  return Number.isInteger(redondeado) ? DINERO_ENTERO.format(redondeado) : DINERO.format(redondeado);
}

/**
 * «1.234,56»: un importe EN DÓLARES (la conversión informativa de `EnDolares`; el sistema opera en pesos, `MONEDA_FIJA`). Siempre 2 decimales, sin símbolo (la pantalla pone «US$»).
 * Es la única salida de dinero que no es ARS; se redondea con `redondearMoneda` (misma regla de empates que los pesos).
 */
export function formatearDolares(n: Valor): string {
  return esDato(n) ? DOLARES.format(redondearMoneda(n)) : SIN_DATO;
}

/** «1.000,5»: hasta `decimales` (los de la unidad), sin ceros de relleno. Sin `decimales`: hasta 4. */
export function formatearCantidad(n: Valor, decimales?: number): string {
  return esDato(n) ? formatoConDecimales(decimalesValidos(decimales)).format(n) : SIN_DATO;
}

/** «0,22 kg»: la cantidad con la unidad pegada (espacio que no se parte). `unidad` es su nombre; `decimales`, los de esa unidad. */
export function formatearCantidadConUnidad(n: Valor, unidad: string, decimales?: number): string {
  return esDato(n) ? `${formatearCantidad(n, decimales)}${PEGADO}${unidad}` : SIN_DATO;
}

/** «1.234»: un conteo (ventas, unidades vendidas, filas). Redondea al entero más cercano. */
export function formatearEntero(n: Valor): string {
  return esDato(n) ? formatoConDecimales(0).format(n) : SIN_DATO;
}

/** «12,5 %»: `n` ya viene en porcentaje (12,5 es 12,5 %, no 1250 %). Hasta 2 decimales, sin relleno. */
export function formatearPorcentaje(n: Valor): string {
  return esDato(n) ? `${formatoConDecimales(2).format(n)}${PEGADO}%` : SIN_DATO;
}

/** El piso de un importe cobrado por unidad escrito para un mensaje al usuario («$ 0,01»), derivado de `IMPORTE_MINIMO` (la única fuente del piso, `core/moneda.ts`). */
export const IMPORTE_MINIMO_TEXTO = formatearMonto(IMPORTE_MINIMO);
