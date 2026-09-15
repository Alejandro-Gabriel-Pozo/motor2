"use server";

import type { DestinoConsumo, MotivoMerma, Prisma, Proceso } from "@prisma/client";
import { prisma } from "@/lib/db";
import { texto } from "@/core/texto";
import {
  ACCION_POR_PROCESO,
  TRANSICIONES,
  esSignoFijo,
  productoValidoParaProceso,
  redondearACantidadDeUnidad,
  redondearMoneda,
} from "@/core/movimientos/transiciones";
import { obtenerLoteMasProximoAVencer, resolverConsumoPorFamilia, seccionesConStock, validarStockSuficiente } from "@/core/movimientos/stock";
import { conTransaccionSerializable } from "@/core/movimientos/con-reintento";
import { upsertProveedorPorProducto } from "./proveedor-por-producto";
import { conPermiso } from "./con-permiso";
import { error, type ResultadoAccion } from "./tipos";

/** Procesos que pasan por este motor genérico — Venta (registrarVenta) y Control (registrarConteoFisico, conteo-fisico.ts) tienen cada uno su propio camino, mismo criterio que Apps Script (armarPreviaVentaDesdeItems_/_registrarConteoFisicoSinRecalculo_ nunca pasan por armarRegistroMovimiento_). LIQUIDACION_CONSIGNACION nunca la elige un usuario. */
export type ProcesoGenerico = Exclude<Proceso, "VENTA" | "CONTROL" | "LIQUIDACION_CONSIGNACION">;

export interface ItemMovimientoInput {
  productoId: string;
  /** Ajuste: delta YA con signo (puede ser negativo, o 0 si permiteCero). Cualquier otro proceso: magnitud positiva. */
  cantidad: number;
  loteVencimiento?: Date | null;
  /** Compra/Devolución a Proveedor: importe real de la factura para ESTA línea (no un precio unitario a calcular a mano). */
  precioTotal?: number;
  /** Compra/Devolución a Proveedor: cuando el producto se compra "por unidad" pero el contenido pesa distinto cada vez (carne, fiambre) — se usa tal cual como cantidad final de stock. */
  pesoReal?: number | null;
  /** Presentación de compra alternativa (Presentacion.unidadCompraId) — si no es una presentación real y activa de este producto, se ignora y sigue con la default. */
  unidadCompraId?: string | null;
}

export interface DatosMovimientoInput {
  proceso: ProcesoGenerico;
  fecha: Date;
  seccionId: string;
  /** Solo Transferencia. */
  seccionDestinoId?: string;
  proveedorId?: string;
  nroFactura?: string;
  /** Solo Merma. */
  motivo?: MotivoMerma;
  /** Solo Consumo. */
  destino?: DestinoConsumo;
  detalleLibre?: string;
  items: ItemMovimientoInput[];
}

interface LineaCalculada {
  productoId: string;
  /** Valor final a persistir en MovimientoStock.cantidad (ya con signo). */
  cantidadFirmada: number;
  /** Magnitud usada para validar stock suficiente (siempre positiva). */
  cantidadIngresada: number;
  loteVencimiento: Date | null;
  detalle: string;
  precioTotal: number;
  precioPorUnidadStock: number;
  /** Solo Compra: para enganchar upsertProveedorPorProducto (Catálogo). */
  precioUnitario: number;
  unidadCompraId: string | null;
  consumosReceta: { productoId: string; cantidad: number; loteVencimiento: Date | null }[];
  /** true si se aplicó factor de conversión o peso real — para el aviso final "se convirtió automáticamente". */
  huboConversion: boolean;
}

/**
 * Port de calcularConsumosProduccion_ (Movimientos.js:632-659): al Producir
 * algo con receta, expande cada ingrediente a 1+ líneas de Consumo, con
 * reparto entre "hermanos" del mismo Insumo (resolverConsumoPorFamilia) si
 * el puntual no alcanza.
 */
