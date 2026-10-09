"use server";

import { guardComandoCopiarCartaDeSucursal } from "@/core/features/carta/copiar-carta.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { copiarCartaDeSucursalCasoDeUso } from "./casos-de-uso/copiar-carta-de-sucursal";
import { revalidarCartasPublicas } from "./revalidar";

/**
 * Copia la carta PROPIA de otra sucursal a la sucursal activa (ADR-009, C3/C4; decisión del dueño 2026-10-02): géneros, ítems agrupados con sus
 * opciones y el contenido de cada producto (sección, descripción, orden, género…). Las secciones son de la empresa y no se copian: ya están.
 *
 * Solo copia sobre una carta VACÍA (la familia es «opt-in»: una sucursal sin carta no muestra nada hasta que la arma o la copia). Nunca pisa ni
 * mezcla con una carta ya armada: si la sucursal tiene aunque sea un contenido, un género o un ítem propios, rechaza. La comprobación y la copia
 * van en la MISMA transacción serializable, así dos copias a la vez no duplican ni se mezclan. Nunca recibe el destino por parámetro (siempre
 * `ctx.sucursalId`) y exige la confirmación explícita. Una clave propia: `carta_copiar_de_sucursal`. No toca promos ni cupos.
 *
 * Desde el Hito 5 de la pureza (bloque D, `docs/plan-hito-5-pureza.md` §6.1) es un adaptador fino: permiso (`conPermiso("carta_copiar_de_sucursal")`) → confirmación y
 * origen distinto de la sucursal activa (`guardComandoCopiarCartaDeSucursal`, core/features/carta/copiar-carta.guard.ts, DENTRO del envoltorio) → caso de uso
 * (`casos-de-uso/copiar-carta-de-sucursal.ts`: el origen, la transacción serializable, la copia en server/persistencia/carta/copiar-carta.ts, la auditoría y el conflicto
 * agotado) → revalidar la carta pública si salió bien (antes se invalidaba dentro del callback, antes de confirmar: ahora después) → `aResultadoAccion`.
 *
 * DECISIÓN (reserva M1(b) de la auditoría del Hito 5, fila 5.6 de `docs/pureza-integracion.md`): la revalidación NO se captura. Si `revalidarCartasPublicas` lanzara DESPUÉS de confirmar la copia,
 * la copia ya está hecha y la acción lanza igual. Es a propósito: `revalidarCartasPublicas` ya traga el único error esperable (E263, fuera de un contexto Next) y cualquier otro es un error de
 * programación (un patrón mal escrito) que tiene que verse, no taparse; el estado de la base queda bien y repetir el pedido encuentra «ya tiene carta propia». Mismo criterio que el resto de las acciones.
 */
export async function copiarCartaDeSucursal(sucursalOrigenId: string, confirmado: boolean): Promise<ResultadoAccion> {
  return conPermiso("carta_copiar_de_sucursal", async (ctx) => {
    const comando = guardComandoCopiarCartaDeSucursal({ sucursalOrigenId, confirmado, sucursalActivaId: ctx.sucursalId });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await copiarCartaDeSucursalCasoDeUso(ctx, comando.valor);
    if (resultado.ok) revalidarCartasPublicas(ctx.empresaSlug);
    return aResultadoAccion(resultado);
  });
}
