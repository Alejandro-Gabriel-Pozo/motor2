import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoActualizarActivaPresentacion, ResultadoActualizarActivaPresentacion } from "@/core/features/catalogo/productos.schema";
import { exito } from "@/core/resultado-caso";
import { fijarActivaDePresentacion } from "@/server/persistencia/catalogo/productos";

/**
 * Caso de uso «activar o desactivar una presentación de compra» (Hito 4 de la pureza, bloque 4.3, paso H4C-11 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que
 * antes vivía en línea en la Server Action `actualizarActivaPresentacion` (`src/server/actions/catalogo/productos.ts`), movido TAL CUAL: una sola escritura con la
 * base del contexto, sin transacción ni auditoría (activa no cambia el factor). HALLAZGO conocido, migrado tal cual (informado por el plan, se arregla aparte): NO
 * chequea que la presentación exista — un id roto hace lanzar a Prisma y el usuario ve un 500 en vez de «No se encontró la presentación.». La Server Action quedó
 * como adaptador (`conPermisoDeEmpresa("producto_presentaciones")` → este caso de uso → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Deja la presentación activa o inactiva.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado.
 * @transaction Ninguna: una sola escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría).
 * @ficha permiso=producto_presentaciones transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivaPresentacionCasoDeUso(
  actor: Pick<ContextoUsuario, "db">,
  comando: ComandoActualizarActivaPresentacion,
): Promise<ResultadoActualizarActivaPresentacion> {
  await fijarActivaDePresentacion(actor.db, { id: comando.presentacionId, activa: comando.activa });
  return exito(`Presentación ${comando.activa ? "activada" : "desactivada"}.`, null);
}
