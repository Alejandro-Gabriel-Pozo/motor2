/** Tope de "días atrás" de los reportes: pasado esto la fecha límite deja de ser una fecha válida (y la pantalla mostraría un error en lugar de un reporte). */
export const MAXIMO_DIAS_ATRAS = 3650;

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
