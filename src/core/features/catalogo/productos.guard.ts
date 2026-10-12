import { validarPasoVenta } from "@/core/catalogo/public";
import { validarCantidad } from "@/core/datos/cantidad";
import { validarImporte } from "@/core/datos/importe";
import { LARGO_MAXIMO_NOTAS, validarTextoLibre } from "@/core/datos/limites";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { esNumeroEstricto } from "@/core/numero";
import { texto, validarTextoCatalogo } from "@/core/texto";
import { nombreDeCatalogo } from "./nombre-de-catalogo";
import type { ComandoDarDeAltaProductoRapido, ComandoSincronizarPrecioGrupoCarta, PuertaDeDatosDeProducto } from "./productos.schema";

/**
 * Guard de la feature «productos del catálogo» (convención «guard por feature», 2026-09-25; Hito 4, bloque 4.3, paso H4C-12). Formato del comando, ANTES de tocar
 * la base; lo llama la Server Action DENTRO de su `conPermisoDeEmpresa(…)`, así que el rechazo por permiso sigue llegando antes que el de formato. Puro: sin
 * Prisma ni permisos.
 *
 * Tienen guard el alta rápida y la sincronización del precio de un ítem agrupado (H4C-13): sus validaciones iban TODAS antes de la primera lectura. El alta
 * completa y la edición (S-52, `guardComandoDatosDeProducto`) validan con `validarDatosDeProducto`, que lee la unidad de stock a mitad de camino (sus decimales validan el factor
 * y el paso de venta): su guard decide TODO lo que no depende de la base, la acción lo calcula con lo que mandó el cliente y `validarDatosDeProducto` aplica cada rechazo en el
 * lugar de siempre, así no cambia ningún mensaje ni el orden.
 */

/**
 * M.2: el rechazo de quien cambia el precio de venta, el factor de conversión o una unidad de un producto sin tener `producto_campos_sensibles`. Un solo texto para la edición, las presentaciones y el
 * alta (el que lo lee no tiene por qué saber cuál de los campos fue). La segunda frase cubre al que NO tocó nada de eso y recibe el rechazo porque otra persona cambió el valor mientras él editaba.
 */
export const MENSAJE_SIN_PERMISO_CAMPOS_SENSIBLES =
  "No tenés permiso para cambiar el precio de venta, el factor de conversión ni las unidades del producto. Si no los tocaste, puede que otra persona los haya cambiado mientras editabas: recargá la página.";

/** O.44: el «no encontrado» de activar o desactivar una presentación de compra con un id que no existe (o de otra empresa). */
export const MENSAJE_PRESENTACION_NO_ENCONTRADA = "No se encontró la presentación.";

/**
 * Guard del comando «alta rápida de una MP» (el wizard de compra): EXACTAMENTE lo que antes era lo primero de `darDeAltaProductoRapido`
 * (src/server/actions/catalogo/productos.ts), con los MISMOS textos y en el MISMO orden: el nombre (recortado, no vacío, charset y largo de catálogo) y que venga
 * la unidad de stock. Que el nombre esté libre lo resuelve el caso de uso.
 */
export function guardComandoDarDeAltaProductoRapido(entrada: { nombre: unknown; unidadStockId: string }): ResultadoDato<ComandoDarDeAltaProductoRapido> {
  const nombre = nombreDeCatalogo(entrada.nombre, "El nombre no puede estar vacío.", "El nombre");
  if (!nombre.ok) return rechazar(nombre.codigo, nombre.mensaje);
  if (!entrada.unidadStockId) return rechazar("vacio", "La unidad de stock es obligatoria.");
  return aceptar({ nombre: nombre.valor, unidadStockId: entrada.unidadStockId });
}

/**
 * Guard del comando «aplicar el mismo precio de venta global a los productos de un ítem agrupado» (H4C-13): EXACTAMENTE lo que antes era lo primero de
 * `sincronizarPrecioGrupoCarta`, antes de leer el ítem agrupado, con los MISMOS textos y en el MISMO orden: el precio (un número estricto, no negativo) y la lista
 * sin repetidos y no vacía. Que sean todos del mismo ítem agrupado lo resuelve el caso de uso.
 */
