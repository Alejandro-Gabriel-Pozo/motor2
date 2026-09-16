"use server";

import type { Prisma } from "@prisma/client";
import { texto } from "@/core/texto";
import { redondearACantidadDeUnidad, redondearMoneda } from "@/core/movimientos/transiciones";
import { obtenerLoteMasProximoAVencer, resolverConsumoPorFamilia, seccionesConStock, validarStockSuficiente } from "@/core/movimientos/stock";
import { resolverPrecioVenta } from "@/core/movimientos/precio-venta";
import { conTransaccionSerializable } from "@/core/movimientos/con-reintento";
import { conPermiso } from "./con-permiso";
import { error, ok, type ResultadoAccion } from "./tipos";

export interface ItemVentaInput {
  productoId: string;
  cantidadVendida: number;
  /** Solo tiene sentido si el PV está marcado "Se produce" (tiene lotes propios). */
  loteVencimiento?: Date | null;
}

export interface DatosVentaInput {
  fecha: Date;
  seccionId: string;
  proveedorId?: string; // "a quién se vende" — null/undefined = mostrador (Movimientos.js:1769, 'Mostrador' como texto libre por defecto)
  nroFactura?: string;
  detalle?: string;
  ventas: ItemVentaInput[];
}

interface ConsumoCalculado {
  productoId: string;
  cantidad: number;
  loteVencimiento: Date | null;
}

interface VentaCalculada {
  productoId: string;
  cantidadVendida: number;
  loteVencimiento: Date | null;
  precioVenta: number;
  consumos: ConsumoCalculado[];
}

/**
 * Port de armarPreviaVentaDesdeItems_ (Movimientos.js:1682-1775) para UNA
 * línea. Sesión "eliminar COMPRA+VENTA": lo único vendible es un PV
 * (vinculado por receta a la MP que consume, aunque sea una receta 1:1 sin
 * merma) — ya no existe la venta directa de una MP.
 */
async function armarVentaCalculada(
  item: ItemVentaInput,
  seccionId: string,
  sucursalId: string,
  tx: Prisma.TransactionClient
): Promise<{ ok: true; venta: VentaCalculada | null } | { ok: false; mensaje: string }> {
  const cantidad = Number(item.cantidadVendida || 0);
  if (!(cantidad > 0)) return { ok: true, venta: null };

  const producto = await tx.producto.findUnique({ where: { id: item.productoId }, include: { unidadStock: true } });
  if (!producto || !producto.activo) return { ok: false, mensaje: `El producto no existe o no está activo.` };
  if (producto.tipo !== "PV") {
    return { ok: false, mensaje: `"${producto.nombre}" no está habilitado para venta: solo se puede vender un PV (vinculado por receta a la materia prima que consume).` };
  }

  const consumos: ConsumoCalculado[] = [];
  if (!producto.seProduce) {
    // Un PV que se produce por lote ya consumió su receta al producirse — la venta solo lo resta (ver registrarMovimiento, PRODUCCION).
    const receta = await tx.recetaVersion.findFirst({ where: { productoId: producto.id }, orderBy: { version: "desc" }, include: { ingredientes: true } });
    for (const ing of receta?.ingredientes ?? []) {
      const mp = await tx.producto.findUnique({ where: { id: ing.insumoProductoId } });
      if (!mp?.activo || mp.tipo !== "MP") {
        return { ok: false, mensaje: `La materia prima de la receta de "${producto.nombre}" no está marcada como MP activa.` };
      }
      const cantidadSalida = cantidad * Number(ing.cantidad) * (1 + Number(ing.mermaPorcentaje) / 100);
      const reparto = await resolverConsumoPorFamilia(ing.insumoProductoId, cantidadSalida, seccionId, tx);
      consumos.push(...reparto);
    }
  }

  // El PV vendido también puede tener lotes propios si está marcado "Se
  // produce": si no se cargó uno puntual, se asume el que vence antes.
  let loteVencimiento = item.loteVencimiento ?? null;
  if (!loteVencimiento && producto.seProduce) {
    loteVencimiento = await obtenerLoteMasProximoAVencer(producto.id, seccionId, tx);
  }

  const precioVenta = await resolverPrecioVenta(sucursalId, producto.id, Number(producto.precioVenta), tx);

  return {
    ok: true,
    venta: { productoId: producto.id, cantidadVendida: cantidad, loteVencimiento, precioVenta, consumos },
  };
}

