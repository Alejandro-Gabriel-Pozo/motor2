import type { Prisma } from "@prisma/client";

/**
 * Cómo se reconoce la Operación AJUSTE que escribe una anulación (`anularVenta`, `anularCompra`).
 *
 * Anular es un contra-asiento (Kardex append-only): se escribe una Operación AJUSTE nueva con una línea inversa por cada línea de la original, y la original
 * se marca `anuladaEn`. Esa AJUSTE es un mecanismo interno de la anulación, NO un ajuste manual de stock: si un reporte de «diferencias de ajuste» la contara,
 * mostraría como anomalía (o como una señal falsa para recalibrar una merma) algo que es el propio deshacer de una venta o de una compra.
 *
 * La reversión no guarda una referencia a la operación que revierte, así que se reconoce por el comienzo de su `detalleLibre`. Estos prefijos son la ÚNICA fuente:
 * las acciones arman el texto con ellos y los reportes lo reconocen con ellos. Una venta anulada antes de que existiera este módulo usa el mismo prefijo, así
 * que también queda cubierta.
 */
const PREFIJO_REVERSION_VENTA = "Anulación de la venta ";
const PREFIJO_REVERSION_COMPRA = "Anulación de la compra ";

/**
 * ¿El detalle que escribió una persona empieza como el de una reversión por anulación? Como la reversión se reconoce SOLO por ese comienzo, un ajuste manual con un detalle así se haría pasar
 * por una (M-1 de la auditoría intermedia: no contaría como «posterior» a una venta, y la venta se podría anular a ciegas). Los comandos que reciben un detalle del cliente lo rechazan:
 * el prefijo está reservado para las anulaciones. Compara sin mayúsculas y sin espacios al comienzo, porque el filtro de las consultas es un `startsWith` y no hay que dejar una variante.
 */
export function esDetalleReservadoParaReversiones(detalle: string): boolean {
  const d = detalle.trimStart().toLocaleLowerCase("es");
  return d.startsWith(PREFIJO_REVERSION_VENTA.toLocaleLowerCase("es")) || d.startsWith(PREFIJO_REVERSION_COMPRA.toLocaleLowerCase("es"));
}

/** `detalleLibre` de la Operación AJUSTE que revierte una venta. */
export function detalleReversionDeVenta(idVenta: string, fechaVenta: Date): string {
  return `${PREFIJO_REVERSION_VENTA}${idVenta} (${fechaVenta.toISOString().slice(0, 10)}).`;
}

/** `detalleLibre` de la Operación AJUSTE que revierte una compra; con el N.º de factura, si lo tiene. */
export function detalleReversionDeCompra(idCompra: string, fechaCompra: Date, nroFactura: string | null): string {
  return `${PREFIJO_REVERSION_COMPRA}${idCompra} (${fechaCompra.toISOString().slice(0, 10)}${nroFactura ? `, factura ${nroFactura}` : ""}).`;
}

/**
 * Filtro de `Operacion` que deja afuera las reversiones por anulación y conserva todo lo demás. Incluye `detalleLibre: null` a propósito: en SQL,
 * `NOT (detalleLibre LIKE ...)` es NULL cuando `detalleLibre` es NULL, y esas operaciones (la enorme mayoría) se perderían.
 */
export const OPERACION_QUE_NO_ES_REVERSION_POR_ANULACION: Prisma.OperacionWhereInput = {
  OR: [
    { detalleLibre: null },
    { AND: [{ NOT: { detalleLibre: { startsWith: PREFIJO_REVERSION_VENTA } } }, { NOT: { detalleLibre: { startsWith: PREFIJO_REVERSION_COMPRA } } }] },
  ],
};

/**
 * Reglas de la ANULACIÓN de una venta (Task #41, Fase M — docs/arquitectura-casos-de-uso-2026-09-27.md). Puras: son las guardas, el
 * contra-asiento y los textos que antes vivían en línea en la Server Action `anularVenta` (src/server/actions/movimientos/venta.ts),
 * con los MISMOS textos; la orquestación está en `casos-de-uso/anular-venta.ts`.
 */
export interface VentaAAnular {
  proceso: string;
  anuladaEn: Date | null;
}

export type ResultadoAnulacionDeVenta = { ok: true } | { ok: false; motivo: "NO_ES_VENTA" | "YA_ANULADA" | "CONTEO_POSTERIOR" | "PAGO_CONSIGNANTE_POSTERIOR"; mensaje: string };

