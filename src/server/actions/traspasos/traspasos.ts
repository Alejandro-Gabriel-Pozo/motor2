"use server";

import {
  guardComandoAceptarTraspaso,
  guardComandoAprobarYEnviarTraspaso,
  guardComandoCancelarSolicitudTraspaso,
  guardComandoConfirmarReingresoTraspaso,
  guardComandoCrearEnvioDirectoTraspaso,
  guardComandoCrearSolicitudTraspaso,
  guardComandoRechazarEnvioTraspaso,
  guardComandoRechazarSolicitudTraspaso,
} from "@/core/features/traspasos/traspaso-comandos.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import { error, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { aprobarYEnviarTraspasoCasoDeUso } from "./casos-de-uso/aprobar-y-enviar-traspaso";
import { cancelarSolicitudDeTraspasoCasoDeUso } from "./casos-de-uso/cancelar-solicitud-de-traspaso";
import { rechazarSolicitudDeTraspasoCasoDeUso } from "./casos-de-uso/rechazar-solicitud-de-traspaso";
import { aceptarTraspasoCasoDeUso } from "./casos-de-uso/aceptar-traspaso";
import { rechazarEnvioDeTraspasoCasoDeUso } from "./casos-de-uso/rechazar-envio-de-traspaso";
import { confirmarReingresoDeTraspasoCasoDeUso } from "./casos-de-uso/confirmar-reingreso-de-traspaso";
import { crearSolicitudDeTraspasoCasoDeUso } from "./casos-de-uso/crear-solicitud-de-traspaso";
import { crearEnvioDirectoDeTraspasoCasoDeUso } from "./casos-de-uso/crear-envio-directo-de-traspaso";

/**
 * ===================================================================
 * TRASPASOS ENTRE SUCURSALES (Sucursales.js, líneas 1-546)
 * ===================================================================
 * Ciclo completo (ver el docstring de EstadoTraspaso en schema.prisma):
 *   PULL: destino solicita -> origen aprueba (recién ahí sale el stock,
 *         queda "en tránsito") o rechaza -> destino acepta (entra el
 *         stock) o rechaza -> origen confirma el reingreso a su stock.
 *   PUSH: origen decide enviar directo (ya aprobado al crearse, el stock
 *         sale al toque) -> destino acepta o rechaza -> (si rechaza)
 *         origen confirma el reingreso.
 *
 * A diferencia de Apps Script (cada sucursal es un proyecto separado sin
 * canal de ejecución entre sí — la Bandeja es una tabla del Catálogo
 * Central que cada lado lee/escribe async), acá no hace falta ningún
 * registro de "hosterías" ni nombre configurable: `Sucursal` ya es una
 * tabla real (Core) y `ContextoUsuario.sucursalId` ya identifica "quién
 * soy" en cada request — ver el docstring del modelo en schema.prisma.
 *
 * Gate: UNA clave por acción (decisión del dueño, 2026-09-30; reemplazan a 'proceso_transferencia_sucursal', retirada): traspaso_solicitar,
 * traspaso_enviar_directo, traspaso_aprobar, traspaso_cancelar_solicitud, traspaso_rechazar_solicitud, traspaso_aceptar,
 * traspaso_rechazar_envio y traspaso_confirmar_reingreso. Ver la Bandeja tiene la suya (traspaso_ver_bandeja, solo Ver).
 *
 * Desde la Task #41 (Fases M11a/M11b/M11c, docs/arquitectura-casos-de-uso-2026-09-27.md) este archivo tiene SOLO las ESCRITURAS, cada
 * una como adaptador fino de su caso de uso (`casos-de-uso/`), y está en `ACCIONES_CON_CASO_DE_USO`
 * (.dependency-cruiser-excepciones.cjs): no puede importar la base, Prisma en runtime, reintento/idempotencia/auditoría ni
 * `server/persistencia/`. Las LECTURAS de la Bandeja y de los selectores (`obtenerBandejaTransferencias`,
 * `listarSucursalesParaSolicitar`/`listarSucursalesParaEnviar`) se mudaron tal cual a `lecturas.ts`, al lado.
 */

export interface DatosSolicitudTraspaso {
  origenSucursalId: string;
  productoId: string;
  cantidad: number;
  seccionDestinoId: string;
  detalle?: string;
}

/**
 * PULL: yo soy Destino, le pido a `origenSucursalId`. No toca stock — solo queda SOLICITADA, pendiente de que Origen decida.
 *
 * Desde la Task #41 (Fase M11c, docs/arquitectura-casos-de-uso-2026-09-27.md) es un adaptador fino: permiso (`conPermiso`) → formato
 * (`guardComandoCrearSolicitudTraspaso`) → caso de uso (`casos-de-uso/crear-solicitud-de-traspaso.ts`: sucursal, sección propia,
 * producto transferible, cantidad y escritura, en una transacción) → `{ ok, mensaje, id, nombre }`.
 */
