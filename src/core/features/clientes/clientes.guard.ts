import { validarPorcentajeDescuento } from "@/core/datos/porcentaje-descuento";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { nombreDeFicha, nombreMinimoDeFicha } from "@/core/datos/nombre-de-ficha";
import type { ComandoAltaCliente, DatosActualizarCliente } from "./clientes.schema";

/**
 * Guard de la feature «clientes con % de descuento» (convención «guard por feature», 2026-09-25; Hito 4, bloque C, paso H4C-15). Formato del comando, ANTES de
 * tocar la base; lo llama la Server Action DENTRO de su `conPermisoDeEmpresa(…)`, así que el rechazo por permiso sigue llegando antes que el de formato. Puro: sin
 * Prisma ni permisos.
 *
 * El alta y la edición tienen guard. El alta lo aplica antes de cualquier lectura; la edición lo calcula en la acción pero su rechazo lo aplica el caso de uso después de leer
 * el cliente (un cliente inexistente gana sobre un dato inválido). La activación solo recibe un id y un booleano: no tiene guard (`SIN_GUARD`).
 */

const VACIO_DEL_CLIENTE = "El nombre del cliente no puede estar vacío.";

/** El nombre de un cliente EN EL ALTA: la regla de nombre o razón social de Pedernal (200, con letra), con los textos de siempre. */
function nombreDeCliente(nombre: unknown): ResultadoDato<string> {
  return nombreDeFicha(nombre, "RAZON_SOCIAL", VACIO_DEL_CLIENTE);
}

/** El nombre de un cliente EN LA EDICIÓN (el guard no conoce el guardado): recortado, no vacío y dentro del tope. La regla estricta la aplica el caso de uso SOLO si el nombre cambió. */
function nombreMinimoDeCliente(nombre: unknown): ResultadoDato<string> {
  return nombreMinimoDeFicha(nombre, "RAZON_SOCIAL", VACIO_DEL_CLIENTE);
}

/**
 * Guard del comando «alta de un cliente»: EXACTAMENTE lo que antes era lo primero de `altaCliente` (src/server/actions/clientes/cliente.ts), con los MISMOS textos
 * y en el MISMO orden: el nombre (`nombreDeCliente`) y después el % (`validarPorcentajeDescuento`: 0 ≤ % < 100, hasta 2 decimales). Que el nombre esté libre lo
 * resuelve el caso de uso.
 */
export function guardComandoAltaCliente(entrada: { nombre: unknown; descuentoPorcentaje: unknown }): ResultadoDato<ComandoAltaCliente> {
  const nombre = nombreDeCliente(entrada.nombre);
  if (!nombre.ok) return rechazar(nombre.codigo, nombre.mensaje);
  const pct = validarPorcentajeDescuento(entrada.descuentoPorcentaje);
  if (!pct.ok) return rechazar(pct.codigo, pct.mensaje);
  return aceptar({ nombre: nombre.valor, descuentoPorcentaje: pct.valor });
}

/**
 * Guard del comando «corregir nombre y % de un cliente» (GT-11, S-52 cerrado): el mismo formato que el alta —el nombre (`nombreDeCliente`) y DESPUÉS el % (`validarPorcentajeDescuento`: finito,
 * 0 ≤ % < 100, hasta 2 decimales; rechaza NaN, ±Infinity, 1e308, «1e999», un objeto, un arreglo)—, con los MISMOS textos y orden de siempre. Lo llama la Server Action, pero su rechazo NO se
 * devuelve ahí: lo aplica el caso de uso DESPUÉS de leer el cliente (un cliente inexistente gana sobre un dato inválido; no cambia ningún mensaje ni el orden observable).
 */
export function guardComandoActualizarCliente(entrada: { nombre: unknown; descuentoPorcentaje: unknown }): ResultadoDato<DatosActualizarCliente> {
  const nombre = nombreMinimoDeCliente(entrada.nombre);
  if (!nombre.ok) return rechazar(nombre.codigo, nombre.mensaje);
  const pct = validarPorcentajeDescuento(entrada.descuentoPorcentaje);
  if (!pct.ok) return rechazar(pct.codigo, pct.mensaje);
  return aceptar({ nombre: nombre.valor, descuentoPorcentaje: pct.valor });
}
