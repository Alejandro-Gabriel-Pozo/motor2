import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { actorEnSucursal, mensajeSiNoPuedeGestionar, objetivoEnSucursal } from "@/core/permisos/gestion-de-usuarios";
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
 * Orden, igual que antes (las dos lecturas con `actor.db`, fuera de la transacción):
 *  1. «No se encontró esa membresía» si no existe o no es de la sucursal activa de quien actúa.
 *  2. El techo de gestión (`mensajeSiNoPuedeGestionar`): las notas de un admin o del gerente las toca solo quien puede tocarlos.
 *  3. En UNA transacción: la escritura (`cambiarNotasDeMembresia`, `server/persistencia/permisos/membresias.ts`; el texto recortado, o `null` si queda vacío) y
 *     su fila de auditoría (`UsuarioSucursal.notas`, de las notas anteriores a las nuevas, con la sucursal de la membresía).
 *
 * La auditoría es nueva respecto de la acción original (decisión B4 del dueño, Hito 3: «auditar los cambios de las notas de una membresía», en un commit aparte del
 * movimiento): hasta acá un cambio de notas no dejaba rastro. Como toda fila de `registrarCambioAuditado`, no se escribe si las notas no cambiaron.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint.
 *
 * @contract Deja en la membresía de la sucursal activa las notas pedidas (recortadas; vacías → sin notas) con su registro de auditoría, salvo que quien actúa no pueda gestionar a esa persona.
 * @idempotency No aplica — repetir el pedido vuelve a escribir las mismas notas (sin fila de auditoría nueva: el valor no cambió); no hay documento ni clave que arbitre el reintento.
 * @transaction `actor.transaccion` (READ COMMITTED, la del contexto): escritura y auditoría juntas. Las dos lecturas quedan fuera, como antes.
 * @sideEffects registrarCambioAuditado (UsuarioSucursal.notas, de las anteriores a las nuevas).
 * @ficha permiso=notas_usuario_sucursal transaccion=SIMPLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarNotasMembresiaCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "empresaId" | "sucursalId" | "sucursalNombre" | "rolEmpresa" | "membresias" | "db" | "transaccion">,
  comando: { membresiaId: string; notas: string },
): Promise<ResultadoActualizarNotasMembresia> {
  const { membresiaId, notas } = comando;
  const membresia = await actor.db.usuarioSucursal.findUnique({ where: { id: membresiaId }, include: { rol: { select: SELECCION_DE_ROL_PARA_JERARQUIA } } });
  if (!membresia || membresia.sucursalId !== actor.sucursalId) return fracaso("MEMBRESIA_NO_ENCONTRADA", "No se encontró esa membresía.");

  const objetivo = await objetivoEnSucursal(actor.db, actor.empresaId, membresia.usuarioId, membresia.rol);
  const rechazo = mensajeSiNoPuedeGestionar(actorEnSucursal(actor, actor.sucursalId), objetivo);
  if (rechazo) return fracaso("TECHO_DE_PRIVILEGIO", rechazo);

  const nuevas = texto(notas) || null;
  await actor.transaccion(async (tx) => {
    await cambiarNotasDeMembresia(tx, { membresiaId, notas: nuevas });
    const usuario = await tx.user.findUniqueOrThrow({ where: { id: membresia.usuarioId }, select: { email: true } });
    await registrarCambioAuditado(tx, {
      entidad: "UsuarioSucursal", entidadId: membresiaId, campo: "notas", descripcion: `Usuario "${usuario.email}" en la sucursal "${actor.sucursalNombre}": notas`,
      valorAnterior: membresia.notas, valorNuevo: nuevas, actorId: actor.usuarioId, sucursalId: membresia.sucursalId,
    });
  });
  return exito("Notas actualizadas.", null);
}
