"use server";

import { guardComandoAnularItemEnviado, guardComandoAnularPromoEnviada } from "@/core/features/cuentas/cuenta-anulacion.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { anularItemEnviadoCasoDeUso } from "./casos-de-uso/anular-item-enviado";
import { anularPromoEnviadaCasoDeUso } from "./casos-de-uso/anular-promo-enviada";

/**
 * Toma de pedido en el salón — anular con motivo lo que YA SALIÓ a cocina (un ítem suelto o una promo entera).
 * Criterio común de todas las acciones de «tomar pedido» (transacción SERIALIZABLE, mesa de la sucursal activa, cuenta abierta, sin
 * refrescar la vista) y ayudantes compartidos: ./cuenta-comun.ts.
 */

/**
 * Anula (total o parcialmente) un ítem que YA SALIÓ a cocina (plan B2/B3): escribe una fila ESPEJO — un CuentaItem nuevo con la
 * cantidad en NEGATIVO, mismo producto/precio/envío, `anulaAItemId` al original, el motivo y quién lo hizo — más una fila en el registro
 * de auditoría (entidad `CuentaItem`, campo `cantidadVigente`). El original nunca se edita ni se borra: lo que queda se calcula
 * (`restanteDe`). Permiso propio, más restrictivo que tomar pedido (el mozo no lo tiene de fábrica).
 *
 * `restanteVisto` es la guarda optimista (mismo criterio que el `esperado` de `corregirCompra`): lo que quedaba del ítem cuando el
 * usuario abrió el diálogo. Si otro lo anuló mientras tanto, se rechaza en vez de anular sobre un número que ya no es el que vio.
 * Una cuenta ya cerrada no se toca: su venta se anula por el camino de siempre (`anularVenta`).
 *
 * Desde la Task #41 (Fase M12c, docs/arquitectura-casos-de-uso-2026-09-27.md) esta Server Action es un adaptador fino: permiso
 * (`conPermiso`) → formato del `cuentaItemId` (`guardComandoAnularItemEnviado`, core/features/cuentas/cuenta-anulacion.guard.ts) → caso de
 * uso (`casos-de-uso/anular-item-enviado.ts`: transacción serializable, carga, guardas de estado, motivo, guarda optimista, cantidad, fila
 * espejo y auditoría; lectura y escritura en server/persistencia/pos/) → `aResultadoAccion`. Con `anularPromoEnviada` (abajo, M12d)
 * también migrada, el archivo entero está en `ACCIONES_CON_CASO_DE_USO`.
 */
export async function anularItemEnviado(cuentaItemId: string, cantidad: number, motivo: string, restanteVisto: number): Promise<ResultadoAccion> {
  return conPermiso("pos_anular_item", async (ctx) => {
    const comando = guardComandoAnularItemEnviado({ cuentaItemId, cantidad, motivo, restanteVisto });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await anularItemEnviadoCasoDeUso(ctx, comando.valor));
  });
}

/**
 * Anula la promo ENTERA ya enviada a cocina (Task #16, D4: "una promo se anula entera, nunca un componente suelto"): crea una
 * fila ESPEJO por CADA componente vigente (el resto que le quedaba, íntegro), cada una con el MISMO `promoCuentaId` — mismo
 * patrón que `anularItemEnviado` (fila espejo + auditoría), pero para TODOS los componentes juntos en una sola llamada, todo
 * o nada. Mismo permiso (`pos_anular_item`, más restrictivo que tomar pedido). Una cuenta ya cerrada no se toca: su venta se
 * anula por el camino de siempre (`anularVenta`, paso 9), que también anula los hermanos.
 *
 * Desde la Task #41 (Fase M12d, docs/arquitectura-casos-de-uso-2026-09-27.md) esta Server Action es un adaptador fino: permiso
 * (`conPermiso`) → formato del `promoCuentaId` (`guardComandoAnularPromoEnviada`, core/features/cuentas/cuenta-anulacion.guard.ts) →
 * caso de uso (`casos-de-uso/anular-promo-enviada.ts`: transacción serializable, carga, guardas de estado, motivo, una fila espejo y una
 * fila de auditoría por componente; lectura y escritura en server/persistencia/pos/) → `aResultadoAccion`.
 */
export async function anularPromoEnviada(promoCuentaId: string, motivo: string): Promise<ResultadoAccion> {
  return conPermiso("pos_anular_item", async (ctx) => {
    const comando = guardComandoAnularPromoEnviada({ promoCuentaId, motivo });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await anularPromoEnviadaCasoDeUso(ctx, comando.valor));
  });
}