export function guardComandoSincronizarPrecioGrupoCarta(entrada: { productoIds: string[]; precio: number }): ResultadoDato<ComandoSincronizarPrecioGrupoCarta> {
  const { precio } = entrada;
  if (!esNumeroEstricto(precio)) return rechazar("formato", "El precio de venta no es un número válido.");
  if (!(precio >= 0)) return rechazar("negativo", "El precio de venta no puede ser negativo.");
  const ids = [...new Set(entrada.productoIds)];
  if (!ids.length) return rechazar("vacio", "No hay productos para actualizar.");
  return aceptar({ productoIds: ids, precio });
}

/** Los decimales máximos de una unidad (`Unidad.decimales`, 0 a 6): el guard no conoce la unidad del producto, así que mide el factor y el paso con el máximo y deja los decimales reales al paso que la lee. */
const DECIMALES_MAXIMOS_DE_UNIDAD = 6;

/**
 * Guard del comando «alta completa / edición de un producto» (S-52): el formato y el rango de TODO lo que no depende de la base, con los MISMOS textos y el MISMO orden que tenía
 * `validarDatosDeProducto` (server/lecturas/catalogo/datos-de-producto.ts). ANTES de leer la unidad: el nombre (recortado, no vacío, charset y largo de catálogo), las observaciones y la unidad de
 * stock presente (y como texto). DESPUÉS de leerla: el factor de conversión (un número, mayor que cero y menor que el tope: rechaza NaN, ±Infinity, 1e308, vacío, un objeto), el precio de venta
 * (finito, ≥ 0, 2 decimales, bajo el tope), si es consignación el proveedor y su precio (> 0), y el paso de venta (solo un PV; 0 < paso ≤ 1, hasta 4 decimales, 1/paso entero).
 *
 * Lo que SÍ depende de la base queda en `validarDatosDeProducto`, que lee la unidad de stock a mitad de camino: que la unidad exista, los DECIMALES del factor y del paso (son los de ESA
 * unidad), la regla R3 del paso de un producto que se produce, el nombre libre y la unidad del insumo. Por eso el guard devuelve el resultado de cada etapa por separado
 * (`PuertaDeDatosDeProducto`): la acción lo CALCULA con lo que mandó el cliente y `validarDatosDeProducto` aplica cada rechazo en el LUGAR de siempre (antes de leer la unidad, o después
 * de leerla), así que un dato inválido nunca gana sobre una unidad inexistente, ni cambia qué mensaje sale primero. Un cuerpo que no es un objeto se rechaza en la primera etapa.
 */
