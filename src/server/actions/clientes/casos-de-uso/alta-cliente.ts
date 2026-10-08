import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { cambioDeCliente } from "@/core/features/clientes/auditoria-de-cliente";
import type { ComandoAltaCliente, ResultadoAltaCliente } from "@/core/features/clientes/clientes.schema";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { exito, fracaso } from "@/core/resultado-caso";
import { crearClienteNuevo } from "@/server/persistencia/clientes/clientes";

/**
 * Caso de uso «alta de un cliente con % de descuento» (Task #14, docs/plan-clientes-descuento-2026-09-26.md; Hito 4 de la pureza, bloque C de la pieza
 * carta/catálogo/stock, paso H4C-15 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action `altaCliente`
 * (`src/server/actions/clientes/cliente.ts`), movido TAL CUAL: rechaza un nombre ya usado (sin distinguir mayúsculas, leído con la base del contexto ANTES de la
 * transacción) y crea el cliente con DOS filas de auditoría en la MISMA transacción, en este orden: «nombre» (null → el nombre) y «descuentoPorcentaje» (null → el
 * %). La Server Action quedó como adaptador (`conPermisoDeEmpresa("clientes")` → `guardComandoAltaCliente` → este caso de uso → `aResultadoAccion` y el id y el
 * nombre para su `ResultadoConId`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato (el guard).
 *
 * @contract Crea el cliente con su %, salvo que ya haya uno con ese nombre, y deja su alta en la auditoría; devuelve su id y su nombre.
 * @idempotency Por estado — repetir el pedido encuentra el cliente ya creado con ese nombre y se rechaza: no crea otro.
 * @transaction Transacción simple (`actor.transaccion`): el alta y sus dos filas de auditoría juntas. El nombre repetido se lee antes, con `actor.db`.
 * @sideEffects registrarCambioAuditado (Cliente.nombre y Cliente.descuentoPorcentaje, de null al valor nuevo).
 * @ficha permiso=clientes transaccion=SIMPLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function altaClienteCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "usuarioId">,
  comando: ComandoAltaCliente,
): Promise<ResultadoAltaCliente> {
  const { nombre: n, descuentoPorcentaje: pct } = comando;
  const existente = await actor.db.cliente.findFirst({ where: { nombre: { equals: n, mode: "insensitive" } } });
  if (existente) return fracaso("NOMBRE_REPETIDO", `Ya existe un cliente llamado "${existente.nombre}".`);

  const creado = await actor.transaccion(async (tx) => {
    const c = await crearClienteNuevo(tx, { nombre: n, descuentoPorcentaje: pct! });
    await registrarCambioAuditado(tx, cambioDeCliente(actor.usuarioId, c.id, c.nombre, "nombre", null, c.nombre));
    await registrarCambioAuditado(tx, cambioDeCliente(actor.usuarioId, c.id, c.nombre, "descuentoPorcentaje", null, pct));
    return c;
  });
  return exito(`Cliente "${creado.nombre}" creado, con ${pct}% de descuento.`, { id: creado.id, nombre: creado.nombre });
}
