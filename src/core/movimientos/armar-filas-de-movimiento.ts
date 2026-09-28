import type { Prisma } from "@prisma/client";
import { importeDeLinea, redondearMoneda } from "@/core/moneda";
import type { ProcesoGenerico } from "@/core/features/movimientos/movimiento.schema";
import { redondearACantidadDeUnidad } from "./transiciones";

/**
 * Un consumo de receta YA resuelto: el `productoId` es el insumo real que se descuenta (puede ser un "hermano" del ingrediente
 * pedido, ver `resolverConsumoPorFamilia`), y `decimalesUnidadStock`/`esConsignacion`/`precioConsignacion` son un snapshot plano de SU
 * producto — resueltos ANTES de llegar acá (en `armarLineaMovimiento`/`calcularConsumosProduccion`, que sí hacen I/O) para que esta
 * función no necesite ningún cliente de base de datos.
 */
export interface ConsumoParaFilas {
  productoId: string;
  /** Cantidad SIN redondear (sale de `resolverConsumoPorFamilia`) — esta función la redondea a `decimalesUnidadStock` antes de armar la fila. */
  cantidad: number;
  loteVencimiento: Date | null;
  decimalesUnidadStock: number;
  esConsignacion: boolean;
  precioConsignacion: number;
}

/** Una línea del movimiento (Compra/Producción/Consumo/Ajuste/Transferencia/Merma/Devolución×3) YA armada por `armarLineaMovimiento`. */
export interface LineaParaFilas {
  productoId: string;
  /** Valor final a persistir en MovimientoStock.cantidad (ya con signo) — usado en TODOS los procesos salvo Transferencia. */
  cantidadFirmada: number;
  /** Magnitud siempre positiva — la que usa Transferencia (una fila de salida y una de entrada, misma cantidad). */
  cantidadIngresada: number;
  loteVencimiento: Date | null;
  detalle: string;
  precioTotal: number;
  precioPorUnidadStock: number;
  consumosReceta: ConsumoParaFilas[];
}

export interface ContextoFilasDeMovimiento {
  operacionId: string;
  proceso: ProcesoGenerico;
  seccionId: string;
  /** Solo Transferencia — el guard de la feature ya exige que no sea null/vacío para ese proceso. */
  seccionDestinoId: string | null;
}

/**
 * Arma las filas `MovimientoStock` de un `registrarMovimiento` YA validado — extraído de `registrarMovimientoCasoDeUso`
 * (backlog post-cierre de Task #41, 2026-09-28, docs/pendientes-sesion-2026-09-27.md §6) como una función PURA: sin I/O, sin
 * `Prisma.TransactionClient`, sin reloj (todas las fechas de lote vienen ya resueltas en `lineas`) — mismo cálculo con la misma
 * entrada siempre da la misma salida, lo que permite reemplazar el `for` en línea original por property-based tests (fast-check)
 * sin multiplicar el costo de la suite completa: la única I/O que ESTA función necesitaba (`obtenerProducto` para el insumo
 * consumido) ya se resolvió antes, en `armarLineaMovimiento`/`calcularConsumosProduccion`.
 *
 * Invariantes garantizados (confirmados por el usuario antes de escribir las property-based tests que los prueban,
 * `test/core/armar-filas-de-movimiento.test.ts`):
 *  - Transferencia: la fila de salida y la de entrada llevan EXACTAMENTE la misma magnitud (`cantidadIngresada`), con signo opuesto.
 *  - Consumo por receta: la cantidad persistida (`-cantidadRedondeada`) nunca es positiva.
 *  - Consignación: la fila financiera (`LIQUIDACION_CONSIGNACION`) siempre tiene cantidad física `0` — nunca vuelve a mover stock.
 *  - La cantidad de cada consumo persiste redondeada a la precisión (`decimalesUnidadStock`) de SU insumo, nunca la cruda.
 *  - Misma entrada canónica (mismo `ctx`, mismas `lineas`) siempre arma las MISMAS filas — sin aleatoriedad ni reloj.
 *  - Ninguna fila para una línea descartada: `armarLineaMovimiento` ya filtra esas antes (nunca llegan a `lineas`), esta función no
 *    vuelve a decidir si una línea participa o no.
 */
export function armarFilasDeMovimiento(ctx: ContextoFilasDeMovimiento, lineas: LineaParaFilas[]): Prisma.MovimientoStockCreateManyInput[] {
  const filas: Prisma.MovimientoStockCreateManyInput[] = [];

  if (ctx.proceso === "TRANSFERENCIA") {
    for (const l of lineas) {
      filas.push({
        operacionId: ctx.operacionId, productoId: l.productoId, seccionId: ctx.seccionId, proceso: "TRANSFERENCIA",
        cantidad: -l.cantidadIngresada, loteVencimiento: l.loteVencimiento,
        detalle: `Transferencia: sale hacia la sección destino (${l.cantidadIngresada}).`, precioTotal: 0, precioPorUnidadStock: 0,
      });
      filas.push({
        operacionId: ctx.operacionId, productoId: l.productoId, seccionId: ctx.seccionDestinoId!, proceso: "TRANSFERENCIA",
        cantidad: l.cantidadIngresada, loteVencimiento: l.loteVencimiento,
        detalle: `Transferencia: entra desde la sección origen (${l.cantidadIngresada}).`, precioTotal: 0, precioPorUnidadStock: 0,
      });
    }
    return filas;
  }

  for (const l of lineas) {
    filas.push({
      operacionId: ctx.operacionId, productoId: l.productoId, seccionId: ctx.seccionId, proceso: ctx.proceso,
      cantidad: l.cantidadFirmada, loteVencimiento: l.loteVencimiento,
      detalle: l.detalle, precioTotal: l.precioTotal, precioPorUnidadStock: l.precioPorUnidadStock,
    });

    for (const c of l.consumosReceta) {
      // Decimales por unidad: la barrera real de lo que entra al Kardex — recién acá, antes de persistir, se ajusta la cantidad
      // cruda de `resolverConsumoPorFamilia`/`calcularConsumosProduccion` a los decimales que admite la unidad de stock de ESTE
      // insumo (mismo criterio que ya aplica venta.ts para el consumo de receta generado por una venta).
      const cantidadRedondeada = redondearACantidadDeUnidad(c.cantidad, c.decimalesUnidadStock);

      filas.push({
        operacionId: ctx.operacionId, productoId: c.productoId, seccionId: ctx.seccionId, proceso: "CONSUMO",
        cantidad: -cantidadRedondeada, loteVencimiento: c.loteVencimiento,
        detalle: "Consumo por producción.", precioTotal: 0, precioPorUnidadStock: 0,
      });

      // Sesión "consignación": si el insumo consumido está marcado esConsignacion, ACÁ (al producir) es cuando se lo consume de
      // verdad — cantidad SIEMPRE 0 (el stock ya lo movió la Compra de recepción), fila puramente financiera.
      if (c.esConsignacion) {
        filas.push({
          operacionId: ctx.operacionId, productoId: c.productoId, seccionId: ctx.seccionId, proceso: "LIQUIDACION_CONSIGNACION",
          cantidad: 0, loteVencimiento: null,
          detalle: "Liquidación consignación por producción.",
          precioTotal: importeDeLinea(cantidadRedondeada, c.precioConsignacion),
          precioPorUnidadStock: redondearMoneda(c.precioConsignacion),
        });
      }
    }
  }

  return filas;
}