/**
 * Si la operación se puede anular como venta: tiene que ser una VENTA y no estar anulada (en ese orden). `operacionId` es el que se
 * pidió anular: el mensaje de «no es una Venta» lo nombra, como antes.
 */
export function evaluarAnulacionDeVenta(operacionId: string, venta: VentaAAnular): ResultadoAnulacionDeVenta {
  if (venta.proceso !== "VENTA") return { ok: false, motivo: "NO_ES_VENTA", mensaje: `La operación "${operacionId}" no es una Venta — es "${venta.proceso}".` };
  if (venta.anuladaEn) return { ok: false, motivo: "YA_ANULADA", mensaje: "Esta venta ya está anulada." };
  return { ok: true };
}

/**
 * Lo que pasó DESPUÉS de una venta (o de las ventas que se anulan juntas, si es una promo) y que anularla desharía a ciegas (S-03, O.52 de
 * docs/pureza-integracion.md; D7 del plan de endurecimiento, decidida por el dueño el 2026-10-08). Lo arma `cargarPosterioresDeVentas`
 * (server/persistencia/movimientos/cargar-venta-para-anular.ts), ya sin repetidos y con los nombres para el mensaje.
 */
export interface PosterioresALaVenta {
  /** Los (producto, sección) de la venta que tuvieron un CONTROL o un AJUSTE vigente después de ella (un conteo físico aplicado, un ajuste manual). */
  controlesOAjustes: readonly { productoNombre: string; seccionNombre: string }[];
  /** Los consignantes, con mercadería consumida por la venta, a quienes se les registró un pago después de ella. */
  pagosAConsignantes: readonly string[];
}

/**
 * D7: una venta NO se anula si después hubo un conteo/ajuste del mismo producto en la misma sección (el stock ya se reconcilió con lo contado: deshacer la
 * venta suma de nuevo lo que el conteo ya absorbió, y el saldo queda mal) ni si se le pagó al consignante de una mercadería que la venta consumió (anular
 * movería la deuda que ese pago ya saldó). El historial no se reescribe: se corrige con un ajuste. Fallo cerrado, sin pedir confirmación. El conteo manda
 * sobre el pago cuando hay los dos (un solo motivo por rechazo).
 */
export function evaluarPosterioresAAnularVenta(p: PosterioresALaVenta): ResultadoAnulacionDeVenta {
  if (p.controlesOAjustes.length) {
    const donde = p.controlesOAjustes.map((c) => `${c.productoNombre} (${c.seccionNombre})`).join(", ");
    return {
      ok: false,
      motivo: "CONTEO_POSTERIOR",
      mensaje: `No se puede anular esta venta: después de hacerse hubo un conteo físico o un ajuste de stock de ${donde}, y anularla ahora desharía a ciegas un stock que ya se reconcilió. Corregí la diferencia con un ajuste de stock.`,
    };
  }
  if (p.pagosAConsignantes.length) {
    return {
      ok: false,
      motivo: "PAGO_CONSIGNANTE_POSTERIOR",
      mensaje: `No se puede anular esta venta: consumió mercadería en consignación de ${p.pagosAConsignantes.join(", ")}, a quien se le registró un pago después de la venta. Corregí la diferencia con un ajuste en lugar de anularla.`,
    };
  }
  return { ok: true };
}

/** Un (producto, sección) que se reconcilió (conteo físico o ajuste) después de la operación que se quiere deshacer. */
export interface ReconciliacionPosterior {
  productoNombre: string;
  seccionNombre: string;
}

export type ResultadoCancelacionDeConteo = { ok: true } | { ok: false; motivo: "CONTEO_POSTERIOR"; mensaje: string };

/**
 * D7 (M-2 de la auditoría final; misma regla que `evaluarPosterioresAAnularVenta`): un conteo físico NO se cancela si después hubo OTRO conteo (con o sin movimiento) o un ajuste del mismo producto
 * en la misma sección. La reversión devuelve el stock a como estaba antes del conteo, y el conteo posterior ya se contó sobre el stock que este dejó: cancelar este desharía a ciegas un stock que
 * ya se reconcilió (conteo 1 ajusta -5, conteo 2 confirma que quedan 5, se cancela el 1: el saldo vuelve a 10 contra 5 físicos). El historial no se reescribe: se corrige con un ajuste. Fallo cerrado.
 */
