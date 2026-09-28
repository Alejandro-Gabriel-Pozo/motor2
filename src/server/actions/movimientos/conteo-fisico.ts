"use server";

import { prisma } from "@/lib/db";
import { redondearACantidadDeUnidad } from "@/core/movimientos/public";
import { calcularSaldoPorLote, calcularSaldoTotal, conTransaccionSerializable } from "@/core/movimientos/public-servidor";
import { aResultadoAccion } from "@/core/resultado-caso";
import { guardComandoConteoFisico } from "@/core/features/movimientos/conteo-fisico.guard";
import type { ComandoConteoFisico } from "@/core/features/movimientos/conteo-fisico.schema";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { requerirVerEnSucursal } from "../con-sesion";
import { registrarConteoFisicoCasoDeUso } from "./casos-de-uso/registrar-conteo-fisico";

/** Lo que recibe `registrarConteoFisico`/`registrarConteosFisicos`. Vive en `conteo-fisico.schema.ts` (lo usa también el caso de uso). */
export type DatosConteoFisico = ComandoConteoFisico;

/**
 * Port de _registrarConteoFisicoSinRecalculo_ (Stock.js:1523-1649) — camino
 * PROPIO, no pasa por registrarMovimiento (Movimientos.js nunca lo hace
 * pasar por armarRegistroMovimiento_ tampoco). Mismo motivo que Apps
 * Script: Control es un proceso distinto de Ajuste (permite distinguir
 * "conteo físico formal" de "corrección manual suelta"), con su propia
 * bitácora (ConteoFisico) además del Kardex.
 *
 * Desde la Task #41 (Fase M, M13e1 — docs/arquitectura-casos-de-uso-2026-09-27.md; migración PARCIAL, como P1) esta Server Action es un
 * adaptador fino: permiso (`conPermiso("proceso_control")`) → formato del comando (`guardComandoConteoFisico`,
 * `core/features/movimientos/conteo-fisico.guard.ts`: sección en blanco) → caso de uso (`casos-de-uso/registrar-conteo-fisico.ts`:
 * sección propia, producto, disponibilidad, "tiene stock real", cantidad, transacción, persistencia) → `aResultadoAccion`.
 */
export async function registrarConteoFisico(datos: DatosConteoFisico): Promise<ResultadoAccion> {
  return conPermiso("proceso_control", async (ctx) => {
    const comando = guardComandoConteoFisico(datos);
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await registrarConteoFisicoCasoDeUso(ctx, comando.valor));
  });
}

/** Resultado de la grilla: uno por conteo, en el mismo orden en que se mandaron. */
export type ResultadoConteos = { ok: true; mensaje: string; resultados: ResultadoAccion[] } | { ok: false; mensaje: string };

/**
 * Tope de conteos por llamada. Cada conteo son 6 a 8 viajes a la base (dentro de una transacción serializable); con la función y
 * la base en regiones distintas de la nube (~70 ms por viaje) una fila puede tardar del orden de medio segundo, y la llamada tiene
 * un techo de 60 s (`maxDuration` de la página de Conteo Físico). 60 filas dejan margen aun a 1 s por fila. La pantalla manda
 * las grillas más grandes en tandas de 50.
 */
const MAX_CONTEOS_POR_LLAMADA = 60;

/**
 * Toda la grilla de Conteo Físico en UNA llamada. Antes la pantalla llamaba a `registrarConteoFisico` una vez por fila: si la
 * sesión vencía a mitad del recorrido, las filas ya escritas quedaban escritas y la persona no recibía el parcial (la
 * siguiente llamada la mandaba al login). Ahora la sesión y el permiso se comprueban UNA vez, al principio, y el recorrido
 * corre completo en el servidor. Se conserva la semántica por fila: cada conteo tiene su propia transacción y su propio
 * resultado (ok o el motivo del error), así que uno que falla no frena a los demás.
 */
export async function registrarConteosFisicos(filas: DatosConteoFisico[]): Promise<ResultadoConteos> {
  return conPermiso<ResultadoConteos>("proceso_control", async (ctx) => {
    if (!filas.length) return error("No hay conteos para registrar.");
    if (filas.length > MAX_CONTEOS_POR_LLAMADA) {
      return error(`Son demasiados conteos de una vez (${filas.length}, el máximo es ${MAX_CONTEOS_POR_LLAMADA}). Registralos en partes.`);
    }

    // El guard corre UNA VEZ POR FILA, dentro del bucle: cada fila valida su propia sección (mismo comportamiento que antes, cuando
    // cada fila pasaba por `registrarConteoConContexto` y esa función arrancaba con el mismo chequeo). La sesión y el permiso, en
    // cambio, se comprueban una sola vez para toda la tanda — ver el docstring de esta función.
    const resultados: ResultadoAccion[] = [];
    for (const fila of filas) {
      try {
        const comando = guardComandoConteoFisico(fila);
        resultados.push(comando.ok ? aResultadoAccion(await registrarConteoFisicoCasoDeUso(ctx, comando.valor)) : error(comando.mensaje));
      } catch (e) {
        // Un error inesperado de una fila (base de datos, etc.) no tira abajo la llamada entera: las filas anteriores ya están
        // escritas y hay que devolver el parcial.
        console.error("registrarConteosFisicos: falló un conteo", e);
        resultados.push(error("No se pudo registrar este conteo (error inesperado). Probá de nuevo."));
      }
    }

    const registrados = resultados.filter((r) => r.ok).length;
    return { ok: true, mensaje: `${registrados} de ${filas.length} conteo(s) registrado(s).`, resultados };
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
  await requerirVerEnSucursal(sucursalId, "proceso_control");
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
