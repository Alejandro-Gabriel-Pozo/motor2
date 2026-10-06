import { MENSAJE_OPERACION_NO_ENCONTRADA } from "@/core/features/compras/compra.guard";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { CANTIDAD_MAXIMA } from "@/core/datos/cantidad";
import { esClaveIdempotenciaValida } from "@/core/datos/clave-idempotencia";
import { validarFechaOperacion } from "@/core/datos/fecha-operacion";
import { esIdentificador } from "@/core/datos/identificador";
import { tieneALoSumoDecimales } from "@/core/datos/numero-tecleado";
import { LARGO_MAXIMO_NRO_FACTURA, texto, validarLargoTexto } from "@/core/texto";
import type { ComandoAnularVenta, DatosVentaInput } from "./venta.schema";

/**
 * Guard de la feature Venta de mostrador (convención "guard por feature", 2026-09-25; Task #41, Fase M). Formato del comando, ANTES de
 * abrir la transacción. Puro: sin Prisma ni permisos.
 */

/**
 * Guard del comando «anular una venta». Solo el `operacionId`: si no es un string, el MISMO mensaje que «no encontrada»
 * («No se encontró esa operación en esta sucursal.», el texto que ya usaba `anularVenta`). Antes llegaba así al `findFirst`: con
 * `undefined` Prisma ignora el filtro por id y cargaba la PRIMERA operación de la sucursal; con otro tipo, un error crudo de validación
 * (un 500 para la pantalla). Un string —exista o no— pasa tal cual, y el caso de uso sigue respondiendo como siempre.
 */
export function guardComandoAnularVenta(entrada: unknown): ResultadoDato<ComandoAnularVenta> {
  const { operacionId } = (entrada ?? {}) as { operacionId?: unknown };
  if (typeof operacionId !== "string") return rechazar("formato", MENSAJE_OPERACION_NO_ENCONTRADA);
  return aceptar({ operacionId });
}

/** Decimales de las columnas `Decimal(14,4)` de cantidades: lo que tenga más se redondea en silencio al guardar, así que se rechaza antes. */
const DECIMALES_DE_CANTIDAD_GUARDADOS = 4;

/**
 * Guard del comando «registrar una venta de mostrador» (formato, ANTES de abrir la transacción; antes corría en línea en `venta.ts`).
 * Además de la sección, la fecha, la clave I3 y el largo del N.º de factura, exige que `ventas` sea una lista y que cada línea tenga un
 * `productoId` y una cantidad que sea un número finito, no negativo, menor que el tope de la columna y con a lo sumo 4 decimales. Una
 * cantidad en 0 sigue siendo «sin cantidad» (el núcleo la saltea); una cantidad inválida (NaN, negativa, texto) ahora RECHAZA el lote
 * entero: antes se descartaba en silencio y el resto del lote se registraba igual. Devuelve `aceptar(entrada)` SIN transformar nada.
 */
export function guardComandoRegistrarVenta(entrada: unknown): ResultadoDato<DatosVentaInput> {
  const datos = (entrada ?? {}) as Partial<Record<keyof DatosVentaInput, unknown>>;
  if (!Array.isArray(datos.ventas) || datos.ventas.length === 0) return rechazar("vacio", "Cargá al menos un producto con cantidad.");
  if (!texto(datos.seccionId)) return rechazar("vacio", "Elegí una sección.");
  const fecha = validarFechaOperacion(datos.fecha);
  if (!fecha.ok) return rechazar(fecha.codigo, fecha.mensaje);
  if (datos.claveIdempotencia !== undefined && !esClaveIdempotenciaValida(datos.claveIdempotencia)) {
    return rechazar("formato", "Clave de reintento inválida.");
  }
  const errorLargoFactura = validarLargoTexto(datos.nroFactura, "El número de factura", LARGO_MAXIMO_NRO_FACTURA);
  if (errorLargoFactura) return rechazar("largo", errorLargoFactura);
  for (const linea of datos.ventas as unknown[]) {
    const { productoId, cantidadVendida } = (linea ?? {}) as { productoId?: unknown; cantidadVendida?: unknown };
    if (!esIdentificador(productoId)) return rechazar("formato", "Hay una línea sin producto.");
    const n = cantidadVendida;
    if (typeof n !== "number" || !Number.isFinite(n)) return rechazar("formato", "La cantidad vendida no es un número válido.");
    if (n < 0) return rechazar("negativo", "La cantidad vendida no puede ser negativa.");
    if (n >= CANTIDAD_MAXIMA) return rechazar("rango", "La cantidad vendida es demasiado grande.");
    if (!tieneALoSumoDecimales(n, DECIMALES_DE_CANTIDAD_GUARDADOS)) {
      return rechazar("decimales", `La cantidad vendida admite como máximo ${DECIMALES_DE_CANTIDAD_GUARDADOS} decimales.`);
    }
  }
  return aceptar(entrada as DatosVentaInput);
}
