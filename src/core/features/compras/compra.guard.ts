import { validarCantidad, type UnidadDeCantidad } from "@/core/datos/cantidad";
import { validarImporte } from "@/core/datos/importe";
import { leerNumeroDeComprobanteDeCompra } from "@/core/datos/numero-comprobante";
import { validarNroFactura } from "@/core/datos/nro-factura";
import { esClaveIdempotenciaValida } from "@/core/datos/clave-idempotencia";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { CabeceraVista, ComandoAnularCompra, ComandoCorregirCompra, ComandoCorregirImportesDeCompra, CorreccionCompraInput, DatosLineaCompra, LineaCompraValidada } from "./compra.schema";

/**
 * Guard de la feature Compra/Devolución a proveedor (convención "guard por feature", 2026-09-25;
 * docs/plan-validacion-de-datos-2026-09-25.md, Paso C1). Formato + normalización de lo que se tecleó, ANTES de calcular nada — usa
 * las funciones comunes de `src/core/datos/`, no las reemplaza. Puro: sin Prisma ni permisos.
 *
 * La Server Action (`registrarMovimiento`, src/server/actions/movimientos/movimientos.ts) sigue resolviendo lo que necesita la base
 * (producto, presentación, la unidad de compra efectiva) y llama a este guard con esos datos ya resueltos; después sigue con sus
 * propias reglas de negocio (factura duplicada, stock, transacción) y la persistencia.
 *
 * Un dato inválido devuelve el mensaje del PRIMERO que falla (cantidad → precio → peso real) y no calcula nada; ninguno de los tres
 * se guarda como 0 o se saltea en silencio, a diferencia del comportamiento anterior a este plan.
 */
export function guardLineaCompra(
  productoNombre: string,
  datos: DatosLineaCompra,
  unidadDeCompra: UnidadDeCantidad,
  unidadDeStock: UnidadDeCantidad
): ResultadoDato<LineaCompraValidada> {
  const cantidad = validarCantidad(datos.cantidad, unidadDeCompra, { etiqueta: `La cantidad de "${productoNombre}"`, obligatorio: true });
  if (!cantidad.ok) return cantidad;
  const precioTotal = validarImporte(datos.precioTotal, { etiqueta: `El precio de "${productoNombre}"` });
  if (!precioTotal.ok) return precioTotal;
  const pesoReal = validarCantidad(datos.pesoReal, unidadDeStock, { etiqueta: `El peso real de "${productoNombre}"`, obligatorio: false });
  if (!pesoReal.ok) return pesoReal;
  return aceptar({ cantidad: cantidad.valor!, precioTotal: precioTotal.valor ?? 0, pesoReal: pesoReal.valor });
}

/** Las tres magnitudes de `Unidad.magnitud` (enum `MagnitudUnidad` del esquema). */
export type MagnitudDeUnidad = "PESO" | "VOLUMEN" | "CANTIDAD";

/**
 * Regla del «peso real» (Compras etapa 2a; docs/diseno-compras-factura-unica-y-rechazo-2026-11-03.md §14.2, punto 2, CONFIRMADA): la cantidad real
 * se carga SOLO cuando la conversión cruza de tipo (la magnitud de la unidad de compra es DISTINTA de la de stock: caja→kg, kg→unidades, caja→litros).
 * Con el mismo tipo (kg→g, caja→botella) la conversión es exacta y una cantidad real sería una segunda fuente de verdad: se rechaza. Sin cantidad real, no hay nada que validar.
 */
export function guardPesoRealPorMagnitud(
  productoNombre: string,
  pesoReal: number | null,
  magnitudDeCompra: MagnitudDeUnidad,
  magnitudDeStock: MagnitudDeUnidad
): ResultadoDato<null> {
  if (pesoReal === null || magnitudDeCompra !== magnitudDeStock) return aceptar(null);
  return rechazar(
    "regla",
    `La cantidad real de "${productoNombre}" no se carga: la unidad de compra y la de stock son del mismo tipo, así que la conversión es exacta. Dejá la cantidad real vacía.`
  );
}

