import "server-only";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import type { ComandoEliminarSeccionHabitual, ResultadoEliminarSeccionHabitual } from "@/core/features/seccion-habitual/seccion-habitual.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { quitarSeccionHabitual } from "@/server/persistencia/stock/seccion-habitual";
import { textoDe } from "@/core/textos/texto-de";
import { ENTIDADES } from "@/core/textos/entidades";

/**
 * Caso de uso «quitar la sección habitual de un producto» (Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-20 —
 * `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action `eliminarSeccionHabitual` (`src/server/actions/stock/seccion-habitual.ts`),
 * movido TAL CUAL: la fila tiene que ser de ESTA sucursal («No se encontró esa sección habitual.») y se borra con la base del contexto, sin transacción ni
 * auditoría; el producto vuelve a salir de donde haya stock (por vencimiento). La Server Action quedó como adaptador (`conPermiso("stock_seccion_habitual")` →
 * `guardComandoEliminarSeccionHabitual` → este caso de uso → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni que el id sea un texto (el guard).
 *
 * @contract Quita (sin borrar: queda marcada con quién y cuándo, E-4(2)) la sección habitual de la sucursal activa, salvo que la fila no exista.
 * @idempotency Por estado — repetir el pedido no encuentra la fila y se rechaza: no borra nada más.
 * @transaction Ninguna: una lectura y un `UPDATE` condicionado con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría: no es plata).
 * @ficha permiso=stock_seccion_habitual transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function eliminarSeccionHabitualCasoDeUso(
  actor: Pick<ContextoDeAccion, "db" | "sucursalId" | "usuarioId" | "ahora">,
  comando: ComandoEliminarSeccionHabitual,
): Promise<ResultadoEliminarSeccionHabitual> {
  const fila = await actor.db.seccionHabitualProducto.findFirst({ where: { id: comando.id, quitadoEn: null }, include: { producto: { select: { nombre: true } } } });
  if (!fila || fila.sucursalId !== actor.sucursalId) return fracaso("NO_ENCONTRADA", textoDe("rechazo.NO_ENCONTRADO", { entidad: ENTIDADES.deposito_habitual }));
  // E-4(2): no se borra, se quita con rastro; si otro la quitó entre la lectura y acá, 0 filas = ya no está.
  if ((await quitarSeccionHabitual(actor.db, { id: fila.id, quitadoPorId: actor.usuarioId, quitadoEn: actor.ahora })) === 0) {
    return fracaso("NO_ENCONTRADA", textoDe("rechazo.NO_ENCONTRADO", { entidad: ENTIDADES.deposito_habitual }));
  }
  return exito(`«${fila.producto.nombre}» ya no tiene depósito habitual.`, null);
}
