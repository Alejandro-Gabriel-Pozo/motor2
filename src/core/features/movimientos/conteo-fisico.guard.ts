import { texto } from "@/core/texto";
import { validarFechaOperacion } from "@/core/datos/fecha-operacion";
import { esClaveIdempotenciaValida } from "@/core/datos/clave-idempotencia";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { LARGO_MAXIMO_DETALLE, validarTextoLibre } from "@/core/datos/limites";
import type { AccionConteo } from "@prisma/client";
import type { ComandoConteoFisico } from "./conteo-fisico.schema";

/** Las acciones válidas; la clave es el enum de Prisma, así que una acción nueva obliga a tocar esta lista. */
const ACCIONES_VALIDAS: Record<AccionConteo, true> = { AJUSTAR: true, FALTA_MOVIMIENTO: true, DESCARTAR: true };

/**
 * Guard del comando «registrar un conteo físico» (convención "guard por feature", 2026-09-25; Task #41, Fase M, M13e1 —
 * docs/arquitectura-casos-de-uso-2026-09-27.md). Formato del comando, ANTES de abrir la transacción y ANTES de `conPermiso`. Puro: sin
 * Prisma ni permisos.
 *
 * Las validaciones son la sección en blanco — EXACTAMENTE la que antes corría en línea, primera línea de `registrarConteoConContexto`
 * (`src/server/actions/movimientos/conteo-fisico.ts`), con el MISMO texto. Todo lo demás que esa función validaba (sección propia de la
 * sucursal, producto, disponibilidad, "tiene stock real", formato/decimales del conteo) depende de datos de base — se queda en el caso
 * de uso, mismo criterio que `guardComandoReclasificarStock` (M13d) con el chequeo "único destino idéntico al origen" — y el formato
 * de la clave I3 (UUID), si viene.
 *
 * Devuelve `aceptar(entrada)` SIN transformar nada.
 */
export function guardComandoConteoFisico(entrada: unknown, ahora: Date): ResultadoDato<ComandoConteoFisico> {
  const { seccionId, claveIdempotencia, fechaConteo, detalle, accion } = (entrada ?? {}) as { seccionId?: unknown; claveIdempotencia?: unknown; fechaConteo?: unknown; detalle?: unknown; accion?: unknown };
  if (!texto(seccionId)) return rechazar("vacio", "Elegí una sección — no se puede dejar en blanco.");
  if (typeof accion !== "string" || !Object.hasOwn(ACCIONES_VALIDAS, accion)) return rechazar("formato", "Elegí qué hacer con la diferencia del conteo.");
  const fechaValida = validarFechaOperacion(fechaConteo, ahora);
  if (!fechaValida.ok) return rechazar(fechaValida.codigo, fechaValida.mensaje);
  const detalleValido = validarTextoLibre(detalle, "El detalle", LARGO_MAXIMO_DETALLE);
  if (!detalleValido.ok) return rechazar(detalleValido.codigo, detalleValido.mensaje);
  if (claveIdempotencia !== undefined && !esClaveIdempotenciaValida(claveIdempotencia)) {
    return rechazar("formato", "Clave de reintento inválida.");
  }
  return aceptar(entrada as ComandoConteoFisico);
}