async function calcularConsumosProduccion(
  productoId: string,
  cantidadProducida: number,
  seccionId: string,
  tx: Prisma.TransactionClient
): Promise<{ productoId: string; cantidad: number; loteVencimiento: Date | null }[]> {
  const receta = await tx.recetaVersion.findFirst({ where: { productoId }, orderBy: { version: "desc" }, include: { ingredientes: true } });
  if (!receta?.ingredientes.length) return [];

  const partes: { productoId: string; cantidad: number; loteVencimiento: Date | null }[] = [];
  for (const ing of receta.ingredientes) {
    const cantidadSalida = cantidadProducida * Number(ing.cantidad) * (1 + Number(ing.mermaPorcentaje) / 100);
    const reparto = await resolverConsumoPorFamilia(ing.insumoProductoId, cantidadSalida, seccionId, tx);
    partes.push(...reparto);
  }
  return partes;
}

/** Port de armarRegistroMovimiento_ (Movimientos.js:724-872) para UNA línea. */
async function armarLineaMovimiento(
  item: ItemMovimientoInput,
  datos: DatosMovimientoInput,
  tx: Prisma.TransactionClient
): Promise<{ ok: true; linea: LineaCalculada | null } | { ok: false; mensaje: string }> {
  const transicion = TRANSICIONES[datos.proceso];
  const producto = await tx.producto.findUnique({ where: { id: item.productoId }, include: { unidadStock: true, unidadCompra: true } });
  if (!producto || !producto.activo) return { ok: false, mensaje: `El producto no existe o está inactivo.` };

  if (!productoValidoParaProceso(datos.proceso, producto)) {
    return { ok: false, mensaje: `"${producto.nombre}" no está habilitado para el proceso "${datos.proceso}" (revisá Tipo/"Se produce"/Consignación).` };
  }

  let numCant: number | null = item.cantidad;
  if (transicion.permiteCero) {
    numCant = numCant ?? 0;
  } else if (numCant === null || !(numCant > 0)) {
    return { ok: true, linea: null }; // sin cantidad válida: se saltea, mismo criterio que Apps Script
  }

  // Conversión de unidad de Compra → unidad de Stock (Compra/Devolución a
  // Proveedor), con Presentación alternativa si se eligió una real y activa.
  let cantidadStock = numCant;
  let unidadCompraId: string | null = null;
  let factor = Number(producto.factorConversion) || 1;
  let huboConversion = false;
  let detalle = "";

  if (transicion.aplicaFactorConversion) {
    unidadCompraId = producto.unidadCompraId;
    if (item.unidadCompraId) {
      const presentacion = await tx.presentacion.findFirst({
        where: { productoId: producto.id, unidadCompraId: item.unidadCompraId, activa: true },
      });
      if (presentacion) {
        unidadCompraId = presentacion.unidadCompraId;
        factor = Number(presentacion.factorConversion);
      }
    }

    const pesoReal = item.pesoReal && item.pesoReal > 0 ? item.pesoReal : null;
    if (pesoReal !== null) {
      cantidadStock = pesoReal;
      detalle = `Peso real: ${pesoReal} ${producto.unidadStock.nombre} (${numCant} compradas)`;
      huboConversion = true;
    } else if (factor !== 1) {
      cantidadStock = numCant * factor;
      detalle = `${numCant} × ${factor} = ${cantidadStock} ${producto.unidadStock.nombre}`;
      huboConversion = true;
    }
  }

  // Decimales por unidad: la barrera real de lo que entra al Kardex, no
  // solo el `step` de un input — se aplica DESPUÉS de la conversión (la
  // que puede dejar más decimales de la cuenta, ej. 3 CJ × 4.5 factor).
  cantidadStock = redondearACantidadDeUnidad(cantidadStock, producto.unidadStock.decimales);

  const precioTotal = item.precioTotal && item.precioTotal > 0 ? item.precioTotal : 0;
  const precioUnitario = precioTotal > 0 && numCant > 0 ? precioTotal / numCant : 0;
  const precioPorUnidadStock = precioTotal > 0 && cantidadStock > 0 ? precioTotal / cantidadStock : 0;

  // FEFO simplificado — solo Consumo asume el lote que vence antes si no
  // se especificó uno (Movimientos.js:678, PROCESOS_CON_LOTE_AUTOMATICO_AL_VENCER).
  let loteVencimiento = item.loteVencimiento ?? null;
  if (!loteVencimiento && datos.proceso === "CONSUMO") {
    loteVencimiento = await obtenerLoteMasProximoAVencer(producto.id, datos.seccionId, tx);
  }

  const cantidadFirmada = esSignoFijo(datos.proceso)
    ? redondearACantidadDeUnidad(cantidadStock * transicion.signoStock, producto.unidadStock.decimales)
    : cantidadStock; // Ajuste: ya viene firmado en `numCant` (aplicaFactorConversion siempre false acá).

  const consumosReceta = transicion.generaConsumoDeReceta
    ? await calcularConsumosProduccion(producto.id, Math.abs(cantidadFirmada), datos.seccionId, tx)
    : [];

  return {
    ok: true,
    linea: {
      productoId: producto.id,
      cantidadFirmada,
      cantidadIngresada: Math.abs(cantidadStock),
      loteVencimiento,
      detalle: detalle || datos.proceso,
      precioTotal,
      precioPorUnidadStock,
      precioUnitario,
      unidadCompraId,
      consumosReceta,
      huboConversion,
    },
  };
}

