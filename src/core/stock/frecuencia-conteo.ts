/**
 * Lógica pura de la agenda de conteo físico periódico (docs/plan-rendimiento-
 * recetas-2026-09-22.md §E, sub-plan S3 — decisión 2 de §3, "conteos físicos
 * periódicos", comprometida por el dueño 2026-09-22). Sin Prisma: entra la
 * última fecha de conteo conocida (`diferencias-ajustes.ts` ya la trae como
 * `ultimaFechaConteo`) más la frecuencia configurada
 * (`FrecuenciaConteoProducto`), y sale un estado listo para mostrar.
 */

export interface EstadoConteo {
  /**
   * Cuándo toca el próximo conteo — `null` sin agenda (`frecuenciaDias` es
   * `0`, mismo criterio que Odoo `cyclic_inventory_frequency`) o cuando
   * nunca se registró un conteo (no hay fecha desde la cual contar los
   * días: no se inventa un ancla).
   */
  proximaFecha: Date | null;
  /** Días completos de atraso sobre `proximaFecha` (0 si todavía no vence). `null` en los mismos casos que `proximaFecha`. */
  diasDeAtraso: number | null;
  vencido: boolean;
}

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * `frecuenciaDias <= 0` → sin agenda: nunca vencido, aunque nunca se haya
 * contado — "nunca se contó" no es lo mismo que "vencido" (sin agenda no
 * hay nada que vigilar).
 *
 * Con agenda (`frecuenciaDias > 0`) pero SIN conteo previo: una agenda
 * activa que nunca se cumplió es la forma más vencida posible — se marca
 * `vencido: true` sin una fecha/atraso numérico (no hay ancla para
 * calcularlos, y no se inventa una).
 *
 * Con agenda y conteo previo: `proximaFecha = ultimaFechaConteo +
 * frecuenciaDias`; vencido si `hoy` ya la pasó.
 */
export function resolverProximoConteo({
  ultimaFechaConteo,
  frecuenciaDias,
  hoy,
}: {
  ultimaFechaConteo: Date | null;
  frecuenciaDias: number;
  hoy: Date;
}): EstadoConteo {
  if (frecuenciaDias <= 0) return { proximaFecha: null, diasDeAtraso: null, vencido: false };
  if (ultimaFechaConteo === null) return { proximaFecha: null, diasDeAtraso: null, vencido: true };

  const proximaFecha = new Date(ultimaFechaConteo);
  proximaFecha.setUTCDate(proximaFecha.getUTCDate() + frecuenciaDias);

  const msDeAtraso = hoy.getTime() - proximaFecha.getTime();
  const diasDeAtraso = Math.max(0, Math.floor(msDeAtraso / MS_POR_DIA));
  return { proximaFecha, diasDeAtraso, vencido: msDeAtraso > 0 };
}
