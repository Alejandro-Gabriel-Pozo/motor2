import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { validarPorcentajeDescuento } from "@/core/datos/porcentaje-descuento";
import { cambioDeCliente } from "@/core/features/clientes/auditoria-de-cliente";
import { nombreDeCliente } from "@/core/features/clientes/clientes.guard";
import type { ComandoActualizarCliente, ResultadoActualizarCliente } from "@/core/features/clientes/clientes.schema";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { exito, fracaso } from "@/core/resultado-caso";
import { guardarDatosDeCliente } from "@/server/persistencia/clientes/clientes";

/**
 * Caso de uso «corregir nombre y % de un cliente ya creado» (Hito 4 de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-15 —
 * `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action `actualizarCliente` (`src/server/actions/clientes/cliente.ts`),
 * movido TAL CUAL y en el MISMO orden: lee el cliente con la base del contexto (un id inexistente gana sobre un dato inválido), valida el nombre
 * (`nombreDeCliente`) y el % (`validarPorcentajeDescuento`), rechaza un nombre que ya tiene OTRO cliente y, en UNA transacción, reescribe los dos datos y deja
 * DOS filas de auditoría en este orden: «nombre» (anterior → nuevo) y «descuentoPorcentaje» (el % de antes, como número → el nuevo); `registrarCambioAuditado` no
 * escribe la que no cambió. El % nuevo NO reescribe ninguna `Cuenta` ya asignada (D7: el % queda congelado en la cuenta). La Server Action quedó como adaptador
 * (`conPermisoDeEmpresa("clientes")` → este caso de uso → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos. Sin guard: la validación va después de leer el cliente.
 *
 * @contract Reescribe nombre y % del cliente y deja lo que cambió en la auditoría, salvo que no exista, un dato sea inválido o el nombre sea de otro.
 * @idempotency No aplica — repetir el pedido vuelve a escribir los mismos datos (sin filas de auditoría nuevas: nada cambió).
 * @transaction Transacción simple (`actor.transaccion`): la escritura y su auditoría juntas. Las lecturas, antes, con `actor.db`.
 * @sideEffects registrarCambioAuditado (Cliente.nombre y Cliente.descuentoPorcentaje, del anterior al nuevo).
 * @ficha permiso=clientes transaccion=SIMPLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarClienteCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "usuarioId">,
  comando: ComandoActualizarCliente,
): Promise<ResultadoActualizarCliente> {
  const { clienteId } = comando;
  const cliente = await actor.db.cliente.findUnique({ where: { id: clienteId } });
  if (!cliente) return fracaso("NO_ENCONTRADO", "No se encontró ese cliente.");

  const nombre = nombreDeCliente(comando.nombre);
  if (!nombre.ok) return fracaso("DATO_INVALIDO", nombre.mensaje);
  const n = nombre.valor;

  const pct = validarPorcentajeDescuento(comando.descuentoPorcentaje);
  if (!pct.ok) return fracaso("DATO_INVALIDO", pct.mensaje);

  const dup = await actor.db.cliente.findFirst({ where: { id: { not: clienteId }, nombre: { equals: n, mode: "insensitive" } } });
  if (dup) return fracaso("NOMBRE_REPETIDO", `Ya existe un cliente llamado "${dup.nombre}".`);

  await actor.transaccion(async (tx) => {
    await guardarDatosDeCliente(tx, { id: clienteId, nombre: n, descuentoPorcentaje: pct.valor! });
    await registrarCambioAuditado(tx, cambioDeCliente(actor.usuarioId, clienteId, n, "nombre", cliente.nombre, n));
    await registrarCambioAuditado(tx, cambioDeCliente(actor.usuarioId, clienteId, n, "descuentoPorcentaje", Number(cliente.descuentoPorcentaje), pct.valor));
  });
  return exito(`Cliente "${n}" actualizado.`, null);
}