/**
 * Port de confirmarRegistrarVenta_ConLock_ (Movimientos.js:1154-1332).
 * A diferencia del resto de los procesos, cada venta individual del lote
 * es su propia Operacion (idOperacionVenta propio en Apps Script) — para
 * poder reconstruir "qué consumió esta venta puntual" (con su Liquidación
 * de consignación si aplica) sin mezclarse con las demás ventas
 * confirmadas en el mismo lote. La validación de stock, en cambio, se hace
 * UNA vez sobre TODO el payload junto (mismo bugfix C-1 que registrarMovimiento).
 */
export async function registrarVenta(datos: DatosVentaInput): Promise<ResultadoAccion> {
  return conPermiso("proceso_venta", async (ctx) => {
    if (!datos.ventas.length) return error("Cargá al menos un producto con cantidad.");
    if (!texto(datos.seccionId)) return error("Elegí una sección.");

    const resultado = await conTransaccionSerializable(async (tx) => {
      const ventas: VentaCalculada[] = [];
      for (const item of datos.ventas) {
        const armado = await armarVentaCalculada(item, datos.seccionId, ctx.sucursalId, tx);
        if (!armado.ok) return error(armado.mensaje);
        if (armado.venta) ventas.push(armado.venta);
      }
      if (!ventas.length) return error("Ninguna línea tiene una cantidad válida.");

      // Validación de stock agregada: cada consumo de receta descuenta
      // stock real — el producto vendido en sí nunca descuenta su propio
      // stock (solo lo que consume su receta), mismo criterio que Apps
      // Script desde "eliminar COMPRA+VENTA".
      const requeridoPorClave = new Map<string, { productoId: string; cantidad: number }>();
      for (const venta of ventas) {
        for (const c of venta.consumos) {
          const key = c.productoId;
          const previo = requeridoPorClave.get(key);
          requeridoPorClave.set(key, { productoId: c.productoId, cantidad: (previo?.cantidad ?? 0) + c.cantidad });
        }
      }
      for (const { productoId, cantidad } of requeridoPorClave.values()) {
        const chequeo = await validarStockSuficiente(productoId, datos.seccionId, cantidad, tx);
        if (!chequeo.ok) {
          const producto = await tx.producto.findUnique({ where: { id: productoId } });
          const pista = await seccionesConStock(productoId, ctx.sucursalId, tx);
          const detallePista = pista.length ? ` Tiene stock en: ${pista.join(", ")}.` : "";
          return error(
            `Stock insuficiente para "${producto?.nombre ?? productoId}". Actual: ${chequeo.actual}, requerido: ${chequeo.requerido}.${detallePista}`
          );
        }
      }

      const filas: Prisma.MovimientoStockCreateManyInput[] = [];
      for (const venta of ventas) {
        const producto = await tx.producto.findUnique({ where: { id: venta.productoId }, include: { unidadStock: true } });
        const operacion = await tx.operacion.create({
          data: {
            sucursalId: ctx.sucursalId,
            proceso: "VENTA",
            fecha: datos.fecha,
            proveedorId: datos.proveedorId ?? null,
            nroFactura: texto(datos.nroFactura) || null,
            detalleLibre: texto(datos.detalle) || null,
            usuarioId: ctx.usuarioId,
          },
        });

        for (const c of venta.consumos) {
          const consumido = await tx.producto.findUnique({ where: { id: c.productoId }, include: { unidadStock: true } });
          const cantidadRedondeada = redondearACantidadDeUnidad(c.cantidad, consumido?.unidadStock.decimales ?? 2);
          filas.push({
            operacionId: operacion.id, productoId: c.productoId, seccionId: datos.seccionId, proceso: "CONSUMO",
            cantidad: -cantidadRedondeada, loteVencimiento: c.loteVencimiento,
            detalle: `Consumo por venta de "${producto?.nombre ?? venta.productoId}".`, precioTotal: 0, precioPorUnidadStock: 0,
          });

          if (consumido?.esConsignacion) {
            filas.push({
              operacionId: operacion.id, productoId: c.productoId, seccionId: datos.seccionId, proceso: "LIQUIDACION_CONSIGNACION",
              cantidad: 0, loteVencimiento: null,
              detalle: `Liquidación consignación por venta de "${producto?.nombre ?? venta.productoId}".`,
              precioTotal: redondearMoneda(cantidadRedondeada * Number(consumido.precioConsignacion ?? 0)),
              precioPorUnidadStock: redondearMoneda(Number(consumido.precioConsignacion ?? 0)),
            });
          }
        }

        // El PV vendido en sí: signoStock -1 (Movimientos.js:190-205) — si
        // no tiene stock real (no "Se produce"), este saldo negativo es un
        // artefacto contable de las ventas, mismo criterio que hoy.
        const importeVenta = redondearMoneda(venta.cantidadVendida * venta.precioVenta);
        filas.push({
          operacionId: operacion.id, productoId: venta.productoId, seccionId: datos.seccionId, proceso: "VENTA",
          cantidad: -venta.cantidadVendida, loteVencimiento: venta.loteVencimiento,
          detalle: texto(datos.detalle) || "Venta", precioTotal: importeVenta, precioPorUnidadStock: redondearMoneda(venta.precioVenta),
        });
      }

      await tx.movimientoStock.createMany({ data: filas });
      return ok(`Se registraron ${ventas.length} venta(s) correctamente.`);
    });

    return resultado;
  });
}