export async function crearSolicitudTransferencia(datos: DatosSolicitudTraspaso): Promise<ResultadoConId> {
  return conPermiso("traspaso_solicitar", async (ctx) => {
    const comando = guardComandoCrearSolicitudTraspaso(datos);
    if (!comando.ok) return error(comando.mensaje);
    const r = await crearSolicitudDeTraspasoCasoDeUso(ctx, comando.valor);
    return r.ok ? okConId(r.mensaje, r.datos.traspasoId, r.datos.productoNombre) : error(r.mensaje);
  });
}

export interface DatosEnvioDirectoTraspaso {
  destinoSucursalId: string;
  productoId: string;
  cantidad: number;
  seccionOrigenId: string;
  detalle?: string;
}

/**
 * PUSH: yo soy Origen, decido enviar directo a `destinoSucursalId` sin que me lo pidan. Valida y descuenta stock YA — queda ENVIADA.
 *
 * Desde la Task #41 (Fase M11c) es un adaptador fino: permiso → `guardComandoCrearEnvioDirectoTraspaso` → caso de uso
 * (`casos-de-uso/crear-envio-directo-de-traspaso.ts`: sucursal, sección propia, producto transferible, cantidad, stock y escritura del
 * traspaso ENVIADO + su SALIDA, en una transacción serializable; sin I3, ver el docstring del caso de uso) → `{ ok, mensaje, id, nombre }`.
 */
export async function crearEnvioDirectoTransferencia(datos: DatosEnvioDirectoTraspaso): Promise<ResultadoConId> {
  return conPermiso("traspaso_enviar_directo", async (ctx) => {
    const comando = guardComandoCrearEnvioDirectoTraspaso(datos);
    if (!comando.ok) return error(comando.mensaje);
    const r = await crearEnvioDirectoDeTraspasoCasoDeUso(ctx, comando.valor);
    return r.ok ? okConId(r.mensaje, r.datos.traspasoId, r.datos.productoNombre) : error(r.mensaje);
  });
}

/**
 * Origen aprueba una SOLICITADA: valida stock, resta en SU Kardex local, pasa a ENVIADA.
 *
 * Desde la Task #41 (Fase M11a, docs/arquitectura-casos-de-uso-2026-09-27.md) es un adaptador fino: permiso (`conPermiso`) → formato
 * (`guardComandoAprobarYEnviarTraspaso`) → caso de uso (`casos-de-uso/aprobar-y-enviar-traspaso.ts`: sección propia, transacción,
 * guard de transición, re-chequeo de disponibilidad y stock, escritura) → `aResultadoAccion`.
 */
export async function aprobarYEnviarTransferencia(id: string, seccionOrigenId: string): Promise<ResultadoAccion> {
  return conPermiso("traspaso_aprobar", async (ctx) => {
    const comando = guardComandoAprobarYEnviarTraspaso({ id, seccionOrigenId });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await aprobarYEnviarTraspasoCasoDeUso(ctx, comando.valor));
  });
}

/**
 * Destino (quien la creó) cancela SU PROPIA solicitud PULL mientras siga
 * SOLICITADA — hasta acá nunca tocó stock (ver crearSolicitudTransferencia),
 * así que no hace falta ningún reingreso, solo cerrar el traspaso. Antes
 * de esto, quien pedía una transferencia no tenía ninguna forma de
 * arrepentirse: solo podía esperar a que Origen la rechace (hallazgo de la
 * auditoría de motor2).
 *
 * Lectura + guard + escritura dentro de UNA transacción serializable, mismo
 * arreglo que rechazarTransferencia (ver su docstring): antes era un
 * check-then-act sin transacción, y dos cancelaciones simultáneas (doble
 * clic, dos pestañas) respondían las DOS «cancelada»; peor, una cancelación
 * que leía SOLICITADA justo antes de que Origen aprobara la pisaba después
 * (docs/plan-mutaciones-controladas-2026-09-25.md, Paso 4).
 *
 * Desde la Task #41 (Fase M11a) es un adaptador fino: permiso → `guardComandoCancelarSolicitudTraspaso` → caso de uso
 * (`casos-de-uso/cancelar-solicitud-de-traspaso.ts`, donde viven la transacción, el guard de transición y la escritura) →
 * `aResultadoAccion`.
 */
export async function cancelarSolicitudTransferencia(id: string): Promise<ResultadoAccion> {
  return conPermiso("traspaso_cancelar_solicitud", async (ctx) => {
    const comando = guardComandoCancelarSolicitudTraspaso({ id });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await cancelarSolicitudDeTraspasoCasoDeUso(ctx, comando.valor));
  });
}

