import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { cambioDeCliente } from "@/core/features/clientes/auditoria-de-cliente";
import type { ComandoActualizarActivoCliente, ResultadoActualizarActivoCliente } from "@/core/features/clientes/clientes.schema";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { exito, fracaso } from "@/core/resultado-caso";
import { fijarActivoDeCliente } from "@/server/persistencia/clientes/clientes";

/**
 * Caso de uso «activar o desactivar un cliente» (Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-15 — `docs/plan-hito-4-pureza.md` §3).
 * Es el cuerpo que antes vivía en línea en la Server Action `actualizarActivoCliente` (`src/server/actions/clientes/cliente.ts`), movido TAL CUAL: lee el cliente
 * con la base del contexto («No se encontró ese cliente.») y, en UNA transacción, cambia `activo` y deja UNA fila de auditoría («activo», anterior → nuevo). Nunca
 * se borra un cliente: una `Cuenta`/`Operacion` cerrada lo referencia para siempre. La Server Action quedó como adaptador (`conPermisoDeEmpresa("clientes")` →
 * este caso de uso → si salió bien, refrescar la vista → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Deja el cliente activo o inactivo y el cambio en la auditoría, salvo que no exista.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo estado (sin fila de auditoría nueva: nada cambió).
 * @transaction Transacción simple (`actor.transaccion`): el cambio y su auditoría juntos. La lectura, antes, con `actor.db`.
 * @sideEffects registrarCambioAuditado (Cliente.activo, del anterior al nuevo). El refresco de la vista lo hace la Server Action.
 * @ficha permiso=clientes transaccion=SIMPLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarActivoClienteCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "usuarioId">,
  comando: ComandoActualizarActivoCliente,
): Promise<ResultadoActualizarActivoCliente> {
  const { clienteId, activo } = comando;
  const cliente = await actor.db.cliente.findUnique({ where: { id: clienteId } });
  if (!cliente) return fracaso("NO_ENCONTRADO", "No se encontró ese cliente.");
  await actor.transaccion(async (tx) => {
    await fijarActivoDeCliente(tx, { id: clienteId, activo });
    await registrarCambioAuditado(tx, cambioDeCliente(actor.usuarioId, clienteId, cliente.nombre, "activo", cliente.activo, activo));
  });
  return exito(`Cliente "${cliente.nombre}" ${activo ? "activado" : "desactivado"}.`, null);
}
