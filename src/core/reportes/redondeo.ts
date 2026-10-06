/** Redondeo a 3 decimales, para cantidades de stock (no plata). Puro: vive acá y no en `comun.ts` (que lee la base) para que los reportes puros no dependan de él. */
export function redondearCantidad(n: number): number {
  return Math.round(Number(n || 0) * 1000) / 1000;
}
