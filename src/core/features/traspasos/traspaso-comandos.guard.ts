import { texto } from "@/core/texto";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { esClaveIdempotenciaValida } from "@/core/datos/clave-idempotencia";
import type {
  ComandoAceptarTraspaso,
  ComandoAprobarYEnviarTraspaso,
  ComandoCancelarSolicitudTraspaso,
  ComandoConfirmarReingresoTraspaso,
  ComandoCrearEnvioDirectoTraspaso,
  ComandoCrearSolicitudTraspaso,
  ComandoRechazarEnvioTraspaso,
  ComandoRechazarSolicitudTraspaso,
} from "./traspaso.schema";

/**
 * Guards de los COMANDOS de traspasos (Task #41, Fases M11a, M11b y M11c —docs/arquitectura-casos-de-uso-2026-09-27.md): formato, ANTES de abrir la
 * transacción. Puros: sin Prisma ni permisos. Viven aparte de `traspaso.guard.ts` (el guard de TRANSICIÓN de estado, que decide contra
 * el traspaso ya leído y lo sigue usando el caso de uso dentro de la transacción).
 *
 * Los mensajes son EXACTAMENTE los que devolvían las Server Actions de `src/server/actions/traspasos/traspasos.ts` antes de la
 * migración, y el id se normaliza igual que entonces (`texto(id)`: recorta espacios y convierte lo que llegue a string).
 */

/** Mismo texto que usaban las Server Actions de la Bandeja cuando el id del traspaso llega vacío. */
const MENSAJE_FALTA_TRASPASO = "Falta el traspaso.";

/** Mismo texto que usaba `aprobarYEnviarTransferencia` cuando la sección de origen no es de esta sucursal. */
export const MENSAJE_SECCION_ORIGEN_NO_PROPIA = "Elegí de qué sección propia sale.";

/** Mismo texto que usaban las Server Actions cuando no existe un traspaso con ese id. */
export const MENSAJE_TRASPASO_NO_ENCONTRADO = "No se encontró ese traspaso.";

function idDeTraspaso(id: unknown): ResultadoDato<string> {
  const traspasoId = texto(id);
  return traspasoId ? aceptar(traspasoId) : rechazar("vacio", MENSAJE_FALTA_TRASPASO);
}

/**
 * Guard del comando «aprobar y enviar una solicitud». Primero el id (como antes); después la sección: si no es un string, el MISMO
 * mensaje que «no es una sección propia» (antes llegaba así al `findUnique` y Prisma la rechazaba con un error crudo de validación —
 * un 500 para la pantalla). Un string —exista o no, sea de esta sucursal o no— pasa tal cual: eso lo decide el caso de uso.
 */
export function guardComandoAprobarYEnviarTraspaso(entrada: unknown): ResultadoDato<ComandoAprobarYEnviarTraspaso> {
  const { id, seccionOrigenId } = (entrada ?? {}) as { id?: unknown; seccionOrigenId?: unknown };
  const traspasoId = idDeTraspaso(id);
  if (!traspasoId.ok) return traspasoId;
  if (typeof seccionOrigenId !== "string") return rechazar("formato", MENSAJE_SECCION_ORIGEN_NO_PROPIA);
  return aceptar({ traspasoId: traspasoId.valor, seccionOrigenId });
}

/** Guard del comando «cancelar mi propia solicitud»: solo el id. */
export function guardComandoCancelarSolicitudTraspaso(entrada: unknown): ResultadoDato<ComandoCancelarSolicitudTraspaso> {
  const { id } = (entrada ?? {}) as { id?: unknown };
  const traspasoId = idDeTraspaso(id);
  if (!traspasoId.ok) return traspasoId;
  return aceptar({ traspasoId: traspasoId.valor });
}

