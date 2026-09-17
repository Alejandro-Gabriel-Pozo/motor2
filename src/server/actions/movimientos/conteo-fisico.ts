"use server";

import type { AccionConteo, EstadoConteo } from "@prisma/client";
import { prisma } from "@/lib/db";
import { texto } from "@/core/texto";
import { redondearACantidadDeUnidad, tieneStockReal } from "@/core/movimientos/transiciones";
import { calcularSaldoPorLote, calcularSaldoTotal } from "@/core/movimientos/stock";
import { conTransaccionSerializable } from "@/core/movimientos/con-reintento";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";

/**
 * Port de ACCIONES_CONTEO_FISICO (Stock.js:1066-1088): qué hacer con la
 * diferencia encontrada. AJUSTAR escribe el movimiento de corrección;
 * FALTA_MOVIMIENTO deja el conteo pendiente SIN tocar stock (evita el
 * doble conteo cuando lo que falta es cargar una compra/venta real);
 * DESCARTAR no ajusta y no cuenta como conteo válido.
 */
const ACCIONES_CONTEO: Record<AccionConteo, { ajusta: boolean; estado: EstadoConteo }> = {
  AJUSTAR: { ajusta: true, estado: "RESUELTO" },
  FALTA_MOVIMIENTO: { ajusta: false, estado: "PENDIENTE" },
  DESCARTAR: { ajusta: false, estado: "DESCARTADO" },
};

export interface DatosConteoFisico {
  productoId: string;
  seccionId: string;
  /** El LOTE contado (null = "total, sin lote puntual" — misma semántica que Stock.js). */
  loteVencimiento?: Date | null;
  conteoReal: number;
  fechaConteo: Date;
  accion: AccionConteo;
  detalle?: string;
}

/**
 * Port de _registrarConteoFisicoSinRecalculo_ (Stock.js:1523-1649) — camino
 * PROPIO, no pasa por registrarMovimiento (Movimientos.js nunca lo hace
 * pasar por armarRegistroMovimiento_ tampoco). Mismo motivo que Apps
 * Script: Control es un proceso distinto de Ajuste (permite distinguir
 * "conteo físico formal" de "corrección manual suelta"), con su propia
 * bitácora (ConteoFisico) además del Kardex.
 */
export async function registrarConteoFisico(datos: DatosConteoFisico): Promise<ResultadoAccion> {
  return conPermiso("proceso_control", async (ctx) => {
    if (!texto(datos.seccionId)) return error("Elegí una sección — no se puede dejar en blanco.");
    if (!(datos.conteoReal >= 0)) return error("El conteo real debe ser un número mayor o igual a 0.");

    return conTransaccionSerializable(async (tx) => {
      const producto = await tx.producto.findUnique({ where: { id: datos.productoId }, include: { unidadStock: true } });
      if (!producto || !producto.activo) return error("El producto no existe o no está activo.");
      if (!tieneStockReal(producto.tipo, producto.seProduce)) {
        return error(`El conteo físico es sobre materias primas (MP) o productos "Se produce", no sobre PV comunes.`);
      }

      const conteoReal = redondearACantidadDeUnidad(datos.conteoReal, producto.unidadStock.decimales);
      const loteVencimiento = datos.loteVencimiento ?? null;
      const saldoSistema = loteVencimiento
        ? await calcularSaldoPorLote(producto.id, datos.seccionId, loteVencimiento, tx)
        : await calcularSaldoTotal(producto.id, datos.seccionId, tx);
      const diferencia = redondearACantidadDeUnidad(conteoReal - saldoSistema, producto.unidadStock.decimales);

      const accionInfo = ACCIONES_CONTEO[datos.accion];
      const estado: EstadoConteo = diferencia === 0 ? "RESUELTO" : accionInfo.estado;

      const conteo = await tx.conteoFisico.create({
        data: {
          sucursalId: ctx.sucursalId,
          fecha: datos.fechaConteo,
          productoId: producto.id,
          seccionId: datos.seccionId,
          loteVencimiento,
          saldoSistema,
          conteoReal,
          diferencia,
          accion: datos.accion,
          estado,
          detalle: texto(datos.detalle) || null,
          usuarioId: ctx.usuarioId,
        },
      });

      if (diferencia !== 0 && accionInfo.ajusta) {
        const operacion = await tx.operacion.create({
          data: { sucursalId: ctx.sucursalId, proceso: "CONTROL", fecha: datos.fechaConteo, usuarioId: ctx.usuarioId },
        });
        await tx.movimientoStock.create({
          data: {
            operacionId: operacion.id,
            productoId: producto.id,
            seccionId: datos.seccionId,
            proceso: "CONTROL",
            cantidad: diferencia,
            loteVencimiento,
            detalle: `Conteo físico: contado ${conteoReal}, sistema calculaba ${saldoSistema}, diferencia ${diferencia > 0 ? "+" : ""}${diferencia}.`,
            precioTotal: 0,
            precioPorUnidadStock: 0,
            conteoFisicoId: conteo.id,
          },
        });
      }

      const mensaje =
        diferencia === 0
          ? "Conteo registrado. El stock ya coincidía."
          : `Conteo registrado. Diferencia: ${diferencia > 0 ? "+" : ""}${diferencia}${accionInfo.ajusta ? " (ajustada)" : ""}.`;
      return ok(mensaje);
    });
  });
}

