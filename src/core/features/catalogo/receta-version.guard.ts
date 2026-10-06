import type { CabeceraRecetaInput, IngredienteInput, PasoInput } from "@/core/catalogo/public";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ComandoGuardarVersionDeReceta } from "./receta-version.schema";

/** Mismo texto que usaba `guardarReceta` cuando el producto no existe. */
export const MENSAJE_PRODUCTO_NO_ENCONTRADO = "No se encontró el producto.";

/**
 * Guard del comando «guardar una versión nueva de la receta» (Task #41, P1; convención "guard por feature", 2026-09-25). Puro: sin
 * Prisma ni permisos. Solo el `productoId`: si no es un string, el MISMO mensaje que «no encontrado» (antes llegaba así a
 * `producto.findUnique` y Prisma lo rechazaba con un error crudo de validación — un 500 para la pantalla; mismo criterio que los guards
 * de compras, ventas, traspasos y cuentas).
 *
 * `items`, `pasos` y `cabecera` pasan TAL CUAL: los validan `validarIngredientes` → `validarPasos` → `validarCabecera` en el caso de
 * uso, DESPUÉS de cargar el producto y de chequear que sea elegible, en el mismo orden de siempre (validarlos acá cambiaría qué mensaje
 * sale primero cuando hay más de un dato inválido).
 */
export function guardComandoGuardarVersionDeReceta(entrada: unknown): ResultadoDato<ComandoGuardarVersionDeReceta> {
  const { productoId, items, pasos, cabecera } = (entrada ?? {}) as {
    productoId?: unknown;
    items?: IngredienteInput[];
    pasos?: PasoInput[];
    cabecera?: CabeceraRecetaInput;
  };
  if (typeof productoId !== "string") return rechazar("formato", MENSAJE_PRODUCTO_NO_ENCONTRADO);
  return aceptar({ productoId, items: items as IngredienteInput[], pasos: pasos as PasoInput[], cabecera: cabecera as CabeceraRecetaInput });
}
