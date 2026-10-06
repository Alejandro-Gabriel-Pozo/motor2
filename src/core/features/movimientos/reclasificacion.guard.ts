import { texto } from "@/core/texto";
import { validarFechaOperacion } from "@/core/datos/fecha-operacion";
import { esClaveIdempotenciaValida } from "@/core/datos/clave-idempotencia";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { LARGO_MAXIMO_DETALLE, MAXIMO_DESTINOS_RECLASIFICACION, validarTextoLibre, validarTopeDeLista } from "@/core/datos/limites";
import type { ComandoReclasificarStock } from "./reclasificacion.schema";

/**
 * Guard del comando «reclasificar stock» (convención "guard por feature", 2026-09-25; Task #41, Fase M, M13d —
 * docs/arquitectura-casos-de-uso-2026-09-27.md). Formato del comando, ANTES de abrir la transacción y ANTES de `conPermiso`. Puro: sin
 * Prisma ni permisos.
 *
 * Las 5 validaciones (producto, sección de origen, destinos vacío, clave I3, sección de cada destino) son EXACTAMENTE las que antes
 * corrían en línea dentro de `conPermiso` en `src/server/actions/stock/reclasificacion.ts`, en el MISMO orden y con los MISMOS textos.
 * El chequeo "único destino idéntico al origen" NO va acá: necesita comparar contra la sección de origen ya confirmada como propia de
 * la sucursal (dato de base), y por orden de mensajes corre DESPUÉS de esas dos confirmaciones — se queda en el caso de uso, mismo
 * criterio que M13c con `guardNroFacturaCompra`.
 *
 * Devuelve `aceptar(entrada)` SIN transformar nada: el hash I3 (`calcularPayloadHash`, dentro de la transacción) depende del payload
 * tal cual llegó, no de una versión normalizada acá.
 */
export function guardComandoReclasificarStock(entrada: unknown, ahora: Date): ResultadoDato<ComandoReclasificarStock> {
  const { productoId, seccionOrigenId, destinos, claveIdempotencia, fecha, detalle } = (entrada ?? {}) as {
    detalle?: unknown;
    productoId?: unknown;
    fecha?: unknown;
    seccionOrigenId?: unknown;
    destinos?: unknown;
    claveIdempotencia?: unknown;
  };

  if (!texto(productoId)) return rechazar("vacio", "Elegí un producto.");
  if (!texto(seccionOrigenId)) return rechazar("vacio", "Elegí la sección de origen — no se puede dejar en blanco.");
  if (!Array.isArray(destinos) || !destinos.length) return rechazar("vacio", "Agregá al menos un destino.");
  const excedeDestinos = validarTopeDeLista(destinos, "Los destinos", MAXIMO_DESTINOS_RECLASIFICACION);
  if (excedeDestinos) return rechazar("rango", excedeDestinos);
  const fechaValida = validarFechaOperacion(fecha, ahora);
  if (!fechaValida.ok) return rechazar(fechaValida.codigo, fechaValida.mensaje);
  const detalleValido = validarTextoLibre(detalle, "El detalle", LARGO_MAXIMO_DETALLE);
  if (!detalleValido.ok) return rechazar(detalleValido.codigo, detalleValido.mensaje);
  if (claveIdempotencia !== undefined && !esClaveIdempotenciaValida(claveIdempotencia)) {
    return rechazar("formato", "Clave de reintento inválida.");
  }
  for (const d of destinos) {
    const seccionId = (d as { seccionId?: unknown } | null)?.seccionId;
    if (!texto(seccionId)) return rechazar("vacio", "Cada destino necesita una sección — no se puede dejar en blanco.");
  }

  return aceptar(entrada as ComandoReclasificarStock);
}
