import "server-only";
import type { ResultadoCaso, ResultadoMensaje } from "@/core/resultado-caso";
import type { ResultadoConConfirmacion } from "../tipos";

/**
 * Lo que la pantalla recibe de las acciones de ingredientes de receta: el `ResultadoAccion` de siempre (`aResultadoAccion`, que no deja pasar `codigo` ni `datos`) y, solo si el rechazo es el de la
 * guardia de unidad (`CANTIDAD_DESPROPORCIONADA`), la marca `requiereConfirmacion` para que la pantalla ofrezca confirmar. Vive en un archivo aparte porque `recetas.ts` y `receta-sucursal.ts` son
 * `"use server"` y solo pueden exportar acciones.
 */
export function conPedidoDeConfirmacion(resultado: ResultadoCaso<unknown, string>, base: ResultadoMensaje): ResultadoConConfirmacion {
  if (!resultado.ok && resultado.codigo === "CANTIDAD_DESPROPORCIONADA") return { ok: false, mensaje: base.mensaje, requiereConfirmacion: true };
  return base;
}
