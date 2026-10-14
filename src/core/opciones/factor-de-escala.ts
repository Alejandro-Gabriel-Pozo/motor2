import { Decimal } from "decimal.js";
import { FACTOR_DE_ESCALA_MAXIMO } from "./tipos";
import { esFactorValido } from "./validar-configuracion";

/**
 * OPCIONES-FACTOR: el FACTOR de un tamaño en palabras, para quien lo carga (`CamposDeVersion`, en el alta de una opción y en «Cambiar precio o consumo»). El operario no tiene por qué
 * saber que 1,3 quiere decir «30% más»: la pantalla se lo dice mientras tipea. Función PURA y solo de lectura: no decide qué se guarda (eso lo valida el servidor, `validarVersion`) ni
 * cuánto se descuenta (eso es `consumoDeLineaConfigurada`); usa la MISMA regla de qué factor es válido que el servidor (`esFactorValido`: mayor que 0, hasta 10, hasta 4 decimales).
 *
 * El porcentaje se calcula en decimal exacto (decimal.js, a partir del texto del número: 1,3 es «1.3», no 1,30000000000000004) y se escribe con coma decimal y sin ceros de más:
 * 1 → «lo mismo», 1,3 → «30% más», 0,7 → «30% menos», 2 → «el doble (100% más)», 0,5 → «la mitad (50% menos)», 1,0001 → «0,01% más».
 */

export type LecturaDelFactor =
  /** El campo está vacío o el número no es un factor válido: solo el aviso, sin porcentaje. */
  | { valido: false; mensaje: string }
  | {
      valido: true;
      factor: number;
      /** El factor como se lee en pantalla: «1,3», «0,7», «2». */
      factorEnTexto: string;
      /** Cómo es respecto del tamaño base. */
      sentido: "igual" | "mas" | "menos";
      /** «lleva 30% más que el tamaño base», sin el factor adelante. */
      comparacion: string;
      /** La frase entera: «Factor 1,3 = lleva 30% más que el tamaño base». */
      frase: string;
    };

const COMO_SE_ESCRIBE = "Escribilo como 1,3 o 0,7.";

/** Un decimal exacto con coma y sin ceros de más («30», «12,5», «0,01»). */
function conComa(d: Decimal): string {
  return d.toFixed().replace(".", ",");
}

/** «el doble», «el triple», «4 veces lo que lleva»: solo para los enteros de 2 en adelante. */
function multiplo(entero: number): string {
  if (entero === 2) return "el doble de lo que lleva";
  if (entero === 3) return "el triple de lo que lleva";
  return `${entero} veces lo que lleva`;
}

/**
 * Lee el factor que se está tipeando. `valor` es el número ya interpretado del campo (`interpretarNumero`): `null` si está vacío y `NaN` si el texto no es un número. Nunca tira.
 */
export function leerFactorDeEscala(valor: number | null): LecturaDelFactor {
  if (valor === null) return { valido: false, mensaje: "Escribí el factor: 1 = lleva lo mismo que el tamaño base." };
  if (!Number.isFinite(valor)) return { valido: false, mensaje: `Ese factor no es un número. ${COMO_SE_ESCRIBE}` };
  if (valor <= 0) return { valido: false, mensaje: "El factor tiene que ser mayor que 0." };
  if (valor > FACTOR_DE_ESCALA_MAXIMO) return { valido: false, mensaje: `El factor puede ser hasta ${FACTOR_DE_ESCALA_MAXIMO} (${FACTOR_DE_ESCALA_MAXIMO} veces lo que lleva el tamaño base).` };
  if (!esFactorValido(valor)) return { valido: false, mensaje: "El factor lleva hasta 4 decimales." };

  const f = new Decimal(valor);
  const factorEnTexto = conComa(f);
  const diferencia = f.minus(1).abs().times(100);
  const porcentaje = `${conComa(diferencia)}%`;
  let sentido: "igual" | "mas" | "menos";
  let comparacion: string;
  if (f.equals(1)) {
    sentido = "igual";
    comparacion = "lleva lo mismo que el tamaño base";
  } else if (f.greaterThan(1)) {
    sentido = "mas";
    comparacion = f.isInteger() ? `lleva ${multiplo(f.toNumber())} el tamaño base (${porcentaje} más)` : `lleva ${porcentaje} más que el tamaño base`;
  } else {
    sentido = "menos";
    comparacion = f.equals(0.5) ? `lleva la mitad de lo que lleva el tamaño base (${porcentaje} menos)` : `lleva ${porcentaje} menos que el tamaño base`;
  }
  return { valido: true, factor: valor, factorEnTexto, sentido, comparacion, frase: `Factor ${factorEnTexto} = ${comparacion}` };
}