export function evaluarPosterioresACancelarConteo(posteriores: readonly ReconciliacionPosterior[]): ResultadoCancelacionDeConteo {
  if (!posteriores.length) return { ok: true };
  const donde = posteriores.map((c) => `${c.productoNombre} (${c.seccionNombre})`).join(", ");
  return {
    ok: false,
    motivo: "CONTEO_POSTERIOR",
    mensaje: `No se puede cancelar este conteo: después de hacerse hubo otro conteo físico o un ajuste de stock de ${donde}, y cancelarlo ahora desharía a ciegas un stock que ya se reconcilió. Corregí la diferencia con un ajuste de stock.`,
  };
}

/** Una línea de Kardex de la venta, tal como se guardó (los `Decimal` ya convertidos a `number` por la persistencia). */
export interface LineaVendida {
  productoId: string;
  seccionId: string;
  proceso: string;
  cantidad: number;
  /** Arrastre de redondeo (Task #27): `null` si la línea no lo guarda. */
  cantidadExacta: number | null;
  loteVencimiento: Date | null;
  detalle: string;
  precioTotal: number;
  precioPorUnidadStock: number;
}

export interface LineaDeReversionDeVenta {
  productoId: string;
  seccionId: string;
  proceso: "AJUSTE" | "LIQUIDACION_CONSIGNACION";
  cantidad: number;
  cantidadExacta: number | null;
  loteVencimiento: Date | null;
  detalle: string;
  precioTotal: number;
  precioPorUnidadStock: number;
}

/**
 * Una línea inversa por cada línea vendida: mismo producto, sección y lote; cantidad, `cantidadExacta` y precio total con el signo
 * invertido; el mismo precio por unidad. Todas son AJUSTE, salvo la LIQUIDACION_CONSIGNACION (si la venta consumió una MP en
 * consignación), que se revierte con su mismo Proceso —cantidad en 0 igual que la original, precio en negativo— para que el reporte de
 * Consignación (que suma esas líneas tal cual) quede neto solo.
 *
 * `cantidadExacta` (Arrastre de redondeo, Task #27, docs/plan-redondeo-consumo-fraccionado-2026-09-26.md): invertida igual que
 * `cantidad`, para que la deuda de redondeo del producto (`D = Σcantidad − ΣcantidadExacta`) vuelva EXACTAMENTE al estado que corresponde
 * a las ventas que siguen vigentes.
 */
export function construirReversionDeVenta(lineas: readonly LineaVendida[]): LineaDeReversionDeVenta[] {
  return lineas.map((l) => ({
    productoId: l.productoId,
    seccionId: l.seccionId,
    proceso: l.proceso === "LIQUIDACION_CONSIGNACION" ? "LIQUIDACION_CONSIGNACION" : "AJUSTE",
    cantidad: -l.cantidad,
    cantidadExacta: l.cantidadExacta === null ? null : -l.cantidadExacta,
    loteVencimiento: l.loteVencimiento,
    detalle: `Anulación de venta: revierte "${l.detalle}".`,
    precioTotal: -l.precioTotal,
    precioPorUnidadStock: l.precioPorUnidadStock,
  }));
}

/**
 * Mensaje de éxito de una anulación de venta, con el texto EXACTO que armaba `anularVenta`. `componentesDePromo` es la cantidad de
 * Operaciones anuladas juntas cuando la venta era parte de una promo con hermanas vigentes, `null` si fue una sola.
 */
export function mensajeVentaAnulada(movimientosRevertidos: number, huboLiquidacionConsignacion: boolean, componentesDePromo: number | null): string {
  const mensajePromo = componentesDePromo !== null ? ` Era una promo con ${componentesDePromo} componentes: se anularon todos juntos.` : "";
  return `Venta anulada. Se revirtieron ${movimientosRevertidos} movimiento(s) de stock${huboLiquidacionConsignacion ? " y la liquidación de consignación" : ""}.${mensajePromo}`;
}

/** Descripción de la fila de auditoría (campo `anuladaEn`) de CADA Operación anulada, con el texto EXACTO de antes. */
export function descripcionAuditoriaAnulacionDeVenta(fecha: Date, nroFactura: string | null, conHermanasDePromo: boolean): string {
  return `Venta del ${fecha.toISOString().slice(0, 10)}${nroFactura ? ` (factura ${nroFactura})` : ""}: anulación${conHermanasDePromo ? " (promo, junto con sus otros componentes)" : ""}`;
}
