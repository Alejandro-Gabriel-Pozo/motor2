import { invalido, valido, type ResultadoDeRegla } from "@/core/datos/resultado-de-regla";
import { TOPE_EN_CENTAVOS } from "./dinero-de-caja";

/**
 * Reparto de un cobro entre medios de pago (docs/diseno-caja-y-cobro-paridad-pedernal-escalera-2026-11-16.md, I-4): la suma de los renglones tiene que dar el total de la cuenta AL CENTAVO. Igual que
 * `cobrar` de Pedernal: ni de más ni de menos (`COBRO_NO_CUADRA` con `falta` o `sobra`); el vuelto es solo de pantalla y no se guarda.
 *
 * Puro: sin reloj, sin azar, sin I/O.
 */

/** Cuántos renglones (medios) admite un solo cobro, como Pedernal. */
export const MAXIMO_DE_RENGLONES_DE_COBRO = 50;

export interface RenglonDeCobro {
  readonly medioDePagoId: string;
  /** Centavos enteros, mayor que cero y menor que el tope de la columna. */
  readonly importeEnCentavos: bigint;
}

type ErrorDeCobro = "COBRO_SIN_RENGLONES" | "COBRO_CON_DEMASIADOS_RENGLONES" | "IMPORTE_INVALIDO" | "COBRO_NO_CUADRA";

/** Cuánto falta (`falta`) o sobra (`sobra`) para llegar al total, en centavos; solo con `COBRO_NO_CUADRA`. */
interface DiferenciaDeCobro {
  readonly falta: bigint;
  readonly sobra: bigint;
}

type ResultadoDeReparto =
  | ResultadoDeRegla<readonly RenglonDeCobro[], Exclude<ErrorDeCobro, "COBRO_NO_CUADRA">>
  | { readonly ok: false; readonly error: "COBRO_NO_CUADRA"; readonly diferencia: DiferenciaDeCobro };

/**
 * Valida los renglones contra el total y los devuelve en orden CANÓNICO (por medio y luego por importe): el mismo pedido en otro orden es el mismo pedido (misma huella, mismo orden de renglón).
 * Un total de 0 no se cobra (no hay nada que cobrar): lo rechaza el caso de uso antes, acá `COBRO_NO_CUADRA` con `sobra`.
 */
export function repartirCobro(renglones: readonly RenglonDeCobro[], totalEnCentavos: bigint): ResultadoDeReparto {
  if (renglones.length === 0) return invalido("COBRO_SIN_RENGLONES");
  if (renglones.length > MAXIMO_DE_RENGLONES_DE_COBRO) return invalido("COBRO_CON_DEMASIADOS_RENGLONES");
  let suma = BigInt(0);
  for (const r of renglones) {
    if (r.importeEnCentavos <= BigInt(0) || r.importeEnCentavos >= TOPE_EN_CENTAVOS || r.medioDePagoId === "") return invalido("IMPORTE_INVALIDO");
    suma += r.importeEnCentavos;
  }
  if (suma !== totalEnCentavos) {
    const falta = totalEnCentavos > suma ? totalEnCentavos - suma : BigInt(0);
    const sobra = suma > totalEnCentavos ? suma - totalEnCentavos : BigInt(0);
    return { ok: false, error: "COBRO_NO_CUADRA", diferencia: { falta, sobra } };
  }
  const ordenados = [...renglones].sort((a, b) => (a.medioDePagoId < b.medioDePagoId ? -1 : a.medioDePagoId > b.medioDePagoId ? 1 : a.importeEnCentavos < b.importeEnCentavos ? -1 : a.importeEnCentavos > b.importeEnCentavos ? 1 : 0));
  return valido(ordenados);
}
