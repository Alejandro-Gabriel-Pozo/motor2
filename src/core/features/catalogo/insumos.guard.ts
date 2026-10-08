import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ComandoCrearInsumo, ComandoCrearOActualizarGrupo, ComandoRenombrarOFusionarInsumo } from "./insumos.schema";
import { nombreDeCatalogo } from "./nombre-de-catalogo";

/**
 * Guard de la feature «insumos y grupos» (convención «guard por feature», 2026-09-25; Hito 4, bloque 4.3, paso H4C-9). Formato del comando, ANTES de tocar la
 * base; lo llama la Server Action DENTRO de su `conPermisoDeEmpresa(…)`, así que el rechazo por permiso sigue llegando antes que el de formato. Puro: sin Prisma
 * ni permisos. Son EXACTAMENTE las validaciones del nombre que antes eran lo primero de `crearInsumo`, `renombrarOFusionarInsumo` y `crearOActualizarGrupo`
 * (src/server/actions/catalogo/insumos.ts), con los MISMOS textos y en el MISMO orden. Las de activar y la de cambiar el grupo de un insumo no tienen guard
 * (solo reciben ids y un booleano).
 */

/** Guard del comando «crear (o reusar) un insumo». */
export function guardComandoCrearInsumo(entrada: { nombre: unknown }): ResultadoDato<ComandoCrearInsumo> {
  const nombre = nombreDeCatalogo(entrada.nombre, "El nombre del insumo no puede estar vacío.", "El nombre del insumo");
  if (!nombre.ok) return rechazar(nombre.codigo, nombre.mensaje);
  return aceptar({ nombre: nombre.valor });
}

/** Guard del comando «renombrar o fusionar un insumo»: solo el nombre nuevo (la confirmación de la fusión la mira el caso de uso, después de leer). */
export function guardComandoRenombrarOFusionarInsumo(entrada: { insumoId: string; nombreNuevo: unknown; confirmarFusion: boolean }): ResultadoDato<ComandoRenombrarOFusionarInsumo> {
  const nombre = nombreDeCatalogo(entrada.nombreNuevo, "El nombre nuevo no puede estar vacío.", "El nombre del insumo");
  if (!nombre.ok) return rechazar(nombre.codigo, nombre.mensaje);
  return aceptar({ insumoId: entrada.insumoId, nombre: nombre.valor, confirmarFusion: entrada.confirmarFusion });
}

/** Guard del comando «crear un grupo, o cambiarle el padre si ya existe»: solo el nombre (el ciclo lo mira el caso de uso, contra la base). */
export function guardComandoCrearOActualizarGrupo(entrada: { nombre: unknown; grupoPadreId: string | null }): ResultadoDato<ComandoCrearOActualizarGrupo> {
  const nombre = nombreDeCatalogo(entrada.nombre, "El nombre del grupo no puede estar vacío.", "El nombre del grupo");
  if (!nombre.ok) return rechazar(nombre.codigo, nombre.mensaje);
  return aceptar({ nombre: nombre.valor, grupoPadreId: entrada.grupoPadreId });
}