/**
 * Port de resolverConteoPendiente (Stock.js:2022-2075): cierra un conteo
 * que había quedado PENDIENTE ("falta cargar un movimiento"). 'resuelto' =
 * el movimiento faltante ya se cargó, el stock se corrigió solo. 'ajustar'
 * = se busca el movimiento y no aparece — se ajusta contra el saldo de
 * HOY (no el del día del conteo, porque entre medio pudo haber más
 * movimientos).
 *
 * Gate: Apps Script no gatea esta función explícitamente (accesible solo
 * desde el panel de Conteo Físico, ya gateado a nivel menú) — acá se gatea
 * igual que registrarConteoFisico ('proceso_control'), mismo criterio que
 * "toda mutación pasa por conPermiso" (plan de migración, convenciones).
 */
export async function resolverConteoPendiente(conteoId: string, comoResolver: "resuelto" | "ajustar"): Promise<ResultadoAccion> {
  return conPermiso("proceso_control", async (ctx) => {
    return conTransaccionSerializable(async (tx) => {
      const conteo = await tx.conteoFisico.findUnique({ where: { id: conteoId } });
      if (!conteo || conteo.sucursalId !== ctx.sucursalId) return error("No se encontró ese conteo.");
      if (conteo.estado !== "PENDIENTE") return error("Ese conteo no está pendiente.");

      if (comoResolver === "resuelto") {
        await tx.conteoFisico.update({
          where: { id: conteoId },
          data: { estado: "RESUELTO", detalle: `${conteo.detalle ?? ""} — cerrado: se cargó el movimiento que faltaba`.trim() },
        });
        return ok("Conteo cerrado. El stock ya se corrigió con el movimiento que cargaste.");
      }

      const producto = await tx.producto.findUnique({ where: { id: conteo.productoId }, include: { unidadStock: true } });
      if (!producto) return error("El producto ya no existe en el catálogo.");

      const saldoHoy = conteo.loteVencimiento
        ? await calcularSaldoPorLote(conteo.productoId, conteo.seccionId, conteo.loteVencimiento, tx)
        : await calcularSaldoTotal(conteo.productoId, conteo.seccionId, tx);
      const diferencia = redondearACantidadDeUnidad(Number(conteo.conteoReal) - saldoHoy, producto.unidadStock.decimales);

      if (diferencia === 0) {
        await tx.conteoFisico.update({
          where: { id: conteoId },
          data: { estado: "RESUELTO", detalle: `${conteo.detalle ?? ""} — cerrado: el stock ya coincide`.trim() },
        });
        return ok("El stock ya coincide con lo contado. No hizo falta ajustar.");
      }

      const operacion = await tx.operacion.create({
        data: { sucursalId: ctx.sucursalId, proceso: "CONTROL", fecha: new Date(), usuarioId: ctx.usuarioId },
      });
      await tx.movimientoStock.create({
        data: {
          operacionId: operacion.id,
          productoId: conteo.productoId,
          seccionId: conteo.seccionId,
          proceso: "CONTROL",
          cantidad: diferencia,
          loteVencimiento: conteo.loteVencimiento,
          detalle: `Conteo pendiente resuelto: contado ${conteo.conteoReal}, sistema calculaba ${saldoHoy}, diferencia ${diferencia > 0 ? "+" : ""}${diferencia}.`,
          precioTotal: 0,
          precioPorUnidadStock: 0,
          conteoFisicoId: conteo.id,
        },
      });
      await tx.conteoFisico.update({
        where: { id: conteoId },
        data: { estado: "RESUELTO", detalle: `${conteo.detalle ?? ""} — cerrado con ajuste de ${diferencia > 0 ? "+" : ""}${diferencia}`.trim() },
      });

      return ok(`Conteo cerrado. Se ajustó ${diferencia > 0 ? "+" : ""}${diferencia}.`);
    });
  });
}

