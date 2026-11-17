import { invalido, valido, type ResultadoDeRegla } from "@/core/datos/resultado-de-regla";
import { datosEnFormaCompleta, type DatosDelCobro } from "./datos-del-cobro";
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
  /** C3: la cuenta de cobro del renglón (opcional; ausente o `null` = «sin cuenta»). */
  readonly cuentaDeCobroId?: string | null;
  /** C3: los datos opcionales del cobro (cupón, últimos 4, marca, cuotas, DNI); ausente = ninguno. */
  readonly datos?: DatosDelCobro;
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

const comparar = <T extends string | bigint>(a: T, b: T): number => (a < b ? -1 : a > b ? 1 : 0);

/** Orden CANÓNICO: medio, cuenta («sin cuenta» primero), importe y por último los datos. Sin cuenta ni datos queda el orden de C1 (medio e importe). */
function compararRenglones(a: RenglonDeCobro, b: RenglonDeCobro): number {
  return (
    comparar(a.medioDePagoId, b.medioDePagoId) ||
    comparar(a.cuentaDeCobroId ?? "", b.cuentaDeCobroId ?? "") ||
    comparar(a.importeEnCentavos, b.importeEnCentavos) ||
    comparar(JSON.stringify(datosEnFormaCompleta(a.datos)), JSON.stringify(datosEnFormaCompleta(b.datos)))
  );
}

/**
 * Valida los renglones contra el total y los devuelve en orden CANÓNICO (por medio, cuenta, importe y datos): el mismo pedido en otro orden es el mismo pedido (misma huella, mismo orden de renglón).
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
  return valido([...renglones].sort(compararRenglones));
}
