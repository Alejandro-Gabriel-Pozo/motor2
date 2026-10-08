import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoSeccionHabitual, ResultadoSetSeccionHabitual } from "@/core/features/seccion-habitual/seccion-habitual.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { guardarSeccionHabitual } from "@/server/persistencia/stock/seccion-habitual";

/**
 * Caso de uso «fijar la sección habitual de un producto de venta en la sucursal activa» (docs/plan-seccion-habitual-stock-2026-09-25.md, C1/C2; Hito 4 de la
 * pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-20 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action
 * `setSeccionHabitual` (`src/server/actions/stock/seccion-habitual.ts`), movido TAL CUAL y en el MISMO orden, con la base del contexto: el producto (que exista y
 * sea un PV), la sección (de ESTA sucursal y activa) y el alta o reemplazo de la fila, sin transacción ni auditoría. De esa sección de STOCK sale primero lo que
 * consume el producto al cerrar una cuenta del salón. La Server Action quedó como adaptador (`conPermiso("stock_seccion_habitual")` →
 * `guardComandoSeccionHabitual` → este caso de uso → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato (el guard).
 *
 * @contract Deja la sección habitual del PV en la sucursal activa (una fila), salvo que el producto o la sección no sirvan.
 * @idempotency No aplica — repetir el pedido vuelve a escribir la misma sección (el upsert no duplica la fila).
 * @transaction Ninguna: lecturas y una escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría: no es plata).
 * @ficha permiso=stock_seccion_habitual transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function setSeccionHabitualCasoDeUso(actor: Pick<ContextoUsuario, "db" | "sucursalId">, comando: ComandoSeccionHabitual): Promise<ResultadoSetSeccionHabitual> {
  const producto = await actor.db.producto.findUnique({ where: { id: comando.productoId } });
  if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");
  if (producto.tipo !== "PV") return fracaso("NO_ES_PV", `Solo un producto de venta (PV) tiene sección habitual: «${producto.nombre}» es una materia prima.`);

  const seccion = await actor.db.seccion.findUnique({ where: { id: comando.seccionId } });
  if (!seccion || seccion.sucursalId !== actor.sucursalId) return fracaso("SECCION_NO_ENCONTRADA", "No se encontró la sección.");
  if (!seccion.activa) return fracaso("SECCION_INACTIVA", `La sección «${seccion.nombre}» está desactivada: activala o elegí otra.`);

  await guardarSeccionHabitual(actor.db, { sucursalId: actor.sucursalId, productoId: producto.id, seccionId: seccion.id });
  return exito(`Sección habitual de «${producto.nombre}»: «${seccion.nombre}».`, null);
}
