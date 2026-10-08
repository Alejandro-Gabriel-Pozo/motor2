import { validarImporte } from "@/core/datos/importe";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ComandoSetPrecioLocalProducto, ComandoSincronizarPrecioLocalGrupoCarta } from "./precio-local.schema";

/**
 * Guard de la feature «precio local de un producto en la sucursal» (convención «guard por feature», 2026-09-25; Hito 4, bloque 4.2, paso H4C-4). Formato de los
 * comandos, ANTES de tocar la base; lo llama la Server Action DENTRO de su `conPermiso(…)`, así que el rechazo por permiso sigue llegando antes que el de
 * formato. Puro: sin Prisma ni permisos. Es EXACTAMENTE la validación que antes iba al principio de cada acción, con los MISMOS textos y en el MISMO orden.
 */

/** El precio de un precio local: el mismo validador que el formulario (`CampoNumero tipo="importe"`): número, no negativo, a lo sumo 2 decimales, dentro del tope. */
function validarPrecio(precio: unknown): ResultadoDato<number> {
  const validado = validarImporte(precio, { etiqueta: "El precio", obligatorio: true });
  if (!validado.ok) return rechazar(validado.codigo, validado.mensaje);
  return aceptar(validado.valor!); // obligatorio: nunca null
}

/** Guard de `setPrecioLocalProducto`: solo el precio (el producto lo resuelve el caso de uso, «No se encontró el producto.»). */
export function guardComandoSetPrecioLocalProducto(entrada: { productoId: string; precio: unknown; habilitado: boolean }): ResultadoDato<ComandoSetPrecioLocalProducto> {
  const precio = validarPrecio(entrada.precio);
  if (!precio.ok) return rechazar(precio.codigo, precio.mensaje);
  return aceptar({ productoId: entrada.productoId, precio: precio.valor, habilitado: entrada.habilitado });
}

/**
 * Guard de `sincronizarPrecioLocalGrupoCarta`, en el orden de siempre: 1. la sucursal que vio la pantalla tiene que ser la activa (si cambió en el medio, no se
 * escribe nada); 2. el precio; 3. los ids sin repetidos, al menos uno. Que sean del mismo ítem agrupado lo resuelve el caso de uso (lee la carta).
 */
export function guardComandoSincronizarPrecioLocalGrupoCarta(entrada: {
  sucursalId: string;
  sucursalActivaId: string;
  productoIds: string[];
  precio: unknown;
  habilitado: boolean;
}): ResultadoDato<ComandoSincronizarPrecioLocalGrupoCarta> {
  if (entrada.sucursalId !== entrada.sucursalActivaId) return rechazar("formato", "La sucursal activa cambió desde que se cargó la pantalla: recargala y volvé a intentar.");
  const precio = validarPrecio(entrada.precio);
  if (!precio.ok) return rechazar(precio.codigo, precio.mensaje);
  const productoIds = [...new Set(entrada.productoIds)];
  if (!productoIds.length) return rechazar("vacio", "No hay productos para actualizar.");
  return aceptar({ productoIds, precio: precio.valor, habilitado: entrada.habilitado });
}
