import { MAXIMO_DE_DIAS_DE_UN_RANGO } from "./rango-por-defecto";

/**
 * Tope de "días atrás" de los reportes: el mismo que el de cualquier rango de reporte (`MAXIMO_DE_DIAS_DE_UN_RANGO`, 366 días; S-28). Antes eran 3650 (diez años): pasado eso la fecha límite
 * dejaba de ser una fecha válida y la pantalla mostraba un error, pero hasta ahí un `?dias=3650` hacía recorrer todo el Kardex de la sucursal en Devoluciones y en Pérdidas.
 */
export const MAXIMO_DIAS_ATRAS = MAXIMO_DE_DIAS_DE_UN_RANGO;

/**
 * Los "días atrás" que llegan por la URL (`?dias=`) son texto de afuera: un entero entre 1 y `MAXIMO_DIAS_ATRAS`, o el valor por defecto.
 * Un decimal, un negativo, un texto, una lista o un número descomunal no rompen el reporte ni lo consultan con un rango sin sentido.
 */
export function diasAtrasDeUrl(valor: unknown, porDefecto: number): number {
  if (typeof valor !== "string" || valor.trim() === "") return porDefecto;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1) return porDefecto;
  return Math.min(n, MAXIMO_DIAS_ATRAS);
}