/**
 * Port de confirmarRegistrarMovimientos (Movimientos.js:876-1136) para los
 * 9 procesos que comparten este motor (Compra, Producción, Consumo,
 * Ajuste, Transferencia, Merma, Devolución×3) — Venta y Control (Conteo
 * Físico) tienen su propia acción, ver registrarVenta/registrarConteoFisico.
 */
export async function registrarMovimiento(datos: DatosMovimientoInput): Promise<ResultadoAccion> {
  const accionClave = ACCION_POR_PROCESO[datos.proceso];
  if (!accionClave) return error(`Proceso "${datos.proceso}" no se registra con esta acción.`);

  return conPermiso(accionClave, async (ctx) => {
    if (!datos.items.length) return error("Cargá al menos un producto con cantidad.");
    if (!texto(datos.seccionId)) return error("Elegí una sección.");

    if (datos.proceso === "TRANSFERENCIA") {
      if (!datos.seccionDestinoId) return error("La sección destino no puede estar vacía.");
      if (datos.seccionDestinoId === datos.seccionId) {
        return error("La sección destino no puede ser la misma que el origen: no habría nada que mover.");
      }
    }

    // Chequeo de factura duplicada (Movimientos.js:402-416): mismo
    // proveedor + mismo número de factura ya cargados como Compra en esta
    // sucursal — una factura sin número no se puede comparar, no bloquea.
    if (datos.proceso === "COMPRA" && datos.proveedorId && texto(datos.nroFactura)) {
      const yaExiste = await prisma.operacion.findFirst({
        where: { sucursalId: ctx.sucursalId, proceso: "COMPRA", proveedorId: datos.proveedorId, nroFactura: texto(datos.nroFactura) },
      });
      if (yaExiste) {
        return error(`Ya hay una compra registrada con esa factura para este proveedor. Si es una corrección, usá Ajuste en vez de volver a cargarla.`);
      }
    }

    const resultado = await conTransaccionSerializable(async (tx) => {
      // 1) Armar cada línea (validación de producto/proceso, conversión, receta).
      const lineas: LineaCalculada[] = [];
      for (const item of datos.items) {
        const armado = await armarLineaMovimiento(item, datos, tx);
        if (!armado.ok) return error(armado.mensaje);
        if (armado.linea) lineas.push(armado.linea);
      }
      if (!lineas.length) return error("Ninguna línea tiene una cantidad válida.");

      // 2) Validación de stock AGREGADA por clave producto+sección dentro
      // de TODO el payload, antes de escribir nada (bugfix C-1,
      // Movimientos.js:910-961): dos líneas pidiendo el mismo
      // producto+sección se suman antes de comparar contra el saldo —
      // nunca se valida cada una aislada.
      const transicion = TRANSICIONES[datos.proceso];
      const requeridoPorClave = new Map<string, { productoId: string; seccionId: string; cantidad: number }>();
      const acumular = (productoId: string, seccionId: string, cantidad: number) => {
        if (!(cantidad > 0)) return;
        const key = `${productoId}||${seccionId}`;
        const previo = requeridoPorClave.get(key);
        requeridoPorClave.set(key, { productoId, seccionId, cantidad: (previo?.cantidad ?? 0) + cantidad });
      };
      for (const l of lineas) {
        if (datos.proceso === "TRANSFERENCIA") acumular(l.productoId, datos.seccionId, l.cantidadIngresada);
        else if (transicion.signoStock < 0) acumular(l.productoId, datos.seccionId, l.cantidadIngresada);
        else if (transicion.signoStock === 0 && l.cantidadFirmada < 0) acumular(l.productoId, datos.seccionId, -l.cantidadFirmada);

        for (const c of l.consumosReceta) acumular(c.productoId, datos.seccionId, c.cantidad);
      }
      for (const { productoId, seccionId, cantidad } of requeridoPorClave.values()) {
        const chequeo = await validarStockSuficiente(productoId, seccionId, cantidad, tx);
        if (!chequeo.ok) {
          const producto = await tx.producto.findUnique({ where: { id: productoId } });
          const pista = await seccionesConStock(productoId, ctx.sucursalId, tx);
          const detallePista = pista.length ? ` Tiene stock en: ${pista.join(", ")}.` : "";
          return error(
            `Stock insuficiente para "${producto?.nombre ?? productoId}". Actual: ${chequeo.actual}, requerido: ${chequeo.requerido}.${detallePista}`
          );
        }
      }

      // 3) Escribir Operacion (encabezado) + MovimientoStock[] (líneas).
      const operacion = await tx.operacion.create({
        data: {
          sucursalId: ctx.sucursalId,
          proceso: datos.proceso,
          fecha: datos.fecha,
          proveedorId: datos.proveedorId ?? null,
          nroFactura: texto(datos.nroFactura) || null,
          seccionDestinoId: datos.proceso === "TRANSFERENCIA" ? datos.seccionDestinoId : null,
          motivo: datos.motivo ?? null,
          destino: datos.destino ?? null,
          detalleLibre: texto(datos.detalleLibre) || null,
          usuarioId: ctx.usuarioId,
        },
      });

      const filas: Prisma.MovimientoStockCreateManyInput[] = [];

      if (datos.proceso === "TRANSFERENCIA") {
        for (const l of lineas) {
          filas.push({
            operacionId: operacion.id, productoId: l.productoId, seccionId: datos.seccionId, proceso: "TRANSFERENCIA",
            cantidad: -l.cantidadIngresada, loteVencimiento: l.loteVencimiento,
            detalle: `Transferencia: sale hacia la sección destino (${l.cantidadIngresada}).`, precioTotal: 0, precioPorUnidadStock: 0,
          });
          filas.push({
            operacionId: operacion.id, productoId: l.productoId, seccionId: datos.seccionDestinoId!, proceso: "TRANSFERENCIA",
            cantidad: l.cantidadIngresada, loteVencimiento: l.loteVencimiento,
            detalle: `Transferencia: entra desde la sección origen (${l.cantidadIngresada}).`, precioTotal: 0, precioPorUnidadStock: 0,
          });
        }
      } else {
        for (const l of lineas) {
          filas.push({
            operacionId: operacion.id, productoId: l.productoId, seccionId: datos.seccionId, proceso: datos.proceso,
            cantidad: l.cantidadFirmada, loteVencimiento: l.loteVencimiento,
            detalle: l.detalle, precioTotal: l.precioTotal, precioPorUnidadStock: l.precioPorUnidadStock,
          });

          for (const c of l.consumosReceta) {
            filas.push({
              operacionId: operacion.id, productoId: c.productoId, seccionId: datos.seccionId, proceso: "CONSUMO",
              cantidad: -c.cantidad, loteVencimiento: c.loteVencimiento,
              detalle: "Consumo por producción.", precioTotal: 0, precioPorUnidadStock: 0,
            });

            // Sesión "consignación": si el insumo consumido está marcado
            // esConsignacion, ACÁ (al producir) es cuando se lo consume de
            // verdad — cantidad SIEMPRE 0 (el stock ya lo movió la Compra
            // de recepción), fila puramente financiera. Quién es el
            // consignante se lee vía FK (producto.proveedorConsignacion),
            // no hace falta duplicarlo en la fila (a diferencia de Apps
            // Script, que no podía hacer ese join).
            const consumido = await tx.producto.findUnique({ where: { id: c.productoId } });
            if (consumido?.esConsignacion) {
              filas.push({
                operacionId: operacion.id, productoId: c.productoId, seccionId: datos.seccionId, proceso: "LIQUIDACION_CONSIGNACION",
                cantidad: 0, loteVencimiento: null,
                detalle: "Liquidación consignación por producción.",
                precioTotal: redondearMoneda(c.cantidad * Number(consumido.precioConsignacion ?? 0)),
                precioPorUnidadStock: redondearMoneda(Number(consumido.precioConsignacion ?? 0)),
              });
            }
          }
        }
      }

      await tx.movimientoStock.createMany({ data: filas });

      const avisoConversion = lineas.some((l) => l.huboConversion)
        ? " Algunas cantidades se convirtieron automáticamente de unidad de compra a unidad de stock."
        : "";

      return {
        ok: true as const,
        mensaje: `Se guardaron ${filas.length} movimiento(s).${avisoConversion}`,
        // Solo se usa para el hookup de Compra, fuera de la transacción — ver más abajo.
        lineasParaProveedor: lineas.map((l) => ({
          productoId: l.productoId,
          unidadCompraId: l.unidadCompraId,
          precioUnitario: l.precioUnitario,
          precioPorUnidadStock: l.precioPorUnidadStock,
        })),
      };
    });

    // Compra: engancha upsertProveedorPorProducto (Catálogo, sin usar
    // todavía) — FUERA de la transacción principal y sin bloquear su
    // resultado si falla, mismo criterio "best effort" que
    // actualizarProveedoresDesdeCompra_ (Catalogo.js:3617-3657, envuelta en
    // try/catch en confirmarRegistrarMovimientos): el Kardex ya quedó bien
    // escrito, esto solo alimenta la comparativa de precios. Se registra
    // la relación en TODOS los casos con unidad de compra conocida (incluso
    // sin precio, mismo bugfix que Catalogo.js:3635-3644: si se cortara acá
    // por falta de precio, ese proveedor nunca acumularía historial).
    if (resultado.ok && datos.proceso === "COMPRA" && datos.proveedorId) {
      for (const l of resultado.lineasParaProveedor) {
        if (!l.unidadCompraId) continue;
        try {
          await upsertProveedorPorProducto({
            productoId: l.productoId,
            proveedorId: datos.proveedorId,
            unidadCompraId: l.unidadCompraId,
            precioUnitario: l.precioUnitario,
            precioPorUnidadStock: l.precioPorUnidadStock,
            fechaCompra: datos.fecha,
          });
        } catch (e) {
          console.error(`upsertProveedorPorProducto falló para producto ${l.productoId}: ${(e as Error).message}`);
        }
      }
    }

    return { ok: resultado.ok, mensaje: resultado.mensaje };
  });
}
