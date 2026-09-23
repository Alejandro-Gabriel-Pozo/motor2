"use server";

import type { DestinoConsumoLegacy, MotivoMermaLegacy, Prisma, Proceso } from "@prisma/client";
import { prisma } from "@/lib/db";
import { texto, validarLargoTexto, LARGO_MAXIMO_NRO_FACTURA } from "@/core/texto";
import { esNumeroFinito } from "@/core/numero";
import {
  ACCION_POR_PROCESO,
  TRANSICIONES,
  esSignoFijo,
  productoValidoParaProceso,
  redondearACantidadDeUnidad,
  redondearMoneda,
} from "@/core/movimientos/transiciones";
import { obtenerLoteMasProximoAVencer, obtenerSeccionPropia, resolverConsumoPorFamilia, seccionesConStock, validarStockSuficiente } from "@/core/movimientos/stock";
import { productoDisponibleEn } from "@/core/catalogo/disponibilidad-producto-consulta";
import { conTransaccionSerializable } from "@/core/movimientos/con-reintento";
import { calcularPayloadHash, chequearIdempotencia, esClaveIdempotenciaValida, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "@/core/movimientos/idempotencia";
import { crearCacheProducto } from "@/core/movimientos/producto-cache";
import { esChoqueDeFacturaUnica, MENSAJE_FACTURA_DUPLICADA } from "@/core/movimientos/factura-unica";
import { upsertProveedorPorProducto } from "../catalogo/upsert-proveedor-por-producto";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";

/** Procesos que pasan por este motor genérico — Venta (registrarVenta), Control (registrarConteoFisico, conteo-fisico.ts), Reclasificación (reclasificarStock, reclasificacion.ts) y los 3 pasos de Traspasos entre sucursales (traspasos.ts) tienen cada uno su propio camino, mismo criterio que Apps Script (armarPreviaVentaDesdeItems_/_registrarConteoFisicoSinRecalculo_/dividirClasificacionStock_/escribirMovimientoTransferenciaSucursal_ nunca pasan por armarRegistroMovimiento_). LIQUIDACION_CONSIGNACION nunca la elige un usuario. */
export type ProcesoGenerico = Exclude<
  Proceso,
  "VENTA" | "CONTROL" | "LIQUIDACION_CONSIGNACION" | "RECLASIFICACION" | "TRANSFERENCIA_SALIDA_SUCURSAL" | "TRANSFERENCIA_ENTRADA_SUCURSAL" | "REINGRESO_TRANSFERENCIA_SUCURSAL"
>;

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
  /** Compra/Devolución a Proveedor: cómo llama el proveedor a este producto — se guarda en ProveedorPorProducto, puramente informativo. */
  referenciaProveedor?: string;
}

export interface DatosMovimientoInput {
  proceso: ProcesoGenerico;
  fecha: Date;
  seccionId: string;
  /** Solo Transferencia. */
  seccionDestinoId?: string;
  proveedorId?: string;
  nroFactura?: string;
  /** Solo Merma. TRANSITORIO — apunta al enum legacy hasta P5 (plan "motivos de Consumo/Merma como catálogo administrable", 2026-09-23), donde pasa a ser un motivoId contra el catálogo nuevo. */
  motivo?: MotivoMermaLegacy;
  /** Solo Consumo. TRANSITORIO — ver el comentario de `motivo`. */
  destino?: DestinoConsumoLegacy;
  detalleLibre?: string;
  items: ItemMovimientoInput[];
  /** I3 — UUID generado por el cliente al abrir el formulario, reenviado tal cual en reintentos. Opcional durante el rollout (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md §9.3). */
  claveIdempotencia?: string;
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
  referenciaProveedor: string | undefined;
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
  tx: Prisma.TransactionClient,
  obtenerProducto: ReturnType<typeof crearCacheProducto>
): Promise<{ productoId: string; cantidad: number; loteVencimiento: Date | null }[]> {
  const receta = await tx.recetaVersion.findFirst({ where: { productoId }, orderBy: { version: "desc" }, include: { ingredientes: true } });
  if (!receta?.ingredientes.length) return [];

  const partes: { productoId: string; cantidad: number; loteVencimiento: Date | null }[] = [];
  for (const ing of receta.ingredientes) {
    const cantidadSalida = cantidadProducida * Number(ing.cantidad) * (1 + Number(ing.mermaPorcentaje) / 100);
    const reparto = await resolverConsumoPorFamilia(ing.insumoProductoId, cantidadSalida, seccionId, tx, obtenerProducto);
    partes.push(...reparto);
  }
  return partes;
}

