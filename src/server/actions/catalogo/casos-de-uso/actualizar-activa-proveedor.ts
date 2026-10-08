import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { MENSAJE_PROVEEDOR_NO_ENCONTRADO } from "@/core/features/catalogo/proveedores.guard";
import type { ComandoActualizarActivaProveedor, ResultadoActualizarActivaProveedor } from "@/core/features/catalogo/proveedores.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { fijarActivoDeProveedor } from "@/server/persistencia/catalogo/proveedores";

/**
 * Caso de uso «activar o desactivar un proveedor» (Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-14 — `docs/plan-hito-4-pureza.md` §3).
 * Es el cuerpo que antes vivía en línea en la Server Action `actualizarActivaProveedor` (`src/server/actions/catalogo/proveedores.ts`): una sola escritura con la
 * base del contexto, sin leer antes el proveedor, sin transacción ni auditoría. La Server Action quedó como adaptador (`conPermisoDeEmpresa("proveedores")` → este
 * caso de uso → si salió bien, `refrescarVistaSiHaceFalta` → `aResultadoAccion`).
 *
 * O.44 (Hito 4, bloque D; CAMBIA COMPORTAMIENTO, aprobado por el dueño el 2026-10-08): un id que no existe (o de otra empresa) ya no hace lanzar a Prisma (un 500):
 * la escritura es un `updateMany` y su `count` en 0 devuelve `NO_ENCONTRADO` («No se encontró ese proveedor.», el mismo de la edición) sin escribir nada; la acción
 * no refresca.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Deja el proveedor activo o inactivo, si existe.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado.
 * @transaction Ninguna: una sola escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría: no es plata). El refresco de la vista lo hace la Server Action.
 * @ficha permiso=proveedores transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivaProveedorCasoDeUso(
  actor: Pick<ContextoUsuario, "db">,
  comando: ComandoActualizarActivaProveedor,
): Promise<ResultadoActualizarActivaProveedor> {
  if (!(await fijarActivoDeProveedor(actor.db, { id: comando.proveedorId, activo: comando.activo }))) return fracaso("NO_ENCONTRADO", MENSAJE_PROVEEDOR_NO_ENCONTRADO);
  return exito(`Proveedor ${comando.activo ? "activado" : "desactivado"}.`, null);
}
