import "server-only";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import { textoDe } from "@/core/textos/texto-de";
import { ENTIDADES } from "@/core/textos/entidades";
import { horaDeCorteDeColumnaTime, horaDeCorteValida } from "@/core/tiempo/fecha-de-negocio";
import { cambiarHoraDeCorteDeSucursalEnBase } from "@/server/persistencia/auth/sucursales";

type ResultadoCambiarHoraDeCorte = ResultadoCaso<{ sinCambios: boolean }, "SUCURSAL_NO_ENCONTRADA" | "HORA_DE_CORTE_INVALIDA">;

/**
 * Caso de uso «cambiar la hora de corte de una sucursal» (etapa C2c de `docs/diseno-caja-c2-jornada-y-cierre-del-dia-2026-11-16.md`; forma y permiso confirmados por el dueño el 2026-11-17, «5.- recomendado»):
 * la hora a partir de la cual empieza el día de negocio de la caja. Se cambia desde la edición de sucursal, con el MISMO permiso que renombrarla (`renombrar_sucursal`), y solo HACIA ADELANTE: cada sesión de caja
 * conserva la hora que selló al abrirse (la app no tiene `UPDATE` sobre `SesionCaja.horaDeCorte`) y las jornadas ya existentes no se mueven.
 *
 * Una transacción SERIALIZABLE: lee la sucursal, compara, escribe y audita todo junto. Si la hora pedida es la que ya tiene, responde ok SIN escribir ni auditar (`sinCambios`). Dos cambios a la vez, o un cambio a la
 * vez que se abre una sesión (que sella la hora vigente y la valida el disparador `SesionCaja_validar`), se resuelven con el aborto 40001 y el reintento de `conTransaccionSerializable`. La hora se valida acá también
 * (segunda barrera tras el guard; la tercera es el CHECK de la base): fallo cerrado.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint.
 *
 * @contract Le pone a la sucursal la hora de corte pedida («HH:MM», 00:00 a 23:59), junto con su registro de auditoría; si ya la tenía, no escribe nada.
 * @idempotency POR_ESTADO: repetir el pedido (doble clic, reintento tras un corte) encuentra el mismo valor y responde ok sin escribir ni auditar.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento): la lectura, la comparación, el cambio y la auditoría, todo junto.
 * @sideEffects registrarCambioAuditado (Sucursal.horaDeCorte, de la anterior a la nueva). El refresco de la vista lo hace la Server Action.
 * @ficha permiso=renombrar_sucursal transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function cambiarHoraDeCorteDeSucursalCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "transaccion">,
  comando: { sucursalId: string; horaDeCorte: string },
): Promise<ResultadoCambiarHoraDeCorte> {
  const { sucursalId, horaDeCorte } = comando;
  if (!horaDeCorteValida(horaDeCorte)) return fracaso("HORA_DE_CORTE_INVALIDA", "La hora de corte tiene que ser una hora válida con formato HH:MM, de 00:00 a 23:59.");

  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoCambiarHoraDeCorte> => {
    const sucursal = await tx.sucursal.findUnique({ where: { id: sucursalId }, select: { nombre: true, horaDeCorte: true } });
    if (!sucursal) return fracaso("SUCURSAL_NO_ENCONTRADA", textoDe("rechazo.NO_ENCONTRADO", { entidad: ENTIDADES.sucursal }));

    const anterior = horaDeCorteDeColumnaTime(sucursal.horaDeCorte);
    if (anterior === horaDeCorte) return exito(`La hora de corte ya era ${horaDeCorte}.`, { sinCambios: true });

    await cambiarHoraDeCorteDeSucursalEnBase(tx, { sucursalId, horaDeCorte });
    await registrarCambioAuditado(tx, {
      entidad: "Sucursal", entidadId: sucursalId, campo: "horaDeCorte", descripcion: `Sucursal "${sucursal.nombre}": hora de corte`,
      valorAnterior: anterior, valorNuevo: horaDeCorte, actorId: actor.usuarioId, sucursalId: null,
    });
    return exito(`Hora de corte cambiada a ${horaDeCorte}.`, { sinCambios: false });
  });
}