export function guardComandoDatosDeProducto(entrada: { datos: unknown }): PuertaDeDatosDeProducto {
  const d = (typeof entrada.datos === "object" && entrada.datos !== null && !Array.isArray(entrada.datos) ? entrada.datos : null) as {
    nombre?: unknown;
    tipo?: unknown;
    observaciones?: unknown;
    unidadStockId?: unknown;
    factorConversion?: unknown;
    precioVenta?: unknown;
    pasoVenta?: unknown;
    esConsignacion?: unknown;
    proveedorConsignacionId?: unknown;
    precioConsignacion?: unknown;
  } | null;

  const antesDeLaUnidad = ((): ResultadoDato<null> => {
    if (d === null) return rechazar("formato", "Los datos del producto no son válidos.");
    const nombre = texto(d.nombre);
    if (!nombre) return rechazar("vacio", "El nombre no puede estar vacío.");
    const invalido = validarTextoCatalogo(nombre, "El nombre");
    if (invalido) return rechazar("formato", invalido);
    const observaciones = validarTextoLibre(d.observaciones, "Las observaciones", LARGO_MAXIMO_NOTAS);
    if (!observaciones.ok) return rechazar("largo", observaciones.mensaje);
    if (typeof d.unidadStockId !== "string" || !d.unidadStockId) return rechazar("vacio", "La unidad de stock es obligatoria.");
    return aceptar(null);
  })();
  // Rechazada la primera etapa, las demás no se miran (el que aplica la puerta corta ahí: nunca llega a leerlas). `d === null` ya rechazó arriba; se repite para el tipo.
  if (!antesDeLaUnidad.ok || d === null) {
    return { antesDeLaUnidad, factor: aceptar(null), precioVenta: aceptar(null), precioConsignacion: aceptar(null), pasoVenta: aceptar(null) };
  }

  const factorGenerico = validarCantidad(d.factorConversion, { nombre: "", decimales: DECIMALES_MAXIMOS_DE_UNIDAD }, { etiqueta: "El factor de conversión", obligatorio: true });
  const factor: ResultadoDato<null> = factorGenerico.ok ? aceptar(null) : rechazar(factorGenerico.codigo, factorGenerico.mensaje);

  const precioVenta = validarImporte(d.precioVenta, { etiqueta: "El precio de venta" });

  const precioConsignacion = ((): ResultadoDato<number | null> => {
    if (d.esConsignacion) {
      if (!d.proveedorConsignacionId) return rechazar("vacio", "Falta el proveedor de consignación.");
      return validarImporte(d.precioConsignacion, { etiqueta: "El precio de consignación", obligatorio: true, permitirCero: false });
    }
    // Sin consignación el precio no se usa, pero igual se guarda: tiene que ser un importe válido (antes pasaba crudo, hasta un negativo).
    return validarImporte(d.precioConsignacion, { etiqueta: "El precio de consignación" });
  })();

  const pasoVenta = ((): ResultadoDato<null> => {
    if (d.pasoVenta === undefined || d.pasoVenta === null) return aceptar(null);
    if (d.tipo !== "PV") return rechazar("formato", "El paso de venta solo aplica a productos de venta (PV).");
    const r = validarPasoVenta(d.pasoVenta, { decimalesUnidad: DECIMALES_MAXIMOS_DE_UNIDAD, tieneStockReal: false });
    return r.ok ? aceptar(null) : rechazar("rango", r.mensaje);
  })();

  return { antesDeLaUnidad, factor, precioVenta, precioConsignacion, pasoVenta };
}

/**
 * Guard del comando «agregar (o reactivar con otro factor) una presentación de compra» (S-52). Dos resultados, porque se aplican en lugares distintos:
 *  - `ids`: el producto y la unidad de compra tienen que ser texto (antes, uno que no lo era llegaba a Prisma y daba un error crudo): lo devuelve la acción apenas lo calcula, como cualquier
 *    id roto («No se encontró el producto.»);
 *  - `factor`: el rango del factor de conversión con los MISMOS textos de `validarCantidad` (un número, mayor que cero y menor que el tope: rechaza NaN, ±Infinity, 1e308, vacío, un objeto),
 *    medido con los decimales máximos de una unidad. Sus decimales reales son los de la unidad de STOCK del producto y los decide el caso de uso; el rechazo del `factor` lo aplica
 *    el caso de uso DESPUÉS de leer el producto y de ver que la unidad no es la de compra por defecto (un producto inexistente gana sobre un factor inválido).
 */
export function guardComandoAgregarPresentacionAlternativa(entrada: { productoId: unknown; unidadCompraId: unknown; factorConversion: unknown }): {
  ids: ResultadoDato<null>;
  factor: ResultadoDato<null>;
} {
  const ids: ResultadoDato<null> =
    typeof entrada.productoId !== "string" || !entrada.productoId
      ? rechazar("formato", "No se encontró el producto.")
      : typeof entrada.unidadCompraId !== "string" || !entrada.unidadCompraId
        ? rechazar("formato", "La unidad de compra no es válida.")
        : aceptar(null);
  const f = validarCantidad(entrada.factorConversion, { nombre: "", decimales: DECIMALES_MAXIMOS_DE_UNIDAD }, { etiqueta: "El factor de conversión", obligatorio: true });
  return { ids, factor: f.ok ? aceptar(null) : rechazar(f.codigo, f.mensaje) };
}
