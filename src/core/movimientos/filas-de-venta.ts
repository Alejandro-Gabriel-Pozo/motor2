import { importeDeLinea, redondearMoneda, repartirImporte } from "@/core/moneda";
import { texto } from "@/core/texto";
import type { ArrastreDeRedondeo } from "@/core/movimientos/arrastre-redondeo";
import type { VentaCalculada } from "@/core/movimientos/plan-de-la-venta";
import { redondearACantidadDeUnidad } from "@/core/movimientos/transiciones";

/**
 * Las FILAS del Kardex de UNA venta (Hito 5, pieza 5.1, bloque B2b: mudadas TAL CUAL desde el bucle de escritura de `registrarVentaEnTx`, que vive en
 * `server/actions/movimientos/casos-de-uso/registrar-venta-en-tx.ts`). Dada una venta ya calculada (`VentaCalculada`, de `plan-de-la-venta.ts`), el id de la `Operacion` que el caso de uso
 * acaba de crear y el arrastre de redondeo, arma en este orden: por cada consumo su fila CONSUMO (con el redondeo CON ARRASTRE) y, si el producto consumido es de consignación, su
 * LIQUIDACION_CONSIGNACION; después las filas VENTA del PV (una por lote si sale de más de uno). P0: sin Prisma, sin lectura ni escritura — las fichas de los productos ya vienen leídas
 * (`productoDe`, B2a: se leen antes del bucle), el único estado es el arrastre que se muta consumo a consumo (el ORDEN en que se llama `consumir` es parte del contrato: la deuda de un
 * consumo es la de los anteriores del mismo producto, de esta venta o de las anteriores de la sucursal), y la fila es estructural (asignable a `Prisma.MovimientoStockCreateManyInput`).
 * Las claves de cada fila y su ORDEN son las de siempre: los goldens de la venta registran los argumentos de la escritura.
 */

/** Una fila de `MovimientoStock` de una venta, con las columnas que escribe (estructural: asignable a `Prisma.MovimientoStockCreateManyInput`). */
export interface FilaDeVenta {
  operacionId: string;
  productoId: string;
  seccionId: string;
  proceso: "CONSUMO" | "LIQUIDACION_CONSIGNACION" | "VENTA";
  cantidad: number;
  cantidadExacta?: number | null;
  loteVencimiento: Date | null;
  detalle: string;
  precioTotal: number;
  precioPorUnidadStock: number;
  sustituyeAProductoId?: string;
  costoUnitarioVenta?: number | null;
  precioListaUnitario?: number | null;
}

/**
 * Lo único que las filas miran de la ficha de un producto: su nombre (el detalle de un consumo de sustituto nombra al producto que reemplazó), si es de consignación y a qué precio, y los
 * decimales de su unidad de stock. `precioConsignacion` llega como lo trae la base (un `Decimal`, que se lee con `Number()` como siempre) o `null`.
 */
export interface ProductoParaFilas {
  nombre: string;
  esConsignacion: boolean;
  precioConsignacion: unknown;
  unidadStock: { decimales: number };
}

/**
 * Las filas de una venta, en el orden en que se escriben. `detalle` es el detalle libre de la venta tal como llegó (`DatosVentaEnTx.detalle`): sin texto, la fila VENTA dice «Venta». MUTA
 * el arrastre de redondeo (un `consumir` por consumo, en el orden de `venta.consumos`).
 */
