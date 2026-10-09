"use server";

import { guardComandoGuardarDescuentoProducto } from "@/core/features/carta/descuento-producto.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { guardarDescuentoProductoCasoDeUso } from "./casos-de-uso/guardar-descuento-producto";
import { revalidarCartasPublicas } from "./revalidar";

/**
 * Producto con descuento (decisión del dueño, 2026-10-01): un porcentaje sobre el precio vigente de UN producto de venta EN LA SUCURSAL ACTIVA
 * (no es una promoción: la promo es la armable de la carta). Fila ausente = sin descuento; vacío o 0 la borra. Se aplica en la carta pública y en el
 * POS, no en la venta de mostrador. Gate: `carta_producto_descuento` (sucursal). Un producto que es opción de un ítem agrupado no admite descuento:
 * el renglón agrupado muestra un solo precio, así que `agregarOpcionItemAgrupadoCarta` bloquea el camino inverso.
 *
 * Desde el Hito 4 de la pureza (bloque 4.2, paso H4C-1) esta Server Action es un adaptador fino: permiso (`conPermiso("carta_producto_descuento")`) → formato
 * del % (`guardComandoGuardarDescuentoProducto`, core/features/carta/descuento-producto.guard.ts, DENTRO del envoltorio) → caso de uso
 * (`casos-de-uso/guardar-descuento-producto.ts`: el producto, la fila actual, el ítem agrupado, la escritura en server/persistencia/carta/descuento-producto.ts y
 * su auditoría en la misma transacción) → revalidar la carta pública SOLO si el caso de uso escribió (`datos.huboCambio`: sacar un descuento que no había no
 * revalida, como antes) → `aResultadoAccion`. Es la única función del archivo: está entero en `ACCIONES_CON_CASO_DE_USO`.
 */
export async function guardarDescuentoProducto(productoId: string, porcentaje: number | string | null): Promise<ResultadoAccion> {
  return conPermiso("carta_producto_descuento", async (ctx) => {
    const comando = guardComandoGuardarDescuentoProducto({ productoId, porcentaje });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await guardarDescuentoProductoCasoDeUso(ctx, comando.valor);
    if (resultado.ok && resultado.datos.huboCambio) revalidarCartasPublicas(ctx.empresaSlug);
    return aResultadoAccion(resultado);
  });
}
