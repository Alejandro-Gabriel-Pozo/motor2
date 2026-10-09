import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { validarContactoDeProveedor } from "./contacto-de-proveedor";
import { nombreDeCatalogo } from "./nombre-de-catalogo";
import type { ComandoAltaProveedor, EntradaContactoDeProveedor } from "./proveedores.schema";

/**
 * Guard de la feature «proveedores» (convención «guard por feature», 2026-09-25; Hito 4, bloque C, paso H4C-14). Formato del comando, ANTES de tocar la base; lo
 * llama la Server Action DENTRO de su `conPermisoDeEmpresa(…)`, así que el rechazo por permiso sigue llegando antes que el de formato. Puro: sin Prisma ni permisos.
 *
 * Solo el alta tiene guard: sus validaciones iban TODAS antes de la primera lectura. La edición leía el proveedor ANTES de validar (un proveedor inexistente gana
 * sobre un dato inválido) y la activación solo recibe un id y un booleano: esas no tienen guard (`SIN_GUARD`).
 */

/** O.44: el «no encontrado» de activar o desactivar un proveedor con un id que no existe (o de otra empresa). Mismo texto que el de la edición. */
export const MENSAJE_PROVEEDOR_NO_ENCONTRADO = "No se encontró ese proveedor.";

/**
 * Guard del comando «alta de un proveedor»: EXACTAMENTE lo que antes era lo primero de `altaProveedor` (src/server/actions/catalogo/proveedores.ts), con los MISMOS
 * textos y en el MISMO orden: el nombre (recortado, no vacío, charset y largo de catálogo) y después los datos de contacto (`validarContactoDeProveedor`). Que el
 * nombre y el CUIT estén libres lo resuelve el caso de uso.
 */
export function guardComandoAltaProveedor(entrada: { nombre: unknown } & EntradaContactoDeProveedor): ResultadoDato<ComandoAltaProveedor> {
  const nombre = nombreDeCatalogo(entrada.nombre, "El nombre no puede estar vacío.", "El nombre");
  if (!nombre.ok) return rechazar(nombre.codigo, nombre.mensaje);
  const valores = validarContactoDeProveedor(entrada);
  if (!valores.ok) return rechazar(valores.codigo, valores.mensaje);
  return aceptar({ nombre: nombre.valor, valores: valores.valor });
}
