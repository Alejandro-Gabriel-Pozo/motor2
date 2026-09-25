import { validarCantidad, type UnidadDeCantidad } from "@/core/datos/cantidad";
import { validarImporte } from "@/core/datos/importe";
import { validarNroFactura } from "@/core/datos/nro-factura";
import { aceptar, type ResultadoDato } from "@/core/datos/resultado";
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

/**
 * Guard del número de factura de una Compra/Devolución a proveedor — en la carga (`registrarMovimiento`) y en la corrección
 * (`src/core/compras/correccion.ts`), la MISMA regla en los dos lugares. Hoy es un paso directo a `validarNroFactura`; queda acá,
 * y no en cada llamador, para que una regla propia de compras (si algún día hace falta) tenga un solo lugar donde vivir.
 */
export function guardNroFacturaCompra(valor: string | null | undefined) {
  return validarNroFactura(valor);
}