export function filasDeUnaVenta(
  venta: VentaCalculada,
  operacionId: string,
  { detalle, productoDe, arrastre }: { detalle: string | undefined; productoDe: (productoId: string) => ProductoParaFilas | null | undefined; arrastre: ArrastreDeRedondeo }
): FilaDeVenta[] {
  const filas: FilaDeVenta[] = [];
  for (const c of venta.consumos) {
    const consumido = productoDe(c.productoId);
    // Redondeo CON ARRASTRE (Task #27, docs/plan-redondeo-consumo-fraccionado-2026-09-26.md) — reemplaza el redondeo "a secas" de
    // cada parte por separado (`redondearACantidadDeUnidad(c.cantidad, decimales)`, el bug: dos medias pizzas consumían 2 bollos
    // en vez de 1). Con deuda 0 (el caso de siempre para un producto que nunca dejó resto) el resultado es IDÉNTICO al de antes;
    // con deuda, la parte que sobró o faltó de consumos anteriores del MISMO producto en esta sucursal (`cargarDeudaDeRedondeo`,
    // en `server/lecturas/movimientos/deuda-de-redondeo.ts`) se suma antes de redondear, así que el TOTAL de la sucursal converge al consumo exacto en vez de que cada parte
    // redondee de forma independiente. `cantidadExacta` (con el mismo signo que `cantidad`) solo se llena cuando difiere de lo
    // escrito — alimenta la deuda de la PRÓXIMA venta (`cargarDeudaDeRedondeo`) y la reversión exacta de esta (`anularVenta`).
    const { cantidad: cantidadRedondeada, cantidadExacta } = arrastre.consumir(c.productoId, c.cantidad, consumido?.unidadStock.decimales ?? 2);
    // D6 (docs/plan-sustitucion-insumos-receta-2026-09-26.md): solo si esta parte vino de un sustituto — un consumo de un
    // HERMANO del mismo Insumo (el caso de siempre) deja el objeto IDÉNTICO a hoy, sin la columna ni el detalle distinto.
    const detalleDelConsumo = c.sustituyeAProductoId
      ? `Consumo por venta de "${venta.nombre}" — SUSTITUTO de "${productoDe(c.sustituyeAProductoId)?.nombre ?? c.sustituyeAProductoId}" (no había stock).`
      : `Consumo por venta de "${venta.nombre}".`;
    filas.push({
      operacionId, productoId: c.productoId, seccionId: c.seccionId, proceso: "CONSUMO",
      cantidad: -cantidadRedondeada, cantidadExacta: cantidadExacta === null ? null : -cantidadExacta, loteVencimiento: c.loteVencimiento,
      detalle: detalleDelConsumo, precioTotal: 0, precioPorUnidadStock: 0,
      ...(c.sustituyeAProductoId ? { sustituyeAProductoId: c.sustituyeAProductoId } : {}),
    });

    if (consumido?.esConsignacion) {
      filas.push({
        operacionId, productoId: c.productoId, seccionId: c.seccionId, proceso: "LIQUIDACION_CONSIGNACION",
        cantidad: 0, loteVencimiento: null,
        detalle: `Liquidación consignación por venta de "${venta.nombre}".`,
        precioTotal: importeDeLinea(cantidadRedondeada, Number(consumido.precioConsignacion ?? 0)),
        precioPorUnidadStock: redondearMoneda(Number(consumido.precioConsignacion ?? 0)),
      });
    }
  }

  // El PV vendido en sí: signoStock -1 (Movimientos.js:190-205) — si
  // no tiene stock real (no "Se produce"), este saldo negativo es un
  // artefacto contable de las ventas, mismo criterio que hoy.
  const importeVenta = importeDeLinea(venta.cantidadVendida, venta.precioVenta);
  // El PV que se produce y sale de más de un lote (O.40 (1)) deja UNA fila VENTA por lote: la cantidad de cada parte (la última, lo que resta, para que la suma sea exacta) y el importe repartido
  // con `repartirImporte` por cantidad (la suma de los importes es exactamente `importeVenta`). Un solo lote, o cualquier otro PV: una fila, como siempre.
  const partes = venta.partesPropias && venta.partesPropias.length > 1 ? venta.partesPropias : [{ seccionId: venta.seccionId, loteVencimiento: venta.loteVencimiento, cantidad: venta.cantidadVendida }];
  const importes = partes.length > 1 ? repartirImporte(importeVenta, partes.map((p) => p.cantidad)) : [importeVenta];
  let cantidadAsignada = 0;
  partes.forEach((parte, k) => {
    const cantidadDeLaParte = k === partes.length - 1 ? redondearACantidadDeUnidad(venta.cantidadVendida - cantidadAsignada, 4) : redondearACantidadDeUnidad(parte.cantidad, 4);
    cantidadAsignada += cantidadDeLaParte;
    filas.push({
      operacionId, productoId: venta.productoId, seccionId: parte.seccionId, proceso: "VENTA",
      cantidad: -cantidadDeLaParte, loteVencimiento: parte.loteVencimiento,
      detalle: texto(detalle) || "Venta", precioTotal: importes[k]!, precioPorUnidadStock: redondearMoneda(venta.precioVenta),
      costoUnitarioVenta: venta.costoUnitarioAlVender !== null ? redondearMoneda(venta.costoUnitarioAlVender) : null,
      precioListaUnitario: venta.precioListaVenta !== null ? redondearMoneda(venta.precioListaVenta) : null,
    });
  });
  return filas;
}