/**
 * Origen rechaza una SOLICITADA sin haber tocado stock (nunca salió).
 *
 * Dentro de una transacción serializable, mismo arreglo que
 * rechazarTransferencia: sin ella, un rechazo que leía SOLICITADA justo
 * antes de que aprobarYEnviarTransferencia hiciera commit de la SALIDA +
 * ENVIADA escribía RECHAZADA_ORIGEN encima — el stock quedaba afuera del
 * origen y nadie lo podía reingresar (el reingreso exige RECHAZADA_DESTINO):
 * stock perdido en tránsito. Con SERIALIZABLE, el que pierde la carrera
 * reintenta, ve el estado ya cambiado y falla con el error de estado
 * (test/auditoria/traspasos-en-transito.test.ts, «stock en tránsito»).
 *
 * Desde la Task #41 (Fase M11a) es un adaptador fino: permiso → `guardComandoRechazarSolicitudTraspaso` (normaliza también el
 * motivo) → caso de uso (`casos-de-uso/rechazar-solicitud-de-traspaso.ts`) → `aResultadoAccion`.
 */
export async function rechazarSolicitudTransferencia(id: string, motivo?: string): Promise<ResultadoAccion> {
  return conPermiso("traspaso_rechazar_solicitud", async (ctx) => {
    const comando = guardComandoRechazarSolicitudTraspaso({ id, motivo });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await rechazarSolicitudDeTraspasoCasoDeUso(ctx, comando.valor));
  });
}

/**
 * Destino acepta una ENVIADA: suma en SU Kardex local, pasa a ACEPTADA. Con idempotencia I3 (clave opcional).
 *
 * Desde la Task #41 (Fase M11b, docs/arquitectura-casos-de-uso-2026-09-27.md) es un adaptador fino: permiso → formato
 * (`guardComandoAceptarTraspaso`: id, clave I3, sección) → caso de uso (`casos-de-uso/aceptar-traspaso.ts`: sección propia, transacción,
 * I3, guard de transición, re-chequeo de disponibilidad, escritura) → `aResultadoAccion`.
 */
export async function aceptarTransferencia(id: string, seccionDestinoId: string, claveIdempotencia?: string): Promise<ResultadoAccion> {
  return conPermiso("traspaso_aceptar", async (ctx) => {
    const comando = guardComandoAceptarTraspaso({ id, seccionDestinoId, claveIdempotencia });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await aceptarTraspasoCasoDeUso(ctx, comando.valor));
  });
}

/**
 * Destino rechaza una ENVIADA — todavía NO toca stock: el reingreso lo
 * confirma Origen aparte. NO usa el mecanismo de clave de idempotencia
 * (I3): no crea ninguna Operacion donde guardarla (docs/auditoria-motor2-
 * plan-i3-idempotencia-2026-09-17.md §6.2) — el riesgo acá no era "reenvío
 * del mismo intento", era el check-then-act SIN transacción confirmado
 * racy (§6.3, traspasos-en-transito.test.ts "rechazo simultáneo"). Se
 * cierra con la misma guarda de estado atómica que ya usan
 * aceptarTransferencia/confirmarReingresoTransferencia.
 *
 * Desde la Task #41 (Fase M11b) es un adaptador fino: permiso → `guardComandoRechazarEnvioTraspaso` (normaliza también el motivo) →
 * caso de uso (`casos-de-uso/rechazar-envio-de-traspaso.ts`, donde viven la transacción, el guard de transición y la escritura) →
 * `aResultadoAccion`.
 */
export async function rechazarTransferencia(id: string, motivo?: string): Promise<ResultadoAccion> {
  return conPermiso("traspaso_rechazar_envio", async (ctx) => {
    const comando = guardComandoRechazarEnvioTraspaso({ id, motivo });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await rechazarEnvioDeTraspasoCasoDeUso(ctx, comando.valor));
  });
}

/**
 * Origen confirma el reingreso tras un rechazo de destino: vuelve a sumar en SU Kardex local, pasa a CERRADA. Con idempotencia I3.
 *
 * Desde la Task #41 (Fase M11b) es un adaptador fino: permiso → `guardComandoConfirmarReingresoTraspaso` (id, clave I3) → caso de uso
 * (`casos-de-uso/confirmar-reingreso-de-traspaso.ts`) → `aResultadoAccion`.
 */
export async function confirmarReingresoTransferencia(id: string, claveIdempotencia?: string): Promise<ResultadoAccion> {
  return conPermiso("traspaso_confirmar_reingreso", async (ctx) => {
    const comando = guardComandoConfirmarReingresoTraspaso({ id, claveIdempotencia });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await confirmarReingresoDeTraspasoCasoDeUso(ctx, comando.valor));
  });
}
