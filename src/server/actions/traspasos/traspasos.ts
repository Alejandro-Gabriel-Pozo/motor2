"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { texto } from "@/core/texto";
import { esNumeroFinito } from "@/core/numero";
import { redondearACantidadDeUnidad, tieneStockReal } from "@/core/movimientos/transiciones";
import { calcularSaldoTotal, obtenerSeccionPropia, validarStockSuficiente } from "@/core/movimientos/stock";
import { productoDisponibleEn } from "@/core/catalogo/disponibilidad-producto-consulta";
import { conTransaccionSerializable } from "@/core/movimientos/con-reintento";
import { guardTransicionTraspaso } from "@/core/features/traspasos/traspaso.guard";
import { calcularPayloadHash, chequearIdempotencia, esClaveIdempotenciaValida, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "@/core/movimientos/idempotencia";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { requerirVerEnSucursal } from "../con-sesion";

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
 * Gate único: 'proceso_transferencia_sucursal' (ya seedeada desde Core,
 * anticipando esta porción) — mismo criterio que Apps Script
 * (requierePermiso_ en cada función de escritura, nunca en la lectura de
 * la Bandeja).
 */

/**
 * Producto elegible para traspasar — existe, tiene stock real, y está
 * disponible en TODAS las sucursales dadas (docs/plan-disponibilidad-por-
 * sucursal-2026-09-23.md §5.5). Un traspaso tiene origen y destino: si el
 * destino no lo tiene disponible, el stock aterriza en una sucursal que lo
 * filtra de su Stock consolidado y su Valuación — stock invisible. Por eso
 * quien llama pasa las sucursales que corresponda chequear en ese punto del
 * ciclo (origen+destino al crear, la que corresponda al re-chequear en cada
 * paso siguiente).
 */
async function obtenerProductoTransferible(
  productoId: string,
  sucursales: { sucursalId: string; sucursalNombre: string }[],
  tx: Prisma.TransactionClient | typeof prisma = prisma
) {
  const producto = await tx.producto.findUnique({ where: { id: productoId }, include: { unidadStock: true } });
  if (!producto) return { ok: false as const, mensaje: "El producto no existe." };
  if (!tieneStockReal(producto.tipo, producto.seProduce)) {
    return { ok: false as const, mensaje: `"${producto.nombre}" no tiene stock real — no se puede transferir.` };
  }
  for (const s of sucursales) {
    if (!(await productoDisponibleEn(s.sucursalId, producto.id, tx))) {
      return { ok: false as const, mensaje: `«${producto.nombre}» no está disponible en «${s.sucursalNombre}»: activalo allá antes de enviar.` };
    }
  }
  return { ok: true as const, producto };
}

async function escribirMovimientoTraspaso(
  tx: Prisma.TransactionClient,
  ctx: ContextoUsuario,
  traspasoId: string,
  proceso: "TRANSFERENCIA_SALIDA_SUCURSAL" | "TRANSFERENCIA_ENTRADA_SUCURSAL" | "REINGRESO_TRANSFERENCIA_SUCURSAL",
  productoId: string,
  seccionId: string,
  cantidadFirmada: number,
  detalle: string,
  /** I3 — solo lo mandan aceptarTransferencia/confirmarReingresoTransferencia (las 2 de las 5 llamadas a este helper que están en el alcance de la política, docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md §11.5); aprobarYEnviarTransferencia no manda nada acá y queda sin cambios. */
  idempotencia?: { claveIdempotencia: string; payloadHash: string }
) {
  const operacion = await tx.operacion.create({
    data: {
      sucursalId: ctx.sucursalId,
      proceso,
      fecha: new Date(),
      usuarioId: ctx.usuarioId,
      claveIdempotencia: idempotencia?.claveIdempotencia ?? null,
      payloadHash: idempotencia?.payloadHash ?? null,
    },
  });
  await tx.movimientoStock.create({
    data: {
      operacionId: operacion.id,
      productoId,
      seccionId,
      proceso,
      cantidad: cantidadFirmada,
      detalle,
      precioTotal: 0,
      precioPorUnidadStock: 0,
      traspasoSucursalId: traspasoId,
    },
  });
  return operacion;
}

export interface DatosSolicitudTraspaso {
  origenSucursalId: string;
  productoId: string;
  cantidad: number;
  seccionDestinoId: string;
  detalle?: string;
}

/** PULL: yo soy Destino, le pido a `origenSucursalId`. No toca stock — solo queda SOLICITADA, pendiente de que Origen decida. */
export async function crearSolicitudTransferencia(datos: DatosSolicitudTraspaso): Promise<ResultadoConId> {
  return conPermiso("proceso_transferencia_sucursal", async (ctx) => {
    const origenSucursalId = texto(datos.origenSucursalId);
    if (!origenSucursalId) return error("Elegí de qué sucursal lo pedís.");
    if (origenSucursalId === ctx.sucursalId) return error("No podés pedirte una transferencia a vos mismo.");
    if (!(datos.cantidad > 0)) return error("La cantidad debe ser mayor a 0.");
    if (!esNumeroFinito(datos.cantidad)) return error("La cantidad no es un número válido.");

    const origen = await prisma.sucursal.findUnique({ where: { id: origenSucursalId } });
    if (!origen || !origen.activo) return error("Esa sucursal no existe o no está activa.");

    const seccionDestino = await obtenerSeccionPropia(datos.seccionDestinoId, ctx.sucursalId);
    if (!seccionDestino) return error("Elegí a qué sección propia tiene que entrar.");

    const resProducto = await obtenerProductoTransferible(datos.productoId, [
      { sucursalId: origenSucursalId, sucursalNombre: origen.nombre },
      { sucursalId: ctx.sucursalId, sucursalNombre: ctx.sucursalNombre },
    ]);
    if (!resProducto.ok) return error(resProducto.mensaje);

    // Mismo redondeo que crearEnvioDirectoTransferencia (PUSH) — sin esto,
    // una cantidad sin redondear entraba al Kardex recién en aprobar/
    // aceptar/reingresar, violando el invariante de que toda cantidad que
    // llega a MovimientoStock ya está redondeada a los decimales de su unidad.
    const cantidad = redondearACantidadDeUnidad(datos.cantidad, resProducto.producto.unidadStock.decimales);

    const traspaso = await prisma.traspasoSucursal.create({
      data: {
        origenSucursalId,
        destinoSucursalId: ctx.sucursalId,
        productoId: datos.productoId,
        cantidad,
        seccionDestinoId: seccionDestino.id,
        iniciadoPor: "DESTINO",
        estado: "SOLICITADA",
        creadoPorId: ctx.usuarioId,
        detalle: texto(datos.detalle) || null,
      },
    });

    return { ok: true, mensaje: `Solicitud enviada a "${origen.nombre}".`, id: traspaso.id, nombre: resProducto.producto.nombre };
  });
}

export interface DatosEnvioDirectoTraspaso {
  destinoSucursalId: string;
  productoId: string;
  cantidad: number;
  seccionOrigenId: string;
  detalle?: string;
}

/** PUSH: yo soy Origen, decido enviar directo a `destinoSucursalId` sin que me lo pidan. Valida y descuenta stock YA — queda ENVIADA. */
export async function crearEnvioDirectoTransferencia(datos: DatosEnvioDirectoTraspaso): Promise<ResultadoConId> {
  return conPermiso("proceso_transferencia_sucursal", async (ctx) => {
    const destinoSucursalId = texto(datos.destinoSucursalId);
    if (!destinoSucursalId) return error("Elegí a qué sucursal se lo mandás.");
    if (destinoSucursalId === ctx.sucursalId) return error("No podés mandarte una transferencia a vos mismo.");
    if (!(datos.cantidad > 0)) return error("La cantidad debe ser mayor a 0.");
    if (!esNumeroFinito(datos.cantidad)) return error("La cantidad no es un número válido.");

    const destino = await prisma.sucursal.findUnique({ where: { id: destinoSucursalId } });
    if (!destino || !destino.activo) return error("Esa sucursal no existe o no está activa.");

    const seccionOrigen = await obtenerSeccionPropia(datos.seccionOrigenId, ctx.sucursalId);
    if (!seccionOrigen) return error("Elegí de qué sección propia sale.");

    const resProducto = await obtenerProductoTransferible(datos.productoId, [
      { sucursalId: ctx.sucursalId, sucursalNombre: ctx.sucursalNombre },
      { sucursalId: destinoSucursalId, sucursalNombre: destino.nombre },
    ]);
    if (!resProducto.ok) return error(resProducto.mensaje);

    const chequeoStock = await validarStockSuficiente(datos.productoId, seccionOrigen.id, datos.cantidad);
    if (!chequeoStock.ok) {
      return error(`Stock insuficiente de "${resProducto.producto.nombre}" en "${seccionOrigen.nombre}". Actual: ${chequeoStock.actual}, requerido: ${chequeoStock.requerido}.`);
    }

    const resultado = await conTransaccionSerializable(async (tx) => {
      const disponible = await calcularSaldoTotal(datos.productoId, seccionOrigen.id, tx);
      if (disponible < datos.cantidad) {
        return error(`Stock insuficiente de "${resProducto.producto.nombre}" en "${seccionOrigen.nombre}". Actual: ${disponible}, requerido: ${datos.cantidad}.`);
      }

      const cantidad = redondearACantidadDeUnidad(datos.cantidad, resProducto.producto.unidadStock.decimales);
      const ahora = new Date();
      const traspaso = await tx.traspasoSucursal.create({
        data: {
          origenSucursalId: ctx.sucursalId,
          destinoSucursalId,
          productoId: datos.productoId,
          cantidad,
          seccionOrigenId: seccionOrigen.id,
          iniciadoPor: "ORIGEN",
          estado: "ENVIADA",
          creadoPorId: ctx.usuarioId,
          detalle: texto(datos.detalle) || null,
          fechaDecisionOrigen: ahora,
          decididoPorOrigenId: ctx.usuarioId,
        },
      });

      await escribirMovimientoTraspaso(
        tx, ctx, traspaso.id, "TRANSFERENCIA_SALIDA_SUCURSAL", datos.productoId, seccionOrigen.id, -cantidad,
        `Transferencia a sucursal "${destino.nombre}".`
      );

      return { ok: true as const, mensaje: `Enviado a "${destino.nombre}". Se descontó ${cantidad} ${resProducto.producto.unidadStock.nombre} de "${resProducto.producto.nombre}" en "${seccionOrigen.nombre}".`, id: traspaso.id, nombre: resProducto.producto.nombre };
    });

    return resultado;
  });
}

async function buscarTraspaso(id: string, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  return tx.traspasoSucursal.findUnique({ where: { id }, include: { producto: { include: { unidadStock: true } } } });
}

/** Origen aprueba una SOLICITADA: valida stock, resta en SU Kardex local, pasa a ENVIADA. */
export async function aprobarYEnviarTransferencia(id: string, seccionOrigenId: string): Promise<ResultadoAccion> {
  return conPermiso("proceso_transferencia_sucursal", async (ctx) => {
    const idTraspaso = texto(id);
    if (!idTraspaso) return error("Falta el traspaso.");

    const seccionOrigen = await obtenerSeccionPropia(seccionOrigenId, ctx.sucursalId);
    if (!seccionOrigen) return error("Elegí de qué sección propia sale.");

    return conTransaccionSerializable(async (tx) => {
      const traspaso = await buscarTraspaso(idTraspaso, tx);
      if (!traspaso) return error("No se encontró ese traspaso.");
      const transicion = guardTransicionTraspaso(traspaso, "aprobar", ctx.sucursalId);
      if (!transicion.ok) return error(transicion.mensaje);

      const destino = await tx.sucursal.findUniqueOrThrow({ where: { id: traspaso.destinoSucursalId } });
      // El stock sale de acá recién ahora — re-chequea disponibilidad en origen Y destino (pudo haber cambiado desde la solicitud).
      const resProducto = await obtenerProductoTransferible(
        traspaso.productoId,
        [{ sucursalId: ctx.sucursalId, sucursalNombre: ctx.sucursalNombre }, { sucursalId: destino.id, sucursalNombre: destino.nombre }],
        tx
      );
      if (!resProducto.ok) return error(resProducto.mensaje);

      const cantidad = Number(traspaso.cantidad);
      const disponible = await calcularSaldoTotal(traspaso.productoId, seccionOrigen.id, tx);
      if (disponible < cantidad) {
        return error(`Stock insuficiente de "${traspaso.producto.nombre}" en "${seccionOrigen.nombre}". Actual: ${disponible}, requerido: ${cantidad}.`);
      }

      await escribirMovimientoTraspaso(
        tx, ctx, traspaso.id, "TRANSFERENCIA_SALIDA_SUCURSAL", traspaso.productoId, seccionOrigen.id, -cantidad,
        `Transferencia a sucursal "${destino.nombre}".`
      );

      await tx.traspasoSucursal.update({
        where: { id: traspaso.id },
        data: { seccionOrigenId: seccionOrigen.id, estado: transicion.estadoNuevo, fechaDecisionOrigen: new Date(), decididoPorOrigenId: ctx.usuarioId },
      });

      return ok(`Aprobado y enviado a "${destino.nombre}".`);
    });
  });
}

/**
 * Destino (quien la creó) cancela SU PROPIA solicitud PULL mientras siga
 * SOLICITADA — hasta acá nunca tocó stock (ver crearSolicitudTransferencia),
 * así que no hace falta ningún reingreso, solo cerrar el traspaso. Antes
 * de esto, quien pedía una transferencia no tenía ninguna forma de
 * arrepentirse: solo podía esperar a que Origen la rechace (hallazgo de la
 * auditoría de motor2).
 */
export async function cancelarSolicitudTransferencia(id: string): Promise<ResultadoAccion> {
  return conPermiso("proceso_transferencia_sucursal", async (ctx) => {
    const idTraspaso = texto(id);
    if (!idTraspaso) return error("Falta el traspaso.");

    const traspaso = await buscarTraspaso(idTraspaso);
    if (!traspaso) return error("No se encontró ese traspaso.");
    const transicion = guardTransicionTraspaso(traspaso, "cancelar_solicitud", ctx.sucursalId);
    if (!transicion.ok) return error(transicion.mensaje);

    await prisma.traspasoSucursal.update({
      where: { id: idTraspaso },
      data: { estado: transicion.estadoNuevo, fechaCierre: new Date(), cerradoPorId: ctx.usuarioId },
    });

    return ok("Solicitud cancelada.");
  });
}

/** Origen rechaza una SOLICITADA sin haber tocado stock (nunca salió). */
export async function rechazarSolicitudTransferencia(id: string, motivo?: string): Promise<ResultadoAccion> {
  return conPermiso("proceso_transferencia_sucursal", async (ctx) => {
    const idTraspaso = texto(id);
    if (!idTraspaso) return error("Falta el traspaso.");

    const traspaso = await buscarTraspaso(idTraspaso);
    if (!traspaso) return error("No se encontró ese traspaso.");
    const transicion = guardTransicionTraspaso(traspaso, "rechazar_solicitud", ctx.sucursalId);
    if (!transicion.ok) return error(transicion.mensaje);

    await prisma.traspasoSucursal.update({
      where: { id: idTraspaso },
      data: { estado: transicion.estadoNuevo, fechaDecisionOrigen: new Date(), decididoPorOrigenId: ctx.usuarioId, motivoRechazoOrigen: texto(motivo) || null },
    });

    return ok("Solicitud rechazada.");
  });
}

/** Destino acepta una ENVIADA: suma en SU Kardex local, pasa a ACEPTADA. */
export async function aceptarTransferencia(id: string, seccionDestinoId: string, claveIdempotencia?: string): Promise<ResultadoAccion> {
  return conPermiso("proceso_transferencia_sucursal", async (ctx) => {
    const idTraspaso = texto(id);
    if (!idTraspaso) return error("Falta el traspaso.");
    if (claveIdempotencia !== undefined && !esClaveIdempotenciaValida(claveIdempotencia)) {
      return error("Clave de reintento inválida.");
    }

    const seccionDestino = await obtenerSeccionPropia(seccionDestinoId, ctx.sucursalId);
    if (!seccionDestino) return error("Elegí a qué sección propia entra.");

    return conTransaccionSerializable(async (tx) => {
      const payloadHash = claveIdempotencia ? calcularPayloadHash("ACEPTAR_TRASPASO", ctx.sucursalId, { id: idTraspaso, seccionDestinoId }) : "";
      const chequeo = await chequearIdempotencia(tx, claveIdempotencia, payloadHash);
      if (chequeo.estado === "duplicado") return ok(chequeo.mensaje);
      if (chequeo.estado === "conflicto") return error(MENSAJE_CONFLICTO_IDEMPOTENCIA);

      const traspaso = await buscarTraspaso(idTraspaso, tx);
      if (!traspaso) return error("No se encontró ese traspaso.");
      const transicion = guardTransicionTraspaso(traspaso, "aceptar", ctx.sucursalId);
      if (!transicion.ok) return error(transicion.mensaje);
      // El stock entra a ESTA sucursal recién ahora — re-chequea disponibilidad acá (pudo haber cambiado desde el envío).
      const resProducto = await obtenerProductoTransferible(traspaso.productoId, [{ sucursalId: ctx.sucursalId, sucursalNombre: ctx.sucursalNombre }], tx);
      if (!resProducto.ok) return error(resProducto.mensaje);

      const cantidad = Number(traspaso.cantidad);
      const origen = await tx.sucursal.findUniqueOrThrow({ where: { id: traspaso.origenSucursalId } });
      const operacion = await escribirMovimientoTraspaso(
        tx, ctx, traspaso.id, "TRANSFERENCIA_ENTRADA_SUCURSAL", traspaso.productoId, seccionDestino.id, cantidad,
        `Transferencia recibida de sucursal "${origen.nombre}".`,
        claveIdempotencia ? { claveIdempotencia, payloadHash } : undefined
      );

      await tx.traspasoSucursal.update({
        where: { id: traspaso.id },
        data: { seccionDestinoId: seccionDestino.id, estado: transicion.estadoNuevo, fechaDecisionDestino: new Date(), decididoPorDestinoId: ctx.usuarioId },
      });

      const mensaje = `Recibido de "${origen.nombre}".`;
      if (claveIdempotencia) {
        await tx.operacion.update({ where: { id: operacion.id }, data: { resultadoMensaje: mensaje } });
      }
      return ok(mensaje);
    });
  });
}

/**
 * Destino rechaza una ENVIADA — todavía NO toca stock: el reingreso lo
 * confirma Origen aparte. NO usa el mecanismo de clave de idempotencia
 * (I3): no crea ninguna Operacion donde guardarla (docs/auditoria-motor2-
 * plan-i3-idempotencia-2026-09-17.md §6.2) — el riesgo acá no era "reenvío
 * del mismo intento", era el check-then-act SIN transacción confirmado
 * racy (§6.3, traspasos-en-transito.test.ts "rechazo simultáneo": dos
 * rechazos simultáneos con motivo distinto respondían los DOS ok:true, el
 * segundo pisaba el motivo del primero sin que nadie se enterara). Se
 * cierra con la misma guarda de estado atómica que ya usan
 * aceptarTransferencia/confirmarReingresoTransferencia — SERIALIZABLE hace
 * que el segundo, al reintentar, vea el estado ya cambiado por el primero
 * y falle con un error explícito en vez de pisarlo en silencio.
 */
export async function rechazarTransferencia(id: string, motivo?: string): Promise<ResultadoAccion> {
  return conPermiso("proceso_transferencia_sucursal", async (ctx) => {
    const idTraspaso = texto(id);
    if (!idTraspaso) return error("Falta el traspaso.");

    return conTransaccionSerializable(async (tx) => {
      const traspaso = await buscarTraspaso(idTraspaso, tx);
      if (!traspaso) return error("No se encontró ese traspaso.");
      const transicion = guardTransicionTraspaso(traspaso, "rechazar_envio", ctx.sucursalId);
      if (!transicion.ok) return error(transicion.mensaje);

      await tx.traspasoSucursal.update({
        where: { id: idTraspaso },
        data: { estado: transicion.estadoNuevo, fechaDecisionDestino: new Date(), decididoPorDestinoId: ctx.usuarioId, motivoRechazoDestino: texto(motivo) || null },
      });

      return ok("Transferencia rechazada — queda pendiente que el origen confirme el reingreso a su stock.");
    });
  });
}

/** Origen confirma el reingreso tras un rechazo de destino: vuelve a sumar en SU Kardex local, pasa a CERRADA. */
export async function confirmarReingresoTransferencia(id: string, claveIdempotencia?: string): Promise<ResultadoAccion> {
  return conPermiso("proceso_transferencia_sucursal", async (ctx) => {
    const idTraspaso = texto(id);
    if (!idTraspaso) return error("Falta el traspaso.");
    if (claveIdempotencia !== undefined && !esClaveIdempotenciaValida(claveIdempotencia)) {
      return error("Clave de reintento inválida.");
    }

    return conTransaccionSerializable(async (tx) => {
      const payloadHash = claveIdempotencia ? calcularPayloadHash("REINGRESO_TRASPASO", ctx.sucursalId, { id: idTraspaso }) : "";
      const chequeo = await chequearIdempotencia(tx, claveIdempotencia, payloadHash);
      if (chequeo.estado === "duplicado") return ok(chequeo.mensaje);
      if (chequeo.estado === "conflicto") return error(MENSAJE_CONFLICTO_IDEMPOTENCIA);

      const traspaso = await buscarTraspaso(idTraspaso, tx);
      if (!traspaso) return error("No se encontró ese traspaso.");
      const transicion = guardTransicionTraspaso(traspaso, "confirmar_reingreso", ctx.sucursalId);
      if (!transicion.ok) return error(transicion.mensaje);
      if (!traspaso.seccionOrigenId) return error("Este traspaso no tiene una sección de origen registrada — no se puede reingresar.");

      const cantidad = Number(traspaso.cantidad);
      const destino = await tx.sucursal.findUniqueOrThrow({ where: { id: traspaso.destinoSucursalId } });
      const seccionOrigen = await tx.seccion.findUniqueOrThrow({ where: { id: traspaso.seccionOrigenId } });
      const operacion = await escribirMovimientoTraspaso(
        tx, ctx, traspaso.id, "REINGRESO_TRANSFERENCIA_SUCURSAL", traspaso.productoId, traspaso.seccionOrigenId, cantidad,
        `Reingreso — rechazado por sucursal "${destino.nombre}".`,
        claveIdempotencia ? { claveIdempotencia, payloadHash } : undefined
      );

      await tx.traspasoSucursal.update({
        where: { id: traspaso.id },
        data: { estado: transicion.estadoNuevo, fechaCierre: new Date(), cerradoPorId: ctx.usuarioId },
      });

      const mensaje = `Reingreso confirmado: se sumó de nuevo ${cantidad} de "${traspaso.producto.nombre}" en "${seccionOrigen.nombre}".`;
      if (claveIdempotencia) {
        await tx.operacion.update({ where: { id: operacion.id }, data: { resultadoMensaje: mensaje } });
      }
      return ok(mensaje);
    });
  });
}

const INCLUDE_BANDEJA = {
  producto: { include: { unidadStock: true } },
  origenSucursal: true,
  destinoSucursal: true,
  seccionOrigen: true,
  seccionDestino: true,
  creadoPor: true,
} satisfies Prisma.TraspasoSucursalInclude;

const TAMANO_PAGINA_HISTORIAL = 30;

/**
 * Todo lo que sigue "en curso" — quien las cumple nunca es historial. Las
 * primeras 3 son "hay algo para ACCIONAR" de este lado (paraAprobar/
 * paraAceptar/paraReingreso); las últimas 2 son lo que ESTA sucursal
 * INICIÓ (iniciadoPor) y sigue esperando que decida la otra — antes
 * faltaban del todo, así que una solicitud/envío propio en curso se
 * mezclaba con el historial ya resuelto (hallazgo de la auditoría de
 * motor2). `iniciadoPor` es necesario en la condición de ENVIADA: un PULL
 * que Origen ya aprobó también queda ENVIADA con origenSucursalId=yo,
 * pero ahí lo inició Destino (paraAceptar del otro lado) — yo ya hice lo
 * mío, no estoy "esperando" en el mismo sentido que un PUSH propio.
 */
function condicionesEnCurso(sucursalId: string): Prisma.TraspasoSucursalWhereInput[] {
  return [
    { origenSucursalId: sucursalId, estado: "SOLICITADA" },
    { destinoSucursalId: sucursalId, estado: "ENVIADA" },
    { origenSucursalId: sucursalId, estado: "RECHAZADA_DESTINO" },
    { destinoSucursalId: sucursalId, estado: "SOLICITADA", iniciadoPor: "DESTINO" }, // mi propia solicitud PULL, esperando que Origen decida
    { origenSucursalId: sucursalId, estado: "ENVIADA", iniciadoPor: "ORIGEN" }, // mi propio envío PUSH, esperando que Destino decida
  ];
}

/**
 * Lectura de la Bandeja — abierta (leer no necesita el permiso de
 * escritura, mismo criterio que el resto del proyecto). Separa lo que hay
 * que ACCIONAR (siempre un puñado de traspasos en tránsito, sin límite:
 * por diseño de negocio nunca crece) del historial (crece con cada
 * traspaso resuelto desde que existe la sucursal — paginado por cursor,
 * hallazgo de la diligencia de motor2: "bandeja de traspasos sin límite").
 */
export async function obtenerBandejaTransferencias(sucursalId: string, cursorHistorial?: string) {
  await requerirVerEnSucursal(sucursalId, "proceso_transferencia_sucursal");
  const [enCurso, historialMasUno] = await Promise.all([
    prisma.traspasoSucursal.findMany({
      where: { OR: condicionesEnCurso(sucursalId) },
      include: INCLUDE_BANDEJA,
      orderBy: { creadoEn: "desc" },
    }),
    prisma.traspasoSucursal.findMany({
      where: {
        AND: [{ OR: [{ origenSucursalId: sucursalId }, { destinoSucursalId: sucursalId }] }, { NOT: { OR: condicionesEnCurso(sucursalId) } }],
      },
      include: INCLUDE_BANDEJA,
      orderBy: [{ creadoEn: "desc" }, { id: "desc" }],
      take: TAMANO_PAGINA_HISTORIAL + 1,
      ...(cursorHistorial ? { cursor: { id: cursorHistorial }, skip: 1 } : {}),
    }),
  ]);

  const paraAprobar = enCurso.filter((t) => t.origenSucursalId === sucursalId && t.estado === "SOLICITADA");
  const paraAceptar = enCurso.filter((t) => t.destinoSucursalId === sucursalId && t.estado === "ENVIADA");
  const paraReingreso = enCurso.filter((t) => t.origenSucursalId === sucursalId && t.estado === "RECHAZADA_DESTINO");
  // Lo que ESTA sucursal inició y sigue esperando que decida la otra — nada para accionar acá, solo visibilidad (y, para la solicitud PULL propia, poder cancelarla).
  const esperando = enCurso.filter(
    (t) =>
      (t.destinoSucursalId === sucursalId && t.estado === "SOLICITADA" && t.iniciadoPor === "DESTINO") ||
      (t.origenSucursalId === sucursalId && t.estado === "ENVIADA" && t.iniciadoPor === "ORIGEN")
  );

  const hayMasHistorial = historialMasUno.length > TAMANO_PAGINA_HISTORIAL;
  const historial = hayMasHistorial ? historialMasUno.slice(0, TAMANO_PAGINA_HISTORIAL) : historialMasUno;

  return {
    paraAprobar,
    paraAceptar,
    paraReingreso,
    esperando,
    historial,
    nextCursorHistorial: hayMasHistorial ? historial[historial.length - 1].id : null,
  };
}

/** Otras sucursales activas (nunca la propia) — para los <select> de origen/destino. */
export async function listarSucursalesDisponibles(sucursalId: string) {
  await requerirVerEnSucursal(sucursalId, "proceso_transferencia_sucursal");
  return prisma.sucursal.findMany({ where: { activo: true, id: { not: sucursalId } }, orderBy: { nombre: "asc" } });
}
