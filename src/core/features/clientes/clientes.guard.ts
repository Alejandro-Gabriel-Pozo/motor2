import { validarPorcentajeDescuento } from "@/core/datos/porcentaje-descuento";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { nombreDeCatalogo } from "@/core/features/catalogo/nombre-de-catalogo";
import type { ComandoAltaCliente } from "./clientes.schema";

/**
 * Guard de la feature «clientes con % de descuento» (convención «guard por feature», 2026-09-25; Hito 4, bloque C, paso H4C-15). Formato del comando, ANTES de
 * tocar la base; lo llama la Server Action DENTRO de su `conPermisoDeEmpresa(…)`, así que el rechazo por permiso sigue llegando antes que el de formato. Puro: sin
 * Prisma ni permisos.
 *
 * Solo el alta tiene guard: sus validaciones iban TODAS antes de la primera lectura. La edición y la activación leían el cliente ANTES (un cliente inexistente gana
 * sobre un dato inválido): no tienen guard (`SIN_GUARD`).
 */

/** El nombre de un cliente: recortado, no vacío, charset y largo de catálogo, con los textos de siempre. Lo comparten este guard y el caso de uso de la edición. */
export function nombreDeCliente(nombre: unknown): ResultadoDato<string> {
  return nombreDeCatalogo(nombre, "El nombre del cliente no puede estar vacío.", "El nombre del cliente");
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
