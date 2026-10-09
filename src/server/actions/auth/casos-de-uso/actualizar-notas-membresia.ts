import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { mensajeSiNoPuedeGestionar } from "@/core/permisos/gestion-de-usuarios";
import { actorDesdeLaBase, objetivoEnSucursal } from "@/server/lecturas/permisos/gestion-de-usuarios";
import { SELECCION_DE_ROL_PARA_JERARQUIA } from "@/core/permisos/jerarquia";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import { texto } from "@/core/texto";
import { cambiarNotasDeMembresia } from "@/server/persistencia/permisos/membresias";

type ResultadoActualizarNotasMembresia = ResultadoCaso<null, "MEMBRESIA_NO_ENCONTRADA" | "TECHO_DE_PRIVILEGIO">;

/**
 * Caso de uso «editar las notas de una membresía» (Hito 3, Fase I, I.5a de `docs/plan-hito-3-pureza.md`). El campo `notas` de la membresía existía en el modelo
 * (se llenaba solo por flujos automáticos de bootstrap) pero no se podía ver ni editar desde la UI — hallazgo de la auditoría de motor2. Editar las notas de un
 * admin o del gerente tiene el mismo techo que tocarlos (G2, D6). Es el cuerpo que antes vivía en línea en la Server Action `actualizarNotasMembresia`
 * (`src/server/actions/auth/usuarios.ts`), movido con las mismas lecturas, el mismo orden y los mismos mensajes. La Server Action quedó como adaptador
 * (`conPermiso("notas_usuario_sucursal")` → este caso de uso → `aResultadoAccion`), sin guard de formato: recibe un id y un texto libre que nunca se validó
 * (`SIN_GUARD`, con su motivo).
 *
 * Orden, igual que antes (desde M18 todo corre DENTRO de la transacción SERIALIZABLE, con el `tx`):
 *  1. «No se encontró esa membresía» si no existe o no es de la sucursal activa de quien actúa.
 *  2. El techo de gestión (`mensajeSiNoPuedeGestionar`): las notas de un admin o del gerente las toca solo quien puede tocarlos. Quien actúa se mide desde la
 *     base (`actorDesdeLaBase`, O35-B de O.35), junto a quien se toca y con el mismo cliente (el `tx`): no con el contexto de la sesión, que pudo quedar viejo.
 *  3. En esa misma transacción: la escritura (`cambiarNotasDeMembresia`, `server/persistencia/permisos/membresias.ts`; el texto recortado, o `null` si queda vacío) y
 *     su fila de auditoría (`UsuarioSucursal.notas`, de las notas anteriores a las nuevas, con la sucursal de la membresía).
 *
 * La auditoría es nueva respecto de la acción original (decisión B4 del dueño, Hito 3: «auditar los cambios de las notas de una membresía», en un commit aparte del
 * movimiento): hasta acá un cambio de notas no dejaba rastro. Como toda fila de `registrarCambioAuditado`, no se escribe si las notas no cambiaron.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint.
 *
 * @contract Deja en la membresía de la sucursal activa las notas pedidas (recortadas; vacías → sin notas) con su registro de auditoría, salvo que quien actúa no pueda gestionar a esa persona.
 * @idempotency No aplica — repetir el pedido vuelve a escribir las mismas notas (sin fila de auditoría nueva: el valor no cambió); no hay documento ni clave que arbitre el reintento.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento; M18 / S-51): las lecturas (membresía, quien se toca y quien actúa), la escritura y la auditoría, todo junto.
 * @sideEffects registrarCambioAuditado (UsuarioSucursal.notas, de las anteriores a las nuevas).
 * @ficha permiso=notas_usuario_sucursal transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarNotasMembresiaCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "empresaId" | "sucursalId" | "sucursalNombre" | "transaccion">,
  comando: { membresiaId: string; notas: string },
): Promise<ResultadoActualizarNotasMembresia> {
  const { membresiaId, notas } = comando;
  const nuevas = texto(notas) || null;
  // M18 (S-51): la membresía, quien se toca, quien actúa (con su rol de HOY), la escritura y la auditoría van en UNA transacción SERIALIZABLE. Antes las lecturas iban con `actor.db`, afuera: si
  // quien actúa perdía el rol o el objetivo pasaba a admin entre la lectura y la escritura, el techo se había medido contra un estado viejo. Ahora Postgres aborta a uno de los dos (40001), el
  // reintento relee y el techo se mide con el estado nuevo. Los rechazos devuelven ANTES de escribir; el cuerpo puede reintentarse: no tiene efectos fuera de la base.
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoActualizarNotasMembresia> => {
    const membresia = await tx.usuarioSucursal.findUnique({ where: { id: membresiaId }, include: { rol: { select: SELECCION_DE_ROL_PARA_JERARQUIA } } });
    if (!membresia || membresia.sucursalId !== actor.sucursalId) return fracaso("MEMBRESIA_NO_ENCONTRADA", "No se encontró esa membresía.");

    const objetivo = await objetivoEnSucursal(tx, actor.empresaId, membresia.usuarioId, membresia.rol);
    const rechazo = mensajeSiNoPuedeGestionar(await actorDesdeLaBase(tx, actor.empresaId, actor.usuarioId, actor.sucursalId), objetivo);
    if (rechazo) return fracaso("TECHO_DE_PRIVILEGIO", rechazo);

    await cambiarNotasDeMembresia(tx, { membresiaId, notas: nuevas });
    const usuario = await tx.user.findUniqueOrThrow({ where: { id: membresia.usuarioId }, select: { email: true } });
    await registrarCambioAuditado(tx, {
      entidad: "UsuarioSucursal", entidadId: membresiaId, campo: "notas", descripcion: `Usuario "${usuario.email}" en la sucursal "${actor.sucursalNombre}": notas`,
      valorAnterior: membresia.notas, valorNuevo: nuevas, actorId: actor.usuarioId, sucursalId: membresia.sucursalId,
    });
    return exito("Notas actualizadas.", null);
  });
}