/** Port de armarRegistroMovimiento_ (Movimientos.js:724-872) para UNA línea. */
async function armarLineaMovimiento(
  item: ItemMovimientoInput,
  datos: DatosMovimientoInput,
  tx: Prisma.TransactionClient,
  obtenerProducto: ReturnType<typeof crearCacheProducto>,
  sucursalId: string,
  sucursalNombre: string
): Promise<{ ok: true; linea: LineaCalculada | null } | { ok: false; mensaje: string }> {
  const transicion = TRANSICIONES[datos.proceso];
  const producto = await obtenerProducto(item.productoId);
  if (!producto) return { ok: false, mensaje: `El producto no existe.` };
  if (!(await productoDisponibleEn(sucursalId, producto.id, tx))) {
    return { ok: false, mensaje: `«${producto.nombre}» no está disponible en «${sucursalNombre}».` };
  }

  if (!productoValidoParaProceso(datos.proceso, producto)) {
    return { ok: false, mensaje: `"${producto.nombre}" no está habilitado para el proceso "${datos.proceso}" (revisá Tipo/"Se produce"/Consignación).` };
  }

  let numCant: number | null = item.cantidad;
  if (transicion.permiteCero) {
    numCant = numCant ?? 0;
  } else if (numCant === null || !(numCant > 0)) {
    return { ok: true, linea: null }; // sin cantidad válida: se saltea, mismo criterio que Apps Script
  }
  // Llegado acá numCant es > 0 (o, en Ajuste, cualquier número): `> 0` no frena Infinity ni NaN en Ajuste.
  if (!esNumeroFinito(numCant)) return { ok: false, mensaje: `La cantidad de "${producto.nombre}" no es un número válido.` };
  if (item.precioTotal && item.precioTotal > 0 && !esNumeroFinito(item.precioTotal)) {
    return { ok: false, mensaje: `El precio de "${producto.nombre}" no es un número válido.` };
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
    ? await calcularConsumosProduccion(producto.id, Math.abs(cantidadFirmada), datos.seccionId, tx, obtenerProducto)
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
      referenciaProveedor: texto(item.referenciaProveedor) || undefined,
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
    if (datos.claveIdempotencia !== undefined && !esClaveIdempotenciaValida(datos.claveIdempotencia)) {
      return error("Clave de reintento inválida.");
    }

    if (datos.proceso === "TRANSFERENCIA") {
      if (!datos.seccionDestinoId) return error("La sección destino no puede estar vacía.");
      if (datos.seccionDestinoId === datos.seccionId) {
        return error("La sección destino no puede ser la misma que el origen: no habría nada que mover.");
      }
    }

    // Fase 6 (auditoría de seguridad/contratos): conPermiso ya validó el
    // permiso en LA SUCURSAL DEL QUE LLAMA, nunca que la sección que mandó
    // el cliente sea realmente de esa sucursal — sin esto, cualquier
    // seccionId ajeno (de otra sucursal) se aceptaba igual.
    if (!(await obtenerSeccionPropia(datos.seccionId, ctx.sucursalId))) return error("No se encontró la sección.");
    if (datos.proceso === "TRANSFERENCIA" && !(await obtenerSeccionPropia(datos.seccionDestinoId!, ctx.sucursalId))) {
      return error("No se encontró la sección destino.");
    }

    const errorLargoFactura = validarLargoTexto(datos.nroFactura, "El número de factura", LARGO_MAXIMO_NRO_FACTURA);
    if (errorLargoFactura) return error(errorLargoFactura);

    // Chequeo de factura duplicada (Movimientos.js:402-416): mismo
    // proveedor + mismo número de factura ya cargados como Compra en esta
    // sucursal — una factura sin número no se puede comparar, no bloquea.
    // Camino RÁPIDO para el caso secuencial (el 99,99%): rechaza antes de
    // abrir la transacción, con un mensaje inmediato. Bajo concurrencia
    // real (dos requests simultáneos con la misma factura) este `findFirst`
    // no alcanza — ninguno de los dos ve todavía la Operacion del otro
    // (TOCTOU clásico). El árbitro real es el índice único parcial
    // `Operacion_factura_unica_vigente_key` (docs/auditoria-motor2-plan-i3-
    // idempotencia-2026-09-17.md §9.2): su violación se atrapa más abajo,
    // fuera de la transacción (ya hizo rollback para cuando el `.catch`
    // la recibe).
    if (datos.proceso === "COMPRA" && datos.proveedorId && texto(datos.nroFactura)) {
      const yaExiste = await prisma.operacion.findFirst({
        // Solo cuentan las compras vigentes: una compra anulada deja libre su N.º de factura (igual que el índice único).
        where: { sucursalId: ctx.sucursalId, proceso: "COMPRA", proveedorId: datos.proveedorId, nroFactura: texto(datos.nroFactura), anuladaEn: null },
      });
      if (yaExiste) return error(MENSAJE_FACTURA_DUPLICADA);
    }

    const resultado = await conTransaccionSerializable(async (tx) => {
      // 0) I3 — idempotencia: chequeo antes de cualquier lógica de negocio.
      const payloadHash = datos.claveIdempotencia
        ? calcularPayloadHash(datos.proceso, ctx.sucursalId, { ...datos, claveIdempotencia: undefined })
        : "";
      const chequeo = await chequearIdempotencia(tx, datos.claveIdempotencia, payloadHash);
      if (chequeo.estado === "duplicado") return { ok: true as const, mensaje: chequeo.mensaje, lineasParaProveedor: [] };
      if (chequeo.estado === "conflicto") return error(MENSAJE_CONFLICTO_IDEMPOTENCIA);

      const obtenerProducto = crearCacheProducto(tx);
      // 1) Armar cada línea (validación de producto/proceso, conversión, receta).
      const lineas: LineaCalculada[] = [];
      for (const item of datos.items) {
        const armado = await armarLineaMovimiento(item, datos, tx, obtenerProducto, ctx.sucursalId, ctx.sucursalNombre);
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
          const producto = await obtenerProducto(productoId);
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
          motivoLegacy: datos.motivo ?? null,
          destinoLegacy: datos.destino ?? null,
          detalleLibre: texto(datos.detalleLibre) || null,
          usuarioId: ctx.usuarioId,
          claveIdempotencia: datos.claveIdempotencia ?? null,
          payloadHash: datos.claveIdempotencia ? payloadHash : null,
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
            // La cantidad que sale de resolverConsumoPorFamilia/calcularConsumosProduccion
            // todavía no pasó por ningún redondeo — recién acá, antes de
            // persistir, se ajusta a los decimales que admite la unidad de
            // stock de ESTE insumo (mismo criterio que ya aplica venta.ts
            // para el consumo de receta generado por una venta).
            const consumido = await obtenerProducto(c.productoId);
            const cantidadRedondeada = redondearACantidadDeUnidad(c.cantidad, consumido?.unidadStock.decimales ?? 2);

            filas.push({
              operacionId: operacion.id, productoId: c.productoId, seccionId: datos.seccionId, proceso: "CONSUMO",
              cantidad: -cantidadRedondeada, loteVencimiento: c.loteVencimiento,
              detalle: "Consumo por producción.", precioTotal: 0, precioPorUnidadStock: 0,
            });

            // Sesión "consignación": si el insumo consumido está marcado
            // esConsignacion, ACÁ (al producir) es cuando se lo consume de
            // verdad — cantidad SIEMPRE 0 (el stock ya lo movió la Compra
            // de recepción), fila puramente financiera. Quién es el
            // consignante se lee vía FK (producto.proveedorConsignacion),
            // no hace falta duplicarlo en la fila (a diferencia de Apps
            // Script, que no podía hacer ese join).
            if (consumido?.esConsignacion) {
              filas.push({
                operacionId: operacion.id, productoId: c.productoId, seccionId: datos.seccionId, proceso: "LIQUIDACION_CONSIGNACION",
                cantidad: 0, loteVencimiento: null,
                detalle: "Liquidación consignación por producción.",
                precioTotal: redondearMoneda(cantidadRedondeada * Number(consumido.precioConsignacion ?? 0)),
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
      const mensaje = `Se guardaron ${filas.length} movimiento(s).${avisoConversion}`;

      // I3 — Opción B (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md
      // §4.5): se persiste el mensaje ya formateado, no se reconstruye.
      if (datos.claveIdempotencia) {
        await tx.operacion.update({ where: { id: operacion.id }, data: { resultadoMensaje: mensaje } });
      }

      return {
        ok: true as const,
        mensaje,
        // Solo se usa para el hookup de Compra, fuera de la transacción — ver más abajo.
        lineasParaProveedor: lineas.map((l) => ({
          productoId: l.productoId,
          unidadCompraId: l.unidadCompraId,
          precioUnitario: l.precioUnitario,
          precioPorUnidadStock: l.precioPorUnidadStock,
          referenciaProveedor: l.referenciaProveedor,
        })),
      };
    }).catch((e) => {
      // La transacción ya hizo rollback para cuando este catch la recibe — nunca se intenta seguir operando
      // sobre ella. Choque de la carrera de factura duplicada (dos requests simultáneos, ver el comentario del
      // chequeo previo más arriba): mismo mensaje de negocio, no un error 500. Cualquier otro P2002 (ej. la
      // clave de idempotencia en carrera) NO lo reconoce esChoqueDeFacturaUnica — sigue de largo como error real.
      if (esChoqueDeFacturaUnica(e)) return error(MENSAJE_FACTURA_DUPLICADA);
      throw e;
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
            referenciaProveedor: l.referenciaProveedor,
          });
        } catch (e) {
          console.error(`upsertProveedorPorProducto falló para producto ${l.productoId}: ${(e as Error).message}`);
        }
      }
    }

    return { ok: resultado.ok, mensaje: resultado.mensaje };
  });
}
