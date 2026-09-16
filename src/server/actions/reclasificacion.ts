"use server";

import type { Prisma } from "@prisma/client";
import { texto } from "@/core/texto";
import { calcularSaldoPorLote } from "@/core/movimientos/stock";
import { conTransaccionSerializable } from "@/core/movimientos/con-reintento";
import { conPermiso } from "./con-permiso";
import { error, ok, type ResultadoAccion } from "./tipos";

/**
 * Solo lectura — la usa el cliente para mostrar el saldo disponible en
 * origen ANTES de enviar el form, a diferencia de antes (que solo lo
 * informaba el servidor recién al fallar el submit si la suma no cerraba,
 * a diferencia de su hermano Conteo Físico, que sí lo muestra de entrada).
 */
export async function obtenerSaldoDisponibleParaReclasificar(
  productoId: string,
  seccionId: string,
  loteVencimiento: Date | null
): Promise<number | null> {
  if (!productoId || !seccionId) return null;
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
    for (const d of datos.destinos) {
      if (!texto(d.seccionId)) return error("Cada destino necesita una sección — no se puede dejar en blanco.");
      if (!(d.cantidad > 0)) return error("Cada destino necesita una cantidad mayor a 0.");
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

    const totalDestinos = datos.destinos.reduce((acc, d) => acc + d.cantidad, 0);

    return conTransaccionSerializable(async (tx) => {
      const producto = await tx.producto.findUnique({ where: { id: datos.productoId }, include: { unidadStock: true } });
      if (!producto || !producto.activo) return error("El producto no existe o no está activo.");

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
        ...datos.destinos.map(
          (d): Prisma.MovimientoStockCreateManyInput => ({
            operacionId: operacion.id,
            productoId: datos.productoId,
            seccionId: d.seccionId,
            proceso: "RECLASIFICACION",
            cantidad: d.cantidad,
            loteVencimiento: d.loteVencimiento ?? null,
            detalle: "Reclasificación: entra desde otra sección/lote.",
            precioTotal: 0,
            precioPorUnidadStock: 0,
          })
        ),
      ];

      await tx.movimientoStock.createMany({ data: filas });

      return ok(`"${producto.nombre}" reclasificado: ${disponible} repartido en ${datos.destinos.length} destino(s).`);
    });
  });
}
