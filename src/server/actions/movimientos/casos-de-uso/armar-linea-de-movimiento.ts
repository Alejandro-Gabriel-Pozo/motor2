import "server-only";
import type { Prisma } from "@prisma/client";
import { texto } from "@/core/texto";
import { esNumeroEstricto } from "@/core/numero";
import { guardLineaCompra } from "@/core/features/compras/compra.guard";
import { TRANSICIONES, esSignoFijo, productoValidoParaProceso, redondearACantidadDeUnidad } from "@/core/movimientos/public";
import type { ConsumoParaFilas } from "@/core/movimientos/armar-filas-de-movimiento";
import {
  obtenerLoteMasProximoAVencer,
  resolverConsumoPorFamilia,
  crearCacheProducto,
} from "@/core/movimientos/public-servidor";
import { productoDisponibleEn } from "@/core/catalogo/public-servidor";
import { rendimientoEfectivo } from "@/core/catalogo/public";
import { cargarPresentacionActiva, cargarRecetaVigenteParaProducir } from "@/server/persistencia/movimientos/cargar-linea-de-movimiento";
import type { DatosMovimientoInput, ItemMovimientoInput } from "@/core/features/movimientos/movimiento.schema";

/**
 * Paso compartido por los casos de uso de `movimientos/casos-de-uso/` (Task #41, Fase M, M13a — precedente:
 * `traspasos/casos-de-uso/producto-transferible.ts`): arma UNA línea del motor genérico (`armarLineaMovimiento`, port de
 * `armarRegistroMovimiento_`, Movimientos.js:724-872) y, si el proceso es Producción, expande cada ingrediente de su receta a 1+
 * líneas de Consumo (`calcularConsumosProduccion`, port de `calcularConsumosProduccion_`, Movimientos.js:632-659). No es un caso de
 * uso propio ni un endpoint: por eso `import "server-only"` y SIN `"use server"`, y puede leer `server/persistencia/`.
 *
 * Mudadas TAL CUAL desde `src/server/actions/movimientos/movimientos.ts` — las ÚNICAS líneas que cambiaron son las dos lecturas de
 * Prisma directas, que ahora pasan por `cargarPresentacionActiva`/`cargarRecetaVigenteParaProducir`
 * (server/persistencia/movimientos/cargar-linea-de-movimiento.ts).
 */
export interface LineaCalculada {
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
  consumosReceta: ConsumoParaFilas[];
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
  sucursalId: string,
  tx: Prisma.TransactionClient,
  obtenerProducto: ReturnType<typeof crearCacheProducto>
): Promise<ConsumoParaFilas[]> {
  const ingredientes = await cargarRecetaVigenteParaProducir(tx, { productoId, sucursalId });
  if (!ingredientes.length) return [];

  const partes: ConsumoParaFilas[] = [];
  for (const ing of ingredientes) {
    // rendimientoEfectivo (D2) — misma fórmula textual, solo cambia de dónde salen cantidad/merma (ver registrar-venta.ts).
    const ef = rendimientoEfectivo({ cantidad: ing.cantidad, mermaPorcentaje: ing.mermaPorcentaje }, ing.rendimientosLocales, sucursalId);
    const cantidadSalida = cantidadProducida * ef.cantidad * (1 + ef.mermaPorcentaje / 100);
    const reparto = await resolverConsumoPorFamilia(ing.insumoProductoId, cantidadSalida, seccionId, tx, obtenerProducto);
    // Snapshot plano del insumo REAL consumido (puede ser un "hermano", no el ingrediente pedido) — resuelto acá, la única I/O que
    // hacía falta, para que `armarFilasDeMovimiento` (core/movimientos/armar-filas-de-movimiento.ts) sea una función pura.
    for (const r of reparto) {
      const consumido = await obtenerProducto(r.productoId);
      partes.push({
        productoId: r.productoId,
        cantidad: r.cantidad,
        loteVencimiento: r.loteVencimiento,
        decimalesUnidadStock: consumido?.unidadStock.decimales ?? 2,
        esConsignacion: consumido?.esConsignacion ?? false,
        precioConsignacion: Number(consumido?.precioConsignacion ?? 0),
      });
    }
  }
  return partes;
}

/** Port de armarRegistroMovimiento_ (Movimientos.js:724-872) para UNA línea. */
export async function armarLineaMovimiento(
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

  // Presentación de compra alternativa (Compra/Devolución a Proveedor), solo si es real y activa: se busca ANTES de validar la
  // cantidad, porque la cantidad tecleada está en SU unidad de compra.
  const presentacion =
    transicion.aplicaFactorConversion && item.unidadCompraId
      ? await cargarPresentacionActiva(tx, { productoId: producto.id, unidadCompraId: item.unidadCompraId })
      : null;

  let numCant: number;
  let precioEntrada: number;
  let pesoReal: number | null = null;
  if (transicion.aplicaFactorConversion) {
    // Compra y Devolución a proveedor (docs/plan-validacion-de-datos-2026-09-25.md, Paso C1; guard de la feature en
    // src/core/features/compras/compra.guard.ts): un dato inválido RECHAZA el movimiento entero con un mensaje. Antes: una cantidad
    // basura o 0 salteaba la línea en silencio, un precio NaN o negativo se guardaba como 0, un peso real inválido se ignoraba y 2,5
    // en una unidad entera se redondeaba a 3.
    const unidadDeCompra = presentacion?.unidadCompra ?? producto.unidadCompra ?? producto.unidadStock;
    const validada = guardLineaCompra(producto.nombre, { cantidad: item.cantidad, precioTotal: item.precioTotal, pesoReal: item.pesoReal }, unidadDeCompra, producto.unidadStock);
    if (!validada.ok) return { ok: false, mensaje: validada.mensaje };
    numCant = validada.valor.cantidad;
    precioEntrada = validada.valor.precioTotal;
    pesoReal = validada.valor.pesoReal;
  } else {
    let cant: number | null = item.cantidad;
    // Solo una cantidad AUSENTE (null) o en 0 saltea la línea (mismo criterio que Apps Script). Una cantidad que no es un número finito
    // (NaN, Infinity, texto), o negativa donde el proceso no admite signo, rechaza el movimiento: salteada en silencio, el resto se
    // registraría igual.
    if (cant !== null && (typeof cant !== "number" || !Number.isFinite(cant))) {
      return { ok: false, mensaje: `La cantidad de "${producto.nombre}" no es un número válido.` };
    }
    if (transicion.permiteCero) {
      cant = cant ?? 0;
    } else if (cant === null || cant === 0) {
      return { ok: true, linea: null };
    } else if (cant < 0) {
      return { ok: false, mensaje: `La cantidad de "${producto.nombre}" no puede ser negativa.` };
    }
    if (item.precioTotal && item.precioTotal > 0 && !esNumeroEstricto(item.precioTotal)) {
      return { ok: false, mensaje: `El precio de "${producto.nombre}" no es un número válido.` };
    }
    numCant = cant;
    precioEntrada = item.precioTotal && item.precioTotal > 0 ? item.precioTotal : 0;
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
    if (presentacion) {
      unidadCompraId = presentacion.unidadCompraId;
      factor = presentacion.factorConversion;
    }

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

  const precioTotal = precioEntrada;
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
    ? await calcularConsumosProduccion(producto.id, Math.abs(cantidadFirmada), datos.seccionId, sucursalId, tx, obtenerProducto)
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
