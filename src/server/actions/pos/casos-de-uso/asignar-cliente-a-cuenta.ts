import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoAsignarClienteACuenta, ResultadoAsignarClienteACuenta } from "@/core/features/cuentas/cuenta-apertura.schema";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { exito, fracaso } from "@/core/resultado-caso";
import { fijarClienteDeCuenta } from "@/server/persistencia/pos/cuenta";
import { cuentaAbiertaDeSucursal } from "@/server/persistencia/pos/cargar-cuenta-abierta";

/**
 * Caso de uso «asignar (o quitar) el cliente con descuento de una cuenta abierta» (Hito 4 de la pureza, bloque 4.1, paso 7 — `docs/plan-hito-4-pureza.md` §5).
 * Es el cuerpo que antes vivía en línea en la Server Action `asignarClienteACuenta` (`src/server/actions/pos/cuenta-apertura.ts`), movido TAL CUAL: la misma
 * transacción SERIALIZABLE, las mismas lecturas en el mismo orden, la escritura ANTES de sus dos filas de auditoría y los mismos mensajes. La Server Action
 * quedó como adaptador (`conPermiso("pos_asignar_cliente")` → `guardComandoAsignarClienteACuenta` → este caso de uso → `aResultadoAccion`). El criterio de
 * negocio (D3: cualquier mozo; D7: el % se CONGELA en la cuenta al asignarlo; un cliente desactivado no se asigna pero sí se quita) está documentado en la
 * Server Action.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (`conPermiso`) ni que el id de la cuenta sea un texto (el guard).
 *
 * Orden, igual que antes, dentro de la transacción:
 *  1. la cuenta, de una mesa de ESTA sucursal y abierta (`cuentaAbiertaDeSucursal`, server/persistencia/pos/cargar-cuenta-abierta.ts): gana sobre un cliente inexistente;
 *  2. el nombre del cliente que tenía (para la auditoría);
 *  3. quitar (`clienteId === null`): limpia cliente y % (`fijarClienteDeCuenta`, server/persistencia/pos/cuenta.ts) y audita;
 *  4. asignar: el cliente (un id que no es texto, o que no existe → «No se encontró ese cliente.»; desactivado → rechazo), la escritura con el % de HOY del
 *     cliente como snapshot y la auditoría.
 * La auditoría son DOS filas (entidad «Cuenta»), en este orden: «cliente» (nombre anterior → nuevo) y «descuentoPorcentaje» (el % CONGELADO que tenía la cuenta
 * → el nuevo); `registrarCambioAuditado` no escribe la que no cambió. Quién puso o sacó un cliente con descuento queda acá: la `Operacion` de la venta solo
 * guarda a quien cerró la cuenta.
 *
 * @contract Deja en la cuenta abierta de una mesa de la sucursal el cliente pedido con su % de hoy congelado (o ninguno), con su registro de auditoría.
 * @idempotency No aplica — reasignar el mismo cliente vuelve a escribir el snapshot (sin filas de auditoría nuevas si nada cambió).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento): escritura y auditoría juntas.
 * @sideEffects registrarCambioAuditado (Cuenta.cliente y Cuenta.descuentoPorcentaje, del anterior al nuevo).
 * @ficha permiso=pos_asignar_cliente transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function asignarClienteACuentaCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "sucursalId" | "transaccion">,
  comando: ComandoAsignarClienteACuenta,
): Promise<ResultadoAsignarClienteACuenta> {
  const { clienteId } = comando;
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoAsignarClienteACuenta> => {
    const abierta = await cuentaAbiertaDeSucursal(tx, comando.cuentaId, actor.sucursalId);
    if (!abierta.ok) return fracaso("CUENTA_NO_ABIERTA", abierta.mensaje);

    const anterior = abierta.cuenta.clienteId ? await tx.cliente.findUnique({ where: { id: abierta.cuenta.clienteId }, select: { nombre: true } }) : null;
    const auditar = async (nuevo: { nombre: string; porcentaje: number } | null) => {
      const base = { entidad: "Cuenta", entidadId: abierta.cuenta.id, actorId: actor.usuarioId, sucursalId: actor.sucursalId } as const;
      const mesa = abierta.cuenta.mesa.numero;
      await registrarCambioAuditado(tx, { ...base, campo: "cliente", descripcion: `Mesa ${mesa}: cliente de la cuenta`, valorAnterior: anterior?.nombre ?? null, valorNuevo: nuevo?.nombre ?? null });
      await registrarCambioAuditado(tx, {
        ...base,
        campo: "descuentoPorcentaje",
        descripcion: `Mesa ${mesa}: % de descuento de la cuenta`,
        valorAnterior: abierta.cuenta.descuentoPorcentaje === null ? null : Number(abierta.cuenta.descuentoPorcentaje),
        valorNuevo: nuevo?.porcentaje ?? null,
      });
    };

    if (clienteId === null) {
      await fijarClienteDeCuenta(tx, { cuentaId: abierta.cuenta.id, clienteId: null, descuentoPorcentaje: null });
      await auditar(null);
      return exito(`Se quitó el cliente de la mesa ${abierta.cuenta.mesa.numero}.`, null);
    }

    const cliente = typeof clienteId === "string" ? await tx.cliente.findUnique({ where: { id: clienteId } }) : null;
    if (!cliente) return fracaso("CLIENTE_NO_ENCONTRADO", "No se encontró ese cliente.");
    if (!cliente.activo) return fracaso("CLIENTE_DESACTIVADO", `«${cliente.nombre}» está desactivado: no se puede asignar a una cuenta.`);

    await fijarClienteDeCuenta(tx, { cuentaId: abierta.cuenta.id, clienteId: cliente.id, descuentoPorcentaje: cliente.descuentoPorcentaje });
    await auditar({ nombre: cliente.nombre, porcentaje: Number(cliente.descuentoPorcentaje) });
    return exito(`«${cliente.nombre}» asignado a la mesa ${abierta.cuenta.mesa.numero}, con ${cliente.descuentoPorcentaje}% de descuento.`, null);
  });
}