/**
 * Guard del número de factura de una Compra/Devolución a proveedor — en la carga (`registrarMovimiento`) y en la corrección
 * (`src/core/compras/correccion.ts`), la MISMA regla en los dos lugares. Hoy es un paso directo a `validarNroFactura`; queda acá,
 * y no en cada llamador, para que una regla propia de compras (si algún día hace falta) tenga un solo lugar donde vivir.
 */
export function guardNroFacturaCompra(valor: string | null | undefined) {
  return validarNroFactura(valor);
}

/**
 * Regla del N.º de factura de una COMPRA (etapa 1 de Compras, 2026-11-03): letra + punto de venta + número, obligatorio; devuelve el texto canónico «A-00023-00237728».
 * La Devolución a proveedor sigue con `guardNroFacturaCompra` (texto libre).
 */
export function guardComprobanteDeCompra(valor: string | null | undefined) {
  return leerNumeroDeComprobanteDeCompra(valor ?? "");
}

/** Etapa 1 de Compras (CU7, I12): en la PRIMERA compra de un producto a un proveedor hay que escribir cómo lo llama el proveedor. */
export function mensajeReferenciaProveedorObligatoria(nombreDelProducto: string): string {
  return `Escribí cómo lo llama el proveedor a "${nombreDelProducto}" (código y descripción, como dice la factura): es la primera compra de ese producto a este proveedor.`;
}

/** Mismo texto que usaba la Server Action cuando la operación no existe en esta sucursal (anular y corregir). */
export const MENSAJE_OPERACION_NO_ENCONTRADA = "No se encontró esa operación en esta sucursal.";

/** Mismo texto que usaba `anularCompra` para una clave I3 que no es un UUID. */
const MENSAJE_CLAVE_REINTENTO_INVALIDA = "Clave de reintento inválida.";

/** Anular una compra exige la clave de reintento (I3): sin ella un doble toque podría anular dos veces. */
const MENSAJE_CLAVE_REINTENTO_FALTANTE = "Falta la clave de reintento: recargá la pantalla.";

/**
 * Guard del comando «anular una compra» (Task #41, Fase M). Formato, ANTES de abrir la transacción, en el mismo orden que la Server
 * Action anterior:
 *  1. `claveIdempotencia` OBLIGATORIA (etapa 1 de Compras): ausente (`undefined`), `null` o `""` → «Falta la clave de reintento: recargá la
 *     pantalla.»; cualquier otra cosa que no sea un UUID → «Clave de reintento inválida.».
 *  2. `operacionId` que no es un string → el MISMO mensaje que «no encontrada». Antes llegaba así a `findFirst` y Prisma lo rechazaba
 *     con un error crudo de validación (un 500 para la pantalla).
 */
export function guardComandoAnularCompra(entrada: unknown): ResultadoDato<ComandoAnularCompra> {
  const { operacionId, claveIdempotencia } = (entrada ?? {}) as { operacionId?: unknown; claveIdempotencia?: unknown };
  if (claveIdempotencia === undefined || claveIdempotencia === null || claveIdempotencia === "") return rechazar("vacio", MENSAJE_CLAVE_REINTENTO_FALTANTE);
  if (!esClaveIdempotenciaValida(claveIdempotencia)) return rechazar("formato", MENSAJE_CLAVE_REINTENTO_INVALIDA);
  if (typeof operacionId !== "string") return rechazar("formato", MENSAJE_OPERACION_NO_ENCONTRADA);
  return aceptar({ operacionId, claveIdempotencia });
}

/**
 * Guard del comando «corregir la cabecera de una compra» (Task #41, Fase M). Solo el `operacionId`: si no es un string, el MISMO mensaje
 * que «no encontrada» (antes: error crudo de Prisma, o con `undefined` la primera operación de la sucursal). `nueva` y `esperado` pasan
 * tal cual: los normaliza `normalizarCorreccion` (core/compras/correccion.ts) en el caso de uso, que ya tolera `null`/`undefined` en cada
 * campo — no se llama desde acá porque correccion.ts importa este archivo (`guardNroFacturaCompra`) y se cerraría un ciclo.
 */
