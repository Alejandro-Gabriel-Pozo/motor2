import { normalizarOrigen, type OrigenCalibracionInput } from "@/core/catalogo/public";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { esNumeroEstricto } from "@/core/numero";
import type { ComandoFijarRendimientoLocal } from "./rendimiento-local.schema";

/**
 * Guard de la feature «rendimiento local de una línea de receta» (convención «guard por feature», 2026-09-25; Hito 4, bloque 4.2, paso H4C-5). Formato del
 * comando, ANTES de tocar la base; lo llama la Server Action DENTRO de su `conPermiso(…)`, así que el rechazo por permiso sigue llegando antes que el de formato.
 * Puro: sin Prisma ni permisos.
 *
 * Es EXACTAMENTE lo que antes iba al principio de `fijarRendimientoLocal` (src/server/actions/catalogo/rendimiento-local.ts), antes de abrir la transacción, con
 * los MISMOS textos y en el MISMO orden: la cantidad, la merma, que no vengan las dos vacías y el origen (D6(c): una anotación declarada por el cliente, nunca una
 * prueba — se normaliza y, si la sucursal con la que se armó la sugerencia ya no es la activa, se rechaza). `volverAlRendimientoCentral` no tiene guard (solo
 * recibe el id).
 */

/** Decimal(14,4) del schema — tope defensivo, ver docstring del modelo. */
const TOPE_CANTIDAD = 100_000_000; // 10 dígitos enteros + 4 decimales, con margen
const TOPE_MERMA = 9999.99;

function validarCantidad(c: number | null | undefined): string | null {
  if (c === null || c === undefined) return null;
  if (!esNumeroEstricto(c) || !(c > 0)) return "La cantidad tiene que ser un número mayor a 0.";
  if (c >= TOPE_CANTIDAD) return "La cantidad es demasiado grande.";
  return null;
}

function validarMerma(m: number | null | undefined): string | null {
  if (m === null || m === undefined) return null;
  if (!esNumeroEstricto(m)) return "La merma no es un número válido.";
  if (m < 0 || m > TOPE_MERMA) return "La merma tiene que estar entre 0 y 9999,99.";
  return null;
}

/** Guard del comando «calibrar el rendimiento de una línea en la sucursal activa» (`sucursalActivaId`: la del contexto de quien llama). */
export function guardComandoFijarRendimientoLocal(entrada: {
  recetaIngredienteId: string;
  valores: { cantidad: number | null; mermaPorcentaje: number | null };
  origen?: OrigenCalibracionInput;
  sucursalActivaId: string;
}): ResultadoDato<ComandoFijarRendimientoLocal> {
  const { valores } = entrada;
  const errCantidad = validarCantidad(valores.cantidad);
  if (errCantidad) return rechazar("rango", errCantidad);
  const errMerma = validarMerma(valores.mermaPorcentaje);
  if (errMerma) return rechazar("rango", errMerma);
  if (valores.cantidad === null && valores.mermaPorcentaje === null) {
    return rechazar("vacio", "Elegí al menos un valor para calibrar (cantidad o merma).");
  }

  // D6(c): el origen es una anotación declarada por el cliente, nunca una prueba — se normaliza y, si la sucursal con
  // la que se armó la sugerencia ya no es la activa, se rechaza (evita escribir en la sucursal equivocada si el
  // usuario cambió de sucursal con el reporte todavía abierto en otra pestaña).
  const origen = entrada.origen ? normalizarOrigen(entrada.origen) : null;
  if (origen && origen.sucursalCalculoId !== entrada.sucursalActivaId) {
    return rechazar("formato", "Cambiaste de sucursal desde que abriste el reporte; recargalo.");
  }
  return aceptar({ recetaIngredienteId: entrada.recetaIngredienteId, cantidad: valores.cantidad, mermaPorcentaje: valores.mermaPorcentaje, origen });
}
