import { texto } from "@/core/texto";
import { esDetalleReservadoParaReversiones } from "@/core/movimientos/public";
import { validarFechaOperacion } from "@/core/datos/fecha-operacion";
import { esClaveIdempotenciaValida } from "@/core/datos/clave-idempotencia";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { LARGO_MAXIMO_DETALLE, MAXIMO_LINEAS_POR_OPERACION, validarTextoLibre, validarTopeDeLista } from "@/core/datos/limites";
import type { DatosMovimientoInput, ProcesoGenerico } from "./movimiento.schema";

/**
 * Guard del comando «registrar un movimiento» — el motor genérico de los 9 procesos que comparten `registrarMovimiento`
 * (convención "guard por feature", 2026-09-25; Task #41, Fase M, M13c — docs/arquitectura-casos-de-uso-2026-09-27.md). Formato del
 * comando, ANTES de abrir la transacción y ANTES de `conPermiso`. Puro: sin Prisma ni permisos.
 *
 * Las 4 validaciones de entrada (items, sección, clave I3, transferencia) son EXACTAMENTE las que antes corrían en línea dentro de
 * `conPermiso` en `src/server/actions/movimientos/movimientos.ts`, en el MISMO orden y con los MISMOS textos. `guardNroFacturaCompra`
 * NO va acá: se queda en el caso de uso (`casos-de-uso/registrar-movimiento.ts`), a propósito, por el orden de mensajes (corre DESPUÉS
 * de sección/motivo/destino).
 *
 * Devuelve `aceptar(entrada)` SIN transformar nada: el hash I3 (`calcularPayloadHash`, dentro de la transacción) depende del payload
 * tal cual llegó, no de una versión normalizada acá.
 */
export function guardComandoRegistrarMovimiento(entrada: unknown, ahora: Date): ResultadoDato<DatosMovimientoInput> {
  const { proceso, items, seccionId, claveIdempotencia, seccionDestinoId, fecha, detalleLibre } = (entrada ?? {}) as {
    proceso?: unknown;
    fecha?: unknown;
    items?: unknown;
    detalleLibre?: unknown;
    seccionId?: unknown;
    claveIdempotencia?: unknown;
    seccionDestinoId?: unknown;
  };

  // 0) Endurecimiento (auditoría M13c, docs/arquitectura-casos-de-uso-2026-09-27.md): `ACCION_POR_PROCESO[datos.proceso]`
  // (src/server/actions/movimientos/movimientos.ts, ANTES de conPermiso) elige el permiso a pedir, pero también tiene entradas
  // para procesos que NO pasan por este motor (VENTA, CONTROL...) — si el que llama ya tiene ESE permiso, un payload armado a
  // mano con uno de esos procesos pasaba `conPermiso` sin que nada, DENTRO de la acción, lo frenara. Esta es la segunda barrera:
  // mismo texto que ya usa `movimientos.ts` para el proceso sin acción asociada, pero acá corre SIEMPRE, dentro de `conPermiso`.
  if (!esProcesoGenerico(proceso)) return rechazar("formato", `Proceso "${proceso}" no se registra con esta acción.`);

  if (!Array.isArray(items) || !items.length) return rechazar("vacio", "Cargá al menos un producto con cantidad.");
  const excedeLineas = validarTopeDeLista(items, "Las líneas", MAXIMO_LINEAS_POR_OPERACION);
  if (excedeLineas) return rechazar("rango", excedeLineas);
  const detalleValido = validarTextoLibre(detalleLibre, "El detalle", LARGO_MAXIMO_DETALLE);
  if (!detalleValido.ok) return rechazar(detalleValido.codigo, detalleValido.mensaje);
  // M-1 (auditoría intermedia, S-03): «Anulación de la venta/compra …» está reservado para las reversiones por anulación, que se reconocen SOLO por el comienzo de su detalle. Un ajuste manual
  // con ese comienzo no contaría como «posterior» a una venta y se la podría anular a ciegas.
  if (typeof detalleLibre === "string" && esDetalleReservadoParaReversiones(detalleLibre)) return rechazar("formato", "Ese detalle está reservado para las anulaciones: escribilo de otra forma.");
  for (const item of items) {
    const referencia = validarTextoLibre((item as { referenciaProveedor?: unknown } | null)?.referenciaProveedor, "La referencia del proveedor", LARGO_MAXIMO_DETALLE);
    if (!referencia.ok) return rechazar(referencia.codigo, referencia.mensaje);
  }
  if (!texto(seccionId)) return rechazar("vacio", "Elegí una sección.");
  const fechaValida = validarFechaOperacion(fecha, ahora);
  if (!fechaValida.ok) return rechazar(fechaValida.codigo, fechaValida.mensaje);
  if (claveIdempotencia !== undefined && !esClaveIdempotenciaValida(claveIdempotencia)) {
    return rechazar("formato", "Clave de reintento inválida.");
  }

  if (proceso === "TRANSFERENCIA") {
    if (!seccionDestinoId) return rechazar("vacio", "La sección destino no puede estar vacía.");
    if (seccionDestinoId === seccionId) {
      return rechazar("formato", "La sección destino no puede ser la misma que el origen: no habría nada que mover.");
    }
  }

  return aceptar(entrada as DatosMovimientoInput);
}

/**
 * `Record<ProcesoGenerico, true>` en vez de un array literal: si `ProcesoGenerico` (movimiento.schema.ts) gana o pierde un
 * proceso el día de mañana (cambia el `Exclude<Proceso, ...>` porque el enum de Prisma suma un valor), `tsc` exige tocar este
 * mapa en el mismo commit — no hace falta acordarse de mantenerlo sincronizado a mano.
 */
const MAPA_PROCESOS_GENERICOS: Record<ProcesoGenerico, true> = {
  COMPRA: true,
  PRODUCCION: true,
  CONSUMO: true,
  AJUSTE: true,
  TRANSFERENCIA: true,
  MERMA: true,
  DEVOLUCION_CONSIGNACION: true,
  DEVOLUCION_CLIENTE: true,
  DEVOLUCION_PROVEEDOR: true,
};

function esProcesoGenerico(proceso: unknown): proceso is ProcesoGenerico {
  return typeof proceso === "string" && Object.hasOwn(MAPA_PROCESOS_GENERICOS, proceso);
}