/** Guard del comando «rechazar una solicitud»: el id, y el motivo normalizado como antes (`texto(motivo) || null`). */
export function guardComandoRechazarSolicitudTraspaso(entrada: unknown): ResultadoDato<ComandoRechazarSolicitudTraspaso> {
  const { id, motivo } = (entrada ?? {}) as { id?: unknown; motivo?: unknown };
  const traspasoId = idDeTraspaso(id);
  if (!traspasoId.ok) return traspasoId;
  return aceptar({ traspasoId: traspasoId.valor, motivo: texto(motivo) || null });
}

/*
 * Guards de la RECEPCIÓN de un envío (Task #41, Fase M11b): aceptar, rechazar el envío, confirmar el reingreso. Mismo orden de
 * chequeos que tenían las Server Actions: primero el id, después la clave I3, después (aceptar) la sección.
 */

/** Mismo texto que usaban `aceptarTransferencia` y `confirmarReingresoTransferencia` para una clave I3 que no es un UUID. */
const MENSAJE_CLAVE_REINTENTO_INVALIDA = "Clave de reintento inválida.";

/** Mismo texto que usaba `aceptarTransferencia` cuando la sección de destino no es de esta sucursal. */
export const MENSAJE_SECCION_DESTINO_NO_PROPIA = "Elegí a qué sección propia entra.";

/** Mismo texto que usaba `confirmarReingresoTransferencia` cuando el traspaso no tiene sección de origen. */
export const MENSAJE_SIN_SECCION_ORIGEN = "Este traspaso no tiene una sección de origen registrada — no se puede reingresar.";

/** Clave I3: ausente (`undefined`) → sin clave (`null`); cualquier otra cosa que no sea un UUID (un `null` o un `""` también) → inválida, como antes. */
function claveI3(claveIdempotencia: unknown): ResultadoDato<string | null> {
  if (claveIdempotencia === undefined) return aceptar(null);
  return esClaveIdempotenciaValida(claveIdempotencia) ? aceptar(claveIdempotencia) : rechazar("formato", MENSAJE_CLAVE_REINTENTO_INVALIDA);
}

/**
 * Guard del comando «aceptar un envío». La sección: si no es un string, el MISMO mensaje que «no es una sección propia» (antes llegaba
 * así al `findUnique` y Prisma la rechazaba con un error crudo de validación). Un string pasa tal cual: lo decide el caso de uso.
 */
export function guardComandoAceptarTraspaso(entrada: unknown): ResultadoDato<ComandoAceptarTraspaso> {
  const { id, seccionDestinoId, claveIdempotencia } = (entrada ?? {}) as { id?: unknown; seccionDestinoId?: unknown; claveIdempotencia?: unknown };
  const traspasoId = idDeTraspaso(id);
  if (!traspasoId.ok) return traspasoId;
  const clave = claveI3(claveIdempotencia);
  if (!clave.ok) return clave;
  if (typeof seccionDestinoId !== "string") return rechazar("formato", MENSAJE_SECCION_DESTINO_NO_PROPIA);
  return aceptar({ traspasoId: traspasoId.valor, seccionDestinoId, claveIdempotencia: clave.valor });
}

/** Guard del comando «rechazar un envío»: el id, y el motivo normalizado como antes (`texto(motivo) || null`). */
export function guardComandoRechazarEnvioTraspaso(entrada: unknown): ResultadoDato<ComandoRechazarEnvioTraspaso> {
  const { id, motivo } = (entrada ?? {}) as { id?: unknown; motivo?: unknown };
  const traspasoId = idDeTraspaso(id);
  if (!traspasoId.ok) return traspasoId;
  return aceptar({ traspasoId: traspasoId.valor, motivo: texto(motivo) || null });
}

/** Guard del comando «confirmar el reingreso»: el id y la clave I3. */
export function guardComandoConfirmarReingresoTraspaso(entrada: unknown): ResultadoDato<ComandoConfirmarReingresoTraspaso> {
  const { id, claveIdempotencia } = (entrada ?? {}) as { id?: unknown; claveIdempotencia?: unknown };
  const traspasoId = idDeTraspaso(id);
  if (!traspasoId.ok) return traspasoId;
  const clave = claveI3(claveIdempotencia);
  if (!clave.ok) return clave;
  return aceptar({ traspasoId: traspasoId.valor, claveIdempotencia: clave.valor });
}

