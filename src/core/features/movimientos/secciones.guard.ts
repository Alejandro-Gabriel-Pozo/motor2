import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { nombreDeCatalogo } from "@/core/features/catalogo/nombre-de-catalogo";
import type { ComandoActualizarRespaldoSeccion, ComandoCrearSeccion, ComandoRenombrarSeccion } from "./secciones.schema";

/**
 * Guard de la feature «secciones de stock de una sucursal» (convención «guard por feature», 2026-09-25; Hito 4, bloque C, paso H4C-18). Formato del comando, ANTES
 * de tocar la base; lo llama la Server Action DENTRO de su `conPermiso("secciones", …)`, así que el rechazo por permiso sigue llegando antes que el de formato.
 * Puro: sin Prisma ni permisos.
 *
 * Tienen guard el alta, el renombre y el respaldo: sus validaciones iban TODAS antes de la primera lectura. La activación solo recibe un id y un booleano, que
 * nunca se validaron: sin guard (`SIN_GUARD`).
 */

/** El nombre de una sección: recortado, no vacío (con el texto de cada acción), charset y largo de catálogo con la etiqueta «El nombre de la sección». */
const nombreDeSeccion = (nombre: unknown, mensajeVacio: string): ResultadoDato<string> => nombreDeCatalogo(nombre, mensajeVacio, "El nombre de la sección");

/** Guard del alta de una sección: EXACTAMENTE lo que antes era lo primero de `crearSeccion`, con los MISMOS textos. Que el nombre esté libre lo resuelve el caso de uso. */
export function guardComandoCrearSeccion(entrada: { nombre: unknown }): ResultadoDato<ComandoCrearSeccion> {
  const nombre = nombreDeSeccion(entrada.nombre, "El nombre del depósito no puede estar vacío.");
  if (!nombre.ok) return rechazar(nombre.codigo, nombre.mensaje);
  return aceptar({ nombre: nombre.valor });
}

/**
 * Guard del renombre de una sección: EXACTAMENTE lo que antes era lo primero de `renombrarSeccion` (el nombre nuevo, con su texto «El nombre no puede estar
 * vacío.»), ANTES de leer la sección. El id no se valida (nunca se validó: lo resuelve la base).
 */
export function guardComandoRenombrarSeccion(entrada: { seccionId: string; nombreNuevo: unknown }): ResultadoDato<ComandoRenombrarSeccion> {
  const nombre = nombreDeSeccion(entrada.nombreNuevo, "El nombre no puede estar vacío.");
  if (!nombre.ok) return rechazar(nombre.codigo, nombre.mensaje);
  return aceptar({ seccionId: entrada.seccionId, nombre: nombre.valor });
}

/**
 * Guard del respaldo automático en ventas: EXACTAMENTE lo que antes era lo primero de `actualizarRespaldoSeccion`, en el MISMO orden: un valor que no es booleano →
 * «Valor inválido.», y después un id que no es texto → «No se encontró el depósito.» (la acción no leía nada con un id así: devolvía el mismo «no encontrada»).
 */
export function guardComandoActualizarRespaldoSeccion(entrada: { seccionId: unknown; sirveDeRespaldoEnVentas: unknown }): ResultadoDato<ComandoActualizarRespaldoSeccion> {
  const { seccionId, sirveDeRespaldoEnVentas } = entrada;
  if (typeof sirveDeRespaldoEnVentas !== "boolean") return rechazar("formato", "Valor inválido.");
  if (typeof seccionId !== "string") return rechazar("formato", "No se encontró el depósito.");
  return aceptar({ seccionId, sirveDeRespaldoEnVentas });
}

/**
 * P17 (decisión del dueño, 2026-10-11): una sección de stock dada de baja SOLO admite sacar mercadería (transferir, mermar o consumir) hasta vaciarla; no recibe mercadería
 * nueva ni se vende desde ella. Es el texto ÚNICO con el que todos los casos de uso rechazan una sección dada de baja (código `SECCION_INACTIVA`); cada caso decide solo SI rechaza.
 */
export function mensajeSeccionDesactivada(nombre: string): string {
  return `La sección «${nombre}» está desactivada: solo se puede sacar mercadería de ella (transferir, mermar o consumir) hasta vaciarla. Elegí otra sección o activala.`;
}