/**
 * Anula una Venta ya confirmada — hueco real señalado en la auditoría
 * amplia de motor2 (2026-09-16): a diferencia de Conteo Físico
 * (resolverConteoPendiente/cancelarConteoFisico), no existía ningún camino
 * para corregir un error de carga en el proceso más frecuente del sistema.
 * "Devolución de cliente" es un concepto de negocio distinto (mercadería
 * que vuelve, revendible) y no sirve para esto.
 *
 * Mismo criterio append-only que cancelarConteoFisico
 * (src/server/actions/conteo-fisico.ts): la Operacion/MovimientoStock
 * original de la venta nunca se edita ni se borra — se escribe una
 * Operacion AJUSTE nueva que revierte cada línea (mismo producto/sección/
 * lote, cantidad con el signo invertido), y la venta original se marca
 * `anuladaEn`/`anuladaPorId` para no poder anularla dos veces.
 *
 * Por qué AJUSTE y no un Proceso "ANULACION_VENTA" nuevo: AJUSTE ya es
 * "delta ya firmado" (esSignoFijo=false, TRANSICIONES.AJUSTE) y ya está
 * excluido de los reportes de venta/margen que suman por magnitud — reusa
 * infraestructura ya probada en vez de tener que rewirear esSignoFijo y
 * cada reporte de período para un Proceso nuevo. La línea
 * LIQUIDACION_CONSIGNACION (si la venta consumió una MP en consignación)
 * se revierte con el mismo Proceso, cantidad en 0 igual que el original,
 * precioTotal/precioPorUnidadStock en negativo — así el reporte de
 * Consignación (que suma esas líneas tal cual) neta solo automáticamente.
 *
 * Gate: 'anular_venta', admin-only en la semilla — mismo criterio que
 * 'cancelar_conteo' (más restrictivo que el permiso para CARGAR el proceso
 * original, a propósito).
 */
export async function anularVenta(operacionId: string): Promise<ResultadoAccion> {
  return conPermiso("anular_venta", async (ctx) => {
    return conTransaccionSerializable(async (tx) => {
      const operacion = await tx.operacion.findFirst({
        where: { id: operacionId, sucursalId: ctx.sucursalId },
        include: { movimientos: { include: { producto: true } } },
      });
      if (!operacion) return error("No se encontró esa operación en esta sucursal.");
      if (operacion.proceso !== "VENTA") return error(`La operación "${operacionId}" no es una Venta — es "${operacion.proceso}".`);
      if (operacion.anuladaEn) return error("Esta venta ya está anulada.");

      const reversion = await tx.operacion.create({
        data: {
          sucursalId: ctx.sucursalId,
          proceso: "AJUSTE",
          fecha: new Date(),
          detalleLibre: `Anulación de la venta ${operacion.id} (${operacion.fecha.toISOString().slice(0, 10)}).`,
          usuarioId: ctx.usuarioId,
        },
      });

      const filas: Prisma.MovimientoStockCreateManyInput[] = operacion.movimientos.map((m) => ({
        operacionId: reversion.id,
        productoId: m.productoId,
        seccionId: m.seccionId,
        proceso: m.proceso === "LIQUIDACION_CONSIGNACION" ? "LIQUIDACION_CONSIGNACION" : "AJUSTE",
        cantidad: -Number(m.cantidad),
        loteVencimiento: m.loteVencimiento,
        detalle: `Anulación de venta: revierte "${m.detalle}".`,
        precioTotal: -Number(m.precioTotal),
        precioPorUnidadStock: Number(m.precioPorUnidadStock),
      }));
      await tx.movimientoStock.createMany({ data: filas });

      await tx.operacion.update({ where: { id: operacion.id }, data: { anuladaEn: new Date(), anuladaPorId: ctx.usuarioId } });

      return ok(`Venta anulada. Se revirtieron ${filas.length} línea(s) de stock${filas.some((f) => f.proceso === "LIQUIDACION_CONSIGNACION") ? " y la liquidación de consignación" : ""}.`);
    });
  });
}
