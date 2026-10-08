import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoActualizarActivaProveedor, ResultadoActualizarActivaProveedor } from "@/core/features/catalogo/proveedores.schema";
import { exito } from "@/core/resultado-caso";
import { fijarActivoDeProveedor } from "@/server/persistencia/catalogo/proveedores";

/**
 * Caso de uso «activar o desactivar un proveedor» (Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-14 — `docs/plan-hito-4-pureza.md` §3).
 * Es el cuerpo que antes vivía en línea en la Server Action `actualizarActivaProveedor` (`src/server/actions/catalogo/proveedores.ts`), movido TAL CUAL: una sola
 * escritura con la base del contexto, sin leer antes el proveedor (un id que no existe hace lanzar a Prisma, como antes), sin transacción ni auditoría. La Server
 * Action quedó como adaptador (`conPermisoDeEmpresa("proveedores")` → este caso de uso → `refrescarVistaSiHaceFalta` → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Deja el proveedor activo o inactivo.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado.
 * @transaction Ninguna: una sola escritura con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría: no es plata). El refresco de la vista lo hace la Server Action.
 * @ficha permiso=proveedores transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivaProveedorCasoDeUso(
  actor: Pick<ContextoUsuario, "db">,
  comando: ComandoActualizarActivaProveedor,
): Promise<ResultadoActualizarActivaProveedor> {
  await fijarActivoDeProveedor(actor.db, { id: comando.proveedorId, activo: comando.activo });
  return exito(`Proveedor ${comando.activo ? "activado" : "desactivado"}.`, null);
}
