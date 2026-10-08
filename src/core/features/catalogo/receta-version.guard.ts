import type { CabeceraRecetaInput, IngredienteInput, PasoInput } from "@/core/catalogo/public";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ComandoGuardarVersionDeReceta } from "./receta-version.schema";

/** Mismo texto que usaba `guardarReceta` cuando el producto no existe. */
export const MENSAJE_PRODUCTO_NO_ENCONTRADO = "No se encontró el producto.";

/** La versión esperada que llega no es un entero ≥ 0. */
const MENSAJE_VERSION_ESPERADA_INVALIDA = "La versión de la receta que se esperaba no es válida.";

/**
 * Guard del comando «guardar una versión nueva de la receta» (Task #41, P1; convención "guard por feature", 2026-09-25). Puro: sin
 * Prisma ni permisos. Solo el `productoId`: si no es un string, el MISMO mensaje que «no encontrado» (antes llegaba así a
 * `producto.findUnique` y Prisma lo rechazaba con un error crudo de validación — un 500 para la pantalla; mismo criterio que los guards
 * de compras, ventas, traspasos y cuentas).
 *
 * `items`, `pasos` y `cabecera` pasan TAL CUAL: los validan `validarIngredientes` → `validarPasos` → `validarCabecera` en el caso de
 * uso, DESPUÉS de cargar el producto y de chequear que sea elegible, en el mismo orden de siempre (validarlos acá cambiaría qué mensaje
 * sale primero cuando hay más de un dato inválido).
 *
 * `exigirVersion` (O.1, Hito 4, paso H4C-23): la acción PÚBLICA `guardarReceta` lo pide — una versión esperada ausente (`undefined` o `null`) se rechaza con el MISMO
 * texto que una inválida, así el modo «a ciegas» no es alcanzable desde la red. Sin la opción (la receta propia de una sucursal, y `guardarRecetaACiegas` de
 * `server/actions/catalogo/receta-a-ciegas.ts`, solo para seeds, scripts y tests) la ausencia sigue siendo «a ciegas».
 */
export function guardComandoGuardarVersionDeReceta(entrada: unknown, opciones: { exigirVersion?: boolean } = {}): ResultadoDato<ComandoGuardarVersionDeReceta> {
  const { productoId, items, pasos, cabecera, versionEsperada } = (entrada ?? {}) as {
    productoId?: unknown;
    items?: IngredienteInput[];
    pasos?: PasoInput[];
    cabecera?: CabeceraRecetaInput;
    versionEsperada?: unknown;
  };
  if (typeof productoId !== "string") return rechazar("formato", MENSAJE_PRODUCTO_NO_ENCONTRADO);
  if (opciones.exigirVersion && (versionEsperada === undefined || versionEsperada === null)) return rechazar("formato", MENSAJE_VERSION_ESPERADA_INVALIDA);
  // `undefined` = reemplazo completo a ciegas (sin lectura previa); un valor presente tiene que ser una versión posible (0 = «todavía no hay receta»).
  if (versionEsperada !== undefined && versionEsperada !== null && !(typeof versionEsperada === "number" && Number.isInteger(versionEsperada) && versionEsperada >= 0)) {
    return rechazar("formato", MENSAJE_VERSION_ESPERADA_INVALIDA);
  }
  return aceptar({ productoId, items: items as IngredienteInput[], pasos: pasos as PasoInput[], cabecera: cabecera as CabeceraRecetaInput, versionEsperada: (versionEsperada as number | undefined) ?? null });
}
