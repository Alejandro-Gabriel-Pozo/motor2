"use server";

import type { Prisma } from "@prisma/client";
import { texto } from "@/core/texto";
import { validarCantidad } from "@/core/datos/cantidad";
import { calcularSaldoPorLote, obtenerSeccionPropia } from "@/core/movimientos/stock";
import { conTransaccionSerializable } from "@/core/movimientos/con-reintento";
import { calcularPayloadHash, chequearIdempotencia, esClaveIdempotenciaValida, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "@/core/movimientos/idempotencia";
import { productoDisponibleEn } from "@/core/catalogo/disponibilidad-producto-consulta";
import { conPermiso } from "../con-permiso";
import { requerirSesion } from "../con-sesion";
import { error, ok, type ResultadoAccion } from "../tipos";

/**
 * Solo lectura — la usa el cliente para mostrar el saldo disponible en
 * origen ANTES de enviar el form, a diferencia de antes (que solo lo
 * informaba el servidor recién al fallar el submit si la suma no cerraba,
 * a diferencia de su hermano Conteo Físico, que sí lo muestra de entrada).
 *
 * Fase 6 (auditoría de seguridad/contratos): sin `conPermiso` a propósito
 * (es de solo lectura, mismo criterio que el resto de las consultas de
 * este módulo), pero SÍ necesita su propio chequeo de sesión + sección
 * propia acá — a diferencia de las demás consultas "abiertas" del
 * proyecto, esta expone un saldo de stock de una sección puntual elegida
 * por el cliente, no un catálogo compartido.
 */
export async function obtenerSaldoDisponibleParaReclasificar(
  productoId: string,
  seccionId: string,
  loteVencimiento: Date | null
): Promise<number | null> {
  // Sin sesión LANZA (como el resto de las lecturas, ver con-sesion.ts), en vez de devolver `null`: `null` significa «no hay saldo
  // para mostrar» y el cliente no podía distinguir un producto sin datos de una sesión vencida.
  const ctx = await requerirSesion();
  if (!productoId || !seccionId) return null;
  if (!(await obtenerSeccionPropia(seccionId, ctx.sucursalId))) return null;
  return calcularSaldoPorLote(productoId, seccionId, loteVencimiento);
}

export interface DestinoReclasificacion {
  seccionId: string;
  loteVencimiento?: Date | null;
  cantidad: number;
}

export interface DatosReclasificacion {
  productoId: string;
  seccionOrigenId: string;
  loteOrigen?: Date | null;
  destinos: DestinoReclasificacion[];
  fecha: Date;
  detalle?: string;
  /** I3 — UUID generado por el cliente al abrir el formulario, reenviado tal cual en reintentos. Opcional durante el rollout (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md §9.3). */
  claveIdempotencia?: string;
}

/**
 * Port de dividirClasificacionStock_ (Stock.js:1899-1991, wrapper público
 * reclasificarStock) — primitiva de split genérico: reparte TODO el saldo
 * disponible de un producto en un origen (sección+lote puntual) entre 1+
 * destinos (sección+lote cada uno), ni de más ni de menos. Mismo permiso
 * que Conteo Físico ('proceso_control') — no pasa por TRANSICIONES ni por
 * registrarMovimiento, mismo criterio que Apps Script: no es una acción de
 * usuario con su propia Accion, es la herramienta de corrección que ofrece
 * el panel de Conteo Físico.
 */
export async function reclasificarStock(datos: DatosReclasificacion): Promise<ResultadoAccion> {
  return conPermiso("proceso_control", async (ctx) => {
    if (!texto(datos.productoId)) return error("Elegí un producto.");
    if (!texto(datos.seccionOrigenId)) return error("Elegí la sección de origen — no se puede dejar en blanco.");
    if (!datos.destinos.length) return error("Agregá al menos un destino.");
    if (datos.claveIdempotencia !== undefined && !esClaveIdempotenciaValida(datos.claveIdempotencia)) {
      return error("Clave de reintento inválida.");
    }
    for (const d of datos.destinos) {
      if (!texto(d.seccionId)) return error("Cada destino necesita una sección — no se puede dejar en blanco.");
    }
    // El formato/signo/decimales de cada cantidad de destino se validan más abajo con `validarCantidad`, una vez resuelta la
    // unidad de stock del producto (antes NO había ningún chequeo de decimales acá — hallazgo del pendiente #32).

    // Fase 6 (auditoría de seguridad/contratos): ver el mismo chequeo en
    // registrarMovimiento — conPermiso no valida que las secciones sean
    // de ESTA sucursal, solo el permiso de quien llama.
    if (!(await obtenerSeccionPropia(datos.seccionOrigenId, ctx.sucursalId))) return error("No se encontró la sección de origen.");
    const seccionesDestino = new Map<string, { id: string; nombre: string }>();
    for (const d of datos.destinos) {
      const seccion = await obtenerSeccionPropia(d.seccionId, ctx.sucursalId);
      if (!seccion) return error("No se encontró una de las secciones de destino.");
      seccionesDestino.set(d.seccionId, seccion);
    }

    // Con un único destino idéntico al origen (misma sección+lote), la
    // "reclasificación" es un par de movimientos que se cancelan entre sí
    // — no reparte nada, solo agrega ruido a la trazabilidad del Kardex.
    if (datos.destinos.length === 1) {
      const unico = datos.destinos[0];
      const mismoLote = (datos.loteOrigen ?? null)?.getTime() === (unico.loteVencimiento ?? null)?.getTime();
      if (unico.seccionId === datos.seccionOrigenId && mismoLote) {
        return error("El único destino es idéntico al origen (misma sección y lote) — no hay nada para reclasificar.");
      }
    }

    return conTransaccionSerializable(async (tx) => {
      // I3 — idempotencia: chequeo antes de cualquier lógica de negocio.
      const payloadHash = datos.claveIdempotencia
        ? calcularPayloadHash("RECLASIFICACION", ctx.sucursalId, { ...datos, claveIdempotencia: undefined })
        : "";
      const chequeo = await chequearIdempotencia(tx, datos.claveIdempotencia, payloadHash);
      if (chequeo.estado === "duplicado") return ok(chequeo.mensaje);
      if (chequeo.estado === "conflicto") return error(MENSAJE_CONFLICTO_IDEMPOTENCIA);

      const producto = await tx.producto.findUnique({ where: { id: datos.productoId }, include: { unidadStock: true } });
      if (!producto) return error("El producto no existe.");
      if (!(await productoDisponibleEn(ctx.sucursalId, producto.id, tx))) {
        return error(`«${producto.nombre}» no está disponible en «${ctx.sucursalNombre}».`);
      }

      // Cantidad de ENTRADA de cada destino: se rechaza el exceso de decimales para la unidad de stock del producto, no se
      // redondea ni se guarda tal cual (hallazgo del pendiente #32 — Reclasificación no tenía NINGÚN chequeo de decimales acá,
      // a diferencia de Traspasos/Conteo Físico/Compra). Recién acá se conoce `producto.unidadStock`.
      const destinosValidados: { seccionId: string; loteVencimiento: Date | null; cantidad: number }[] = [];
      for (const d of datos.destinos) {
        const nombreSeccion = seccionesDestino.get(d.seccionId)?.nombre ?? d.seccionId;
        const resCantidad = validarCantidad(d.cantidad, producto.unidadStock, {
          etiqueta: `La cantidad de "${producto.nombre}" hacia "${nombreSeccion}"`,
          obligatorio: true,
        });
        if (!resCantidad.ok) return error(resCantidad.mensaje);
        destinosValidados.push({ seccionId: d.seccionId, loteVencimiento: d.loteVencimiento ?? null, cantidad: resCantidad.valor! });
      }
      const totalDestinos = destinosValidados.reduce((acc, d) => acc + d.cantidad, 0);

      // El saldo disponible se lee DENTRO de la transacción (Serializable
      // aborta si otra escritura concurrente lo cambia mientras tanto) —
      // mismo criterio "leer→decidir→escribir sin que se cuele otra
      // escritura" que conLock_ en Apps Script.
      const disponible = await calcularSaldoPorLote(datos.productoId, datos.seccionOrigenId, datos.loteOrigen ?? null, tx);
      const diff = Math.round((totalDestinos - disponible) * 1000) / 1000;
      if (diff !== 0) {
        return error(
          `La suma de los destinos (${totalDestinos}) tiene que ser exactamente igual al saldo disponible en origen (${disponible}) — ni de más ni de menos.`
        );
      }
      if (!(disponible > 0)) return error("No hay saldo disponible para reclasificar en esa sección/lote.");

      const operacion = await tx.operacion.create({
        data: {
          sucursalId: ctx.sucursalId,
          proceso: "RECLASIFICACION",
          fecha: datos.fecha,
          detalleLibre: texto(datos.detalle) || null,
          usuarioId: ctx.usuarioId,
          claveIdempotencia: datos.claveIdempotencia ?? null,
          payloadHash: datos.claveIdempotencia ? payloadHash : null,
        },
      });

      const filas: Prisma.MovimientoStockCreateManyInput[] = [
        {
          operacionId: operacion.id,
          productoId: datos.productoId,
          seccionId: datos.seccionOrigenId,
          proceso: "RECLASIFICACION",
          cantidad: -disponible,
          loteVencimiento: datos.loteOrigen ?? null,
          detalle: `Reclasificación: sale hacia ${datos.destinos.length} destino(s).`,
          precioTotal: 0,
          precioPorUnidadStock: 0,
        },
        ...destinosValidados.map(
          (d): Prisma.MovimientoStockCreateManyInput => ({
            operacionId: operacion.id,
            productoId: datos.productoId,
            seccionId: d.seccionId,
            proceso: "RECLASIFICACION",
            cantidad: d.cantidad,
            loteVencimiento: d.loteVencimiento,
            detalle: "Reclasificación: entra desde otra sección/lote.",
            precioTotal: 0,
            precioPorUnidadStock: 0,
          })
        ),
      ];

      await tx.movimientoStock.createMany({ data: filas });

      const mensaje = `"${producto.nombre}" reclasificado: ${disponible} repartido en ${datos.destinos.length} destino(s).`;
      if (datos.claveIdempotencia) {
        await tx.operacion.update({ where: { id: operacion.id }, data: { resultadoMensaje: mensaje } });
      }

      return ok(mensaje);
    });
  });
}
