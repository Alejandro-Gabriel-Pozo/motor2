import { validarCantidad, type UnidadDeCantidad } from "@/core/datos/cantidad";
import { validarImporte } from "@/core/datos/importe";
import { leerNumeroDeComprobanteDeCompra } from "@/core/datos/numero-comprobante";
import { validarNroFactura } from "@/core/datos/nro-factura";
import { esClaveIdempotenciaValida } from "@/core/datos/clave-idempotencia";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { CabeceraVista, ComandoAnularCompra, ComandoCorregirCompra, CorreccionCompraInput, DatosLineaCompra, LineaCompraValidada } from "./compra.schema";

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
