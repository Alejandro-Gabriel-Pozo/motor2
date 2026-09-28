import { texto } from "@/core/texto";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ComandoConteoFisico } from "./conteo-fisico.schema";

/**
 * Guard del comando «registrar un conteo físico» (convención "guard por feature", 2026-09-25; Task #41, Fase M, M13e1 —
 * docs/arquitectura-casos-de-uso-2026-09-27.md). Formato del comando, ANTES de abrir la transacción y ANTES de `conPermiso`. Puro: sin
 * Prisma ni permisos.
 *
 * La única validación (sección en blanco) es EXACTAMENTE la que antes corría en línea, primera línea de `registrarConteoConContexto`
 * (`src/server/actions/movimientos/conteo-fisico.ts`), con el MISMO texto. Todo lo demás que esa función validaba (sección propia de la
 * sucursal, producto, disponibilidad, "tiene stock real", formato/decimales del conteo) depende de datos de base — se queda en el caso
 * de uso, mismo criterio que `guardComandoReclasificarStock` (M13d) con el chequeo "único destino idéntico al origen".
 *
 * Devuelve `aceptar(entrada)` SIN transformar nada.
 */
export function guardComandoConteoFisico(entrada: unknown): ResultadoDato<ComandoConteoFisico> {
  const { seccionId } = (entrada ?? {}) as { seccionId?: unknown };
  if (!texto(seccionId)) return rechazar("vacio", "Elegí una sección — no se puede dejar en blanco.");
  return aceptar(entrada as ComandoConteoFisico);
}
