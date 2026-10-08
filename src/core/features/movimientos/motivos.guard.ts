import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { nombreDeCatalogo } from "@/core/features/catalogo/nombre-de-catalogo";
import { texto, validarLargoTexto } from "@/core/texto";
import type { ComandoCrearMotivo } from "./motivos.schema";

/**
 * Guard de la feature «motivos de merma y destinos de consumo» (convención «guard por feature», 2026-09-25; Hito 4, bloque C, paso H4C-17). Formato del comando,
 * ANTES de tocar la base; lo llama la Server Action DENTRO de su `conPermisoDeEmpresa(…)`, así que el rechazo por permiso sigue llegando antes que el de formato.
 * Puro: sin Prisma ni permisos.
 *
 * Tienen guard las dos altas: sus validaciones iban TODAS antes de la primera lectura. Las dos de activar solo reciben un id y un booleano: sin guard (`SIN_GUARD`).
 */

/**
 * Igual que LARGO_MAXIMO_TEXTO_CATALOGO (texto.ts) pero para `descripcion`: no usa RE_TEXTO_CATALOGO (su charset prohíbe «» y :, y la nota de negocio de BUGFIX A-3
 * usa ambos) — solo se acota el largo. Mismo tope que ya fija motivos-semilla.test.ts. (Vivía en `src/server/actions/movimientos/motivos.ts`.)
 */
const LARGO_MAXIMO_DESCRIPCION = 300;

/** El nombre (recortado, no vacío, charset y largo de catálogo, con la etiqueta de cada catálogo) y después la descripción (recortada, hasta 300; vacía → `null`). */
function comandoCrearMotivo(entrada: { nombre: unknown; descripcion: unknown }, etiqueta: string): ResultadoDato<ComandoCrearMotivo> {
  const nombre = nombreDeCatalogo(entrada.nombre, `${etiqueta} no puede estar vacío.`, etiqueta);
  if (!nombre.ok) return rechazar(nombre.codigo, nombre.mensaje);
  const d = texto(entrada.descripcion);
  const errorDescripcion = validarLargoTexto(d, "La descripción", LARGO_MAXIMO_DESCRIPCION);
  if (errorDescripcion) return rechazar("largo", errorDescripcion);
  return aceptar({ nombre: nombre.valor, descripcion: d || null });
}

/** Guard del alta de un motivo de merma: EXACTAMENTE lo que antes era lo primero de `crearMotivoMerma`, con los MISMOS textos y en el MISMO orden. */
export function guardComandoCrearMotivoMerma(entrada: { nombre: unknown; descripcion: unknown }): ResultadoDato<ComandoCrearMotivo> {
  return comandoCrearMotivo(entrada, "El nombre del motivo");
}

/** Guard del alta de un destino de consumo: EXACTAMENTE lo que antes era lo primero de `crearDestinoConsumo`, con los MISMOS textos y en el MISMO orden. */
export function guardComandoCrearDestinoConsumo(entrada: { nombre: unknown; descripcion: unknown }): ResultadoDato<ComandoCrearMotivo> {
  return comandoCrearMotivo(entrada, "El nombre del destino");
}
