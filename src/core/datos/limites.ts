import { texto } from "@/core/texto";
import { aceptar, rechazar, type ResultadoDato } from "./resultado";

/**
 * Topes de entrada de la auditoría de seguridad (S-22/S-23): un texto o un arreglo sin tope deja a un usuario con sesión inflar la base
 * o dejar un export inservible, y un número fuera del rango de su columna (`Int`, `Decimal(6,2)`) termina en un 500 en vez de un mensaje.
 */
export const LARGO_MAXIMO_NOTAS = 500;
export const LARGO_MAXIMO_DETALLE = 200;
export const LARGO_MAXIMO_CONTACTO = 120;
export const LARGO_MAXIMO_TELEFONO = 40;
export const LARGO_MAXIMO_CUIT = 20;
export const LARGO_MAXIMO_EMAIL = 254;
export const LARGO_MAXIMO_TEXTO_RECETA = 2000;

export const MAXIMO_LINEAS_POR_OPERACION = 500;
export const MAXIMO_INGREDIENTES_RECETA = 100;
export const MAXIMO_PASOS_RECETA = 100;
export const MAXIMO_SUSTITUTOS_POR_INGREDIENTE = 20;
export const MAXIMO_PRODUCTOS_POR_ITEM_AGRUPADO = 100;
/** S-52: cupos (secciones) de una promo combo. Una promo real tiene 2 a 5; la lista que llega del cliente no puede ser un arreglo de miles. */
export const MAXIMO_CUPOS_POR_PROMO = 50;
export const MAXIMO_DESTINOS_RECLASIFICACION = 100;

/** `Int` de Postgres es de 32 bits; este tope queda muy por debajo y basta para el uso real (minutos, días, raciones, orden). */
export const ENTERO_MAXIMO_RAZONABLE = 100_000;
/** La merma se guarda en `Decimal(6,2)` (hasta 9999,99); 1000 % ya es un dato mal cargado. */
export const MERMA_PORCENTAJE_MAXIMA = 1000;
/** `StockMinimoProducto.minimo` es `Decimal(14,4)`. */
export const STOCK_MINIMO_MAXIMO = 1e9;

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Texto libre opcional recortado: vacío → `null`; más largo que `maximo` → rechazo con código `largo`. */
export function validarTextoLibre(valor: unknown, etiqueta: string, maximo: number): ResultadoDato<string | null> {
  const v = texto(valor);
  if (!v) return aceptar(null);
  if (v.length > maximo) return rechazar("largo", `${etiqueta} no puede superar los ${maximo} caracteres.`);
  return aceptar(v);
}

/** Email opcional recortado: vacío → `null`; con formato `algo@dominio.tld` y hasta 254 caracteres. */
export function validarEmailOpcional(valor: unknown, etiqueta = "El email"): ResultadoDato<string | null> {
  const v = texto(valor);
  if (!v) return aceptar(null);
  if (v.length > LARGO_MAXIMO_EMAIL) return rechazar("largo", `${etiqueta} no puede superar los ${LARGO_MAXIMO_EMAIL} caracteres.`);
  if (!RE_EMAIL.test(v)) return rechazar("formato", `${etiqueta} no tiene un formato válido.`);
  return aceptar(v);
}

/** null si la lista no supera `maximo` elementos, o el mensaje listo para mostrar. `etiquetaPlural`: "Las líneas", "Los ingredientes"… */
export function validarTopeDeLista(lista: readonly unknown[], etiquetaPlural: string, maximo: number): string | null {
  return lista.length > maximo ? `${etiquetaPlural} no pueden ser más de ${maximo} por vez.` : null;
}

/** null si `valor` es un número finito que no supera `maximo`; el mensaje si no. Es un tope de columna, no una regla de negocio. */
export function validarNumeroHasta(valor: unknown, etiqueta: string, maximo: number): string | null {
  const n = Number(valor);
  if (!Number.isFinite(n)) return `${etiqueta} no es un número válido.`;
  if (n > maximo) return `${etiqueta} no puede superar ${maximo}.`;
  return null;
}
