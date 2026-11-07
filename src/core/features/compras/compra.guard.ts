import { validarCantidad, type UnidadDeCantidad } from "@/core/datos/cantidad";
import { validarImporte } from "@/core/datos/importe";
import { leerNumeroDeComprobanteDeCompra } from "@/core/datos/numero-comprobante";
import { validarNroFactura } from "@/core/datos/nro-factura";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { DatosLineaCompra, LineaCompraValidada } from "./compra.schema";

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