export function guardComandoCorregirCompra(entrada: unknown): ResultadoDato<ComandoCorregirCompra> {
  const { operacionId, nueva, esperado } = (entrada ?? {}) as { operacionId?: unknown; nueva?: CorreccionCompraInput; esperado?: CabeceraVista };
  if (typeof operacionId !== "string") return rechazar("formato", MENSAJE_OPERACION_NO_ENCONTRADA);
  return aceptar({ operacionId, nueva: nueva as CorreccionCompraInput, esperado: esperado as CabeceraVista });
}

const MAXIMO_DE_RENGLONES_A_CORREGIR = 200;
const LARGO_MAXIMO_DETALLE_DE_MOTIVO = 200;

/**
 * Guard del comando «corregir los importes de una compra» por ejemplar (etapa C0). Formato, ANTES de tocar la base: la clave de reintento (obligatoria, UUID), el `operacionId` y el `motivoId` (textos), el detalle del
 * motivo (opcional, hasta 200) y la lista de importes (de 1 a 200; cada uno con su `movimientoId` y el importe en CENTAVOS ENTEROS mayores que cero). Que el renglón sea de la compra, que haya cambios y que el motivo exista y esté activo
 * lo decide el caso de uso con la base.
 */
export function guardComandoCorregirImportesDeCompra(entrada: unknown): ResultadoDato<ComandoCorregirImportesDeCompra> {
  const { operacionId, importes, motivoId, detalleMotivo, claveIdempotencia } = (entrada ?? {}) as {
    operacionId?: unknown;
    importes?: unknown;
    motivoId?: unknown;
    detalleMotivo?: unknown;
    claveIdempotencia?: unknown;
  };
  if (claveIdempotencia === undefined || claveIdempotencia === null || claveIdempotencia === "") return rechazar("vacio", MENSAJE_CLAVE_REINTENTO_FALTANTE);
  if (!esClaveIdempotenciaValida(claveIdempotencia)) return rechazar("formato", MENSAJE_CLAVE_REINTENTO_INVALIDA);
  if (typeof operacionId !== "string") return rechazar("formato", MENSAJE_OPERACION_NO_ENCONTRADA);
  if (typeof motivoId !== "string" || motivoId.trim() === "") return rechazar("vacio", "Elegí el motivo de la corrección.");
  if (!Array.isArray(importes) || importes.length === 0) return rechazar("vacio", "Indicá el importe que querés corregir.");
  if (importes.length > MAXIMO_DE_RENGLONES_A_CORREGIR) return rechazar("largo", `No se pueden corregir más de ${MAXIMO_DE_RENGLONES_A_CORREGIR} renglones a la vez.`);
  const lista: { movimientoId: string; importeEnCentavos: number }[] = [];
  for (const i of importes) {
    const { movimientoId, importeEnCentavos } = (i ?? {}) as { movimientoId?: unknown; importeEnCentavos?: unknown };
    if (typeof movimientoId !== "string" || movimientoId === "") return rechazar("formato", "Uno de los renglones no es válido.");
    if (typeof importeEnCentavos !== "number" || !Number.isInteger(importeEnCentavos) || importeEnCentavos < 1) return rechazar("formato", "El importe tiene que ser mayor que cero.");
    lista.push({ movimientoId, importeEnCentavos });
  }
  let detalle: string | null = null;
  if (detalleMotivo !== undefined && detalleMotivo !== null && detalleMotivo !== "") {
    if (typeof detalleMotivo !== "string") return rechazar("formato", "El detalle del motivo no es válido.");
    detalle = detalleMotivo.trim() === "" ? null : detalleMotivo.trim();
    if (detalle !== null && detalle.length > LARGO_MAXIMO_DETALLE_DE_MOTIVO) return rechazar("largo", `El detalle no puede superar los ${LARGO_MAXIMO_DETALLE_DE_MOTIVO} caracteres.`);
  }
  return aceptar({ operacionId, importes: lista, motivoId: motivoId.trim(), detalleMotivo: detalle, claveIdempotencia });
}
