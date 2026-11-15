import { invalido, valido, type ResultadoDeRegla } from "@/core/datos/resultado-de-regla";

/**
 * CUIT ESTRICTO, igual al de Pedernal (`src/primitivas/identificacion-fiscal/cuit.ts`, versión vigente de `main`): 11 dígitos, el último es verificador
 * (módulo 11 con pesos 5,4,3,2,7,6,5,4,3,2; resto 11 da 0 y resto 10 no tiene dígito válido, así que ese CUIT se rechaza). Forma canónica: solo
 * dígitos. Se acepta también `XX-XXXXXXXX-X`, con los guiones EXACTOS. Nada más: ni espacios (tampoco en los extremos), ni puntos, ni
 * guiones mal puestos, ni dígitos de otro alfabeto, ni un salto de línea al final.
 *
 * NO se valida el prefijo (20, 23, 27, 30, 33…): se es permisivo como ARCA y la lista de prefijos vigentes no está verificada (ADR-008 de Pedernal).
 * Esto SACA la lista de prefijos que hoy tiene `cuit.ts` de este mismo directorio. Diferencias con el CUIT de hoy (`normalizarCuit`, que limpia espacios, puntos y
 * guiones sueltos): esta regla no limpia nada, rechaza. Quien la conecte tiene que decidir dónde se recorta lo que escribe una persona.
 *
 * NO está conectada todavía (etapa E1): `cuit.ts` sigue siendo el que usan las pantallas. Puro: sin reloj ni azar.
 */
export type ErrorDeCuit = "CUIT_FORMATO_INVALIDO" | "CUIT_DIGITO_VERIFICADOR_INVALIDO";

const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;
/** Los dígitos de un CUIT, CUIL o CDI. */
export const LARGO_DE_CUIT = 11;
const FORMA_CANONICA = new RegExp(`^[0-9]{${LARGO_DE_CUIT}}$`);
const FORMA_CON_GUIONES = /^([0-9]{2})-([0-9]{8})-([0-9])$/;

/** Dígito verificador que corresponde a los primeros diez dígitos (el resto se ignora), o `null` si no existe. */
export function digitoVerificadorDeCuit(digitos: string): number | null {
  const suma = PESOS.reduce((acumulado, peso, i) => acumulado + peso * Number(digitos[i]), 0);
  const resto = 11 - (suma % 11);
  if (resto === 11) return 0;
  return resto === 10 ? null : resto;
}

/** Los 11 dígitos canónicos o el motivo del rechazo. Lo que no es texto se informa como formato inválido (nunca lanza). */
export function cuitDesdeTexto(texto: unknown): ResultadoDeRegla<string, ErrorDeCuit> {
  if (typeof texto !== "string") return invalido("CUIT_FORMATO_INVALIDO");
  const conGuiones = FORMA_CON_GUIONES.exec(texto);
  const digitos = conGuiones === null ? texto : conGuiones.slice(1).join("");
  if (!FORMA_CANONICA.test(digitos)) return invalido("CUIT_FORMATO_INVALIDO");
  // Si no existe dígito verificador (`null`), la comparación también falla: el CUIT se rechaza.
  if (digitoVerificadorDeCuit(digitos) !== Number(digitos[10])) return invalido("CUIT_DIGITO_VERIFICADOR_INVALIDO");
  return valido(digitos);
}