/*
 * Guards de la CREACIÓN de un traspaso (Task #41, Fase M11c): pedir (PULL) y enviar directo (PUSH). Primero la sucursal de la otra punta
 * (vacía → el mismo texto de antes), después el formato de la sección y del producto. Que la otra punta no sea ESTA sucursal, que exista
 * y esté activa, que la sección sea propia, que el producto sea transferible y la cantidad (contra los decimales de SU unidad) lo decide
 * el caso de uso contra la base, en el orden de siempre.
 *
 * Una sección o un producto que no son string daban antes un error crudo de validación de Prisma (un 500 para la pantalla); ahora dan
 * el MISMO texto que «no es una sección propia» / «el producto no existe». Único cambio de orden, solo con entradas malformadas que la
 * pantalla nunca manda: esos dos chequeos de formato corren antes que «a vos mismo» / «sucursal no activa».
 */

/** Mismo texto que usaba `crearSolicitudTransferencia` cuando no se eligió la sucursal a la que se le pide. */
const MENSAJE_FALTA_SUCURSAL_ORIGEN = "Elegí de qué sucursal lo pedís.";

/** Mismo texto que usaba `crearEnvioDirectoTransferencia` cuando no se eligió la sucursal a la que se le manda. */
const MENSAJE_FALTA_SUCURSAL_DESTINO = "Elegí a qué sucursal se lo mandás.";

/** Mismo texto que usaba `crearSolicitudTransferencia` cuando la sección de destino no es de esta sucursal. */
export const MENSAJE_SECCION_DESTINO_SOLICITUD_NO_PROPIA = "Elegí a qué sección propia tiene que entrar.";

/** Mismo texto que usaban las dos creaciones cuando la sucursal de la otra punta no existe o está inactiva (lo decide el caso de uso). */
export const MENSAJE_SUCURSAL_NO_DISPONIBLE = "Esa sucursal no existe o no está activa.";

/** Mismo texto que usaban las dos creaciones cuando el producto no existe. */
export const MENSAJE_PRODUCTO_NO_EXISTE = "El producto no existe.";

/** Guard del comando «pedir una transferencia» (PULL). */
export function guardComandoCrearSolicitudTraspaso(entrada: unknown): ResultadoDato<ComandoCrearSolicitudTraspaso> {
  const { origenSucursalId, productoId, cantidad, seccionDestinoId, detalle } = (entrada ?? {}) as Record<string, unknown>;
  const origen = texto(origenSucursalId);
  if (!origen) return rechazar("vacio", MENSAJE_FALTA_SUCURSAL_ORIGEN);
  if (typeof seccionDestinoId !== "string") return rechazar("formato", MENSAJE_SECCION_DESTINO_SOLICITUD_NO_PROPIA);
  if (typeof productoId !== "string") return rechazar("formato", MENSAJE_PRODUCTO_NO_EXISTE);
  return aceptar({ origenSucursalId: origen, productoId, cantidad, seccionDestinoId, detalle: texto(detalle) || null });
}

/** Guard del comando «enviar directo» (PUSH). */
export function guardComandoCrearEnvioDirectoTraspaso(entrada: unknown): ResultadoDato<ComandoCrearEnvioDirectoTraspaso> {
  const { destinoSucursalId, productoId, cantidad, seccionOrigenId, detalle } = (entrada ?? {}) as Record<string, unknown>;
  const destino = texto(destinoSucursalId);
  if (!destino) return rechazar("vacio", MENSAJE_FALTA_SUCURSAL_DESTINO);
  if (typeof seccionOrigenId !== "string") return rechazar("formato", MENSAJE_SECCION_ORIGEN_NO_PROPIA);
  if (typeof productoId !== "string") return rechazar("formato", MENSAJE_PRODUCTO_NO_EXISTE);
  return aceptar({ destinoSucursalId: destino, productoId, cantidad, seccionOrigenId, detalle: texto(detalle) || null });
}
