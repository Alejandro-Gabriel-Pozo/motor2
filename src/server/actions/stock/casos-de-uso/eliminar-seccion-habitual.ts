import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoEliminarSeccionHabitual, ResultadoEliminarSeccionHabitual } from "@/core/features/seccion-habitual/seccion-habitual.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { borrarSeccionHabitual } from "@/server/persistencia/stock/seccion-habitual";

/**
 * Caso de uso «quitar la sección habitual de un producto» (Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-20 —
 * `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action `eliminarSeccionHabitual` (`src/server/actions/stock/seccion-habitual.ts`),
 * movido TAL CUAL: la fila tiene que ser de ESTA sucursal («No se encontró esa sección habitual.») y se borra con la base del contexto, sin transacción ni
 * auditoría; el producto vuelve a salir de donde haya stock (por vencimiento). La Server Action quedó como adaptador (`conPermiso("stock_seccion_habitual")` →
 * `guardComandoEliminarSeccionHabitual` → este caso de uso → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni que el id sea un texto (el guard).
 *
 * @contract Borra la sección habitual de la sucursal activa, salvo que la fila no exista.
 * @idempotency Por estado — repetir el pedido no encuentra la fila y se rechaza: no borra nada más.
 * @transaction Ninguna: una lectura y un borrado con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría: no es plata).
 * @ficha permiso=stock_seccion_habitual transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function eliminarSeccionHabitualCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "sucursalId">,
  comando: ComandoEliminarSeccionHabitual,
): Promise<ResultadoEliminarSeccionHabitual> {
  const fila = await actor.db.seccionHabitualProducto.findUnique({ where: { id: comando.id }, include: { producto: { select: { nombre: true } } } });
  if (!fila || fila.sucursalId !== actor.sucursalId) return fracaso("NO_ENCONTRADA", "No se encontró esa sección habitual.");
  await borrarSeccionHabitual(actor.db, { id: fila.id });
  return exito(`«${fila.producto.nombre}» ya no tiene sección habitual.`, null);
}