/**
 * Port de cancelarConteoFisico (Stock.js:2097-2141): revierte un conteo YA
 * APLICADO ("Resuelto" — le ajustó el stock de verdad). Nunca se edita ni
 * se borra la fila original del Kardex — se escribe una fila de REVERSIÓN
 * nueva con la MISMA magnitud y signo contrario, enlazada al mismo
 * ConteoFisico (FK real — en Apps Script era el mismo "ID Operación" que
 * la fila original, correlación por string).
 */
export async function cancelarConteoFisico(conteoId: string): Promise<ResultadoAccion> {
  return conPermiso("cancelar_conteo", async (ctx) => {
    return conTransaccionSerializable(async (tx) => {
      const conteo = await tx.conteoFisico.findUnique({ where: { id: conteoId } });
      if (!conteo || conteo.sucursalId !== ctx.sucursalId) return error("No se encontró ese conteo.");
      if (conteo.estado === "CANCELADO") return error("Ese conteo ya está cancelado.");
      if (conteo.estado !== "RESUELTO") {
        return error(
          `Este conteo está "${conteo.estado}", no aplicó ningún ajuste al stock — no hay nada que cancelar. Si es un conteo pendiente, resolvelo en vez de cancelarlo.`
        );
      }

      const diferenciaOriginal = Number(conteo.diferencia);
      if (diferenciaOriginal !== 0) {
        const operacion = await tx.operacion.create({
          data: { sucursalId: ctx.sucursalId, proceso: "CONTROL", fecha: new Date(), usuarioId: ctx.usuarioId },
        });
        await tx.movimientoStock.create({
          data: {
            operacionId: operacion.id,
            productoId: conteo.productoId,
            seccionId: conteo.seccionId,
            proceso: "CONTROL",
            cantidad: -diferenciaOriginal,
            loteVencimiento: conteo.loteVencimiento,
            detalle: `Conteo físico cancelado: se revierte el ajuste de ${diferenciaOriginal > 0 ? "+" : ""}${diferenciaOriginal}.`,
            precioTotal: 0,
            precioPorUnidadStock: 0,
            conteoFisicoId: conteo.id,
          },
        });
      }

      await tx.conteoFisico.update({
        where: { id: conteoId },
        data: {
          estado: "CANCELADO",
          detalle: `${conteo.detalle ?? ""} — cancelado, se revirtió el ajuste de ${diferenciaOriginal > 0 ? "+" : ""}${diferenciaOriginal}`.trim(),
        },
      });

      return ok(`Conteo cancelado. Se revirtió el ajuste de ${diferenciaOriginal > 0 ? "+" : ""}${diferenciaOriginal}.`);
    });
  });
}

const TAMANO_PAGINA_CONTEOS = 50;

/**
 * Historial de conteos de un producto/sección, más nuevo primero — para el
 * panel, paginado por cursor (antes un `take: 200` fijo sin forma de ver
 * conteos más viejos — hallazgo de la diligencia de motor2).
 *
 * `sucursalId` es obligatorio a propósito (no opcional como en una primera
 * versión de esta función): sin él, sin `seccionId`, listaría conteos de
 * CUALQUIER sucursal — bug encontrado escribiendo la UI, mismo tipo de
 * fuga que Core/Catálogo evitan scopeando todo por sucursal desde el vamos.
 *
 * `seccionId`/`productoId`/`desde`/`hasta` existían como filtro posible
 * (seccionId) o eran triviales de agregar (productoId, rango de fechas),
 * pero /reportes/conteos nunca los exponía en la página, a diferencia de
 * casi todos los demás reportes del módulo (hallazgo de la auditoría).
 */
export interface FiltroHistorialConteos {
  seccionId?: string;
  productoId?: string;
  desde?: Date;
  hasta?: Date;
  cursor?: string;
}

export async function obtenerHistorialConteosFisicos(sucursalId: string, filtro: FiltroHistorialConteos = {}) {
  const { seccionId, productoId, desde, hasta, cursor } = filtro;
  const items = await prisma.conteoFisico.findMany({
    where: {
      sucursalId,
      ...(seccionId ? { seccionId } : {}),
      ...(productoId ? { productoId } : {}),
      ...(desde || hasta ? { fecha: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } } : {}),
    },
    include: { producto: true, seccion: true },
    orderBy: [{ fecha: "desc" }, { id: "desc" }],
    take: TAMANO_PAGINA_CONTEOS + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hayMas = items.length > TAMANO_PAGINA_CONTEOS;
  const pagina = hayMas ? items.slice(0, TAMANO_PAGINA_CONTEOS) : items;
  return { items: pagina, nextCursor: hayMas ? pagina[pagina.length - 1].id : null };
}
