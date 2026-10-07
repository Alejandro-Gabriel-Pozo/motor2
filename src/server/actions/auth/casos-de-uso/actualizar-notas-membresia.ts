import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { actorEnSucursal, mensajeSiNoPuedeGestionar, objetivoEnSucursal } from "@/core/permisos/gestion-de-usuarios";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import { texto } from "@/core/texto";
import { cambiarNotasDeMembresia } from "@/server/persistencia/permisos/membresias";

type ResultadoActualizarNotasMembresia = ResultadoCaso<null, "MEMBRESIA_NO_ENCONTRADA" | "TECHO_DE_PRIVILEGIO">;

/**
 * Caso de uso «editar las notas de una membresía» (Hito 3, Fase I, I.5a de `docs/plan-hito-3-pureza.md`). El campo `notas` de la membresía existía en el modelo
 * (se llenaba solo por flujos automáticos de bootstrap) pero no se podía ver ni editar desde la UI — hallazgo de la auditoría de motor2. Editar las notas de un
 * admin o del gerente tiene el mismo techo que tocarlos (G2, D6). Es el cuerpo que antes vivía en línea en la Server Action `actualizarNotasMembresia`
 * (`src/server/actions/auth/usuarios.ts`), movido TAL CUAL: mismas consultas, mismo orden, mismos mensajes. La Server Action quedó como adaptador
 * (`conPermiso("notas_usuario_sucursal")` → este caso de uso → `aResultadoAccion`), sin guard de formato: recibe un id y un texto libre que nunca se validó
 * (`SIN_GUARD`, con su motivo).
 *
 * Orden, igual que antes, todo con `actor.db` y SIN transacción (como hoy: una sola escritura, sin auditoría):
 *  1. «No se encontró esa membresía» si no existe o no es de la sucursal activa de quien actúa.
 *  2. El techo de gestión (`mensajeSiNoPuedeGestionar`): las notas de un admin o del gerente las toca solo quien puede tocarlos.
 *  3. La escritura (`cambiarNotasDeMembresia`, `server/persistencia/permisos/membresias.ts`): el texto recortado, o `null` si queda vacío.
 *
 * Sin auditoría todavía: el dueño aprobó auditarla (decisión B4 del plan) y eso entra en el commit siguiente, aparte, para que el cambio de comportamiento se
 * vea solo. Mientras tanto la ficha dice lo que el código hace (`transaccion=NINGUNA`; `auditoria=DOCUMENTO_PROPIO` es la única alternativa del vocabulario a
 * `REGISTRO_AUDITORIA`, y la membresía no lleva quién la editó: no hay rastro, que es justamente lo que corrige el paso siguiente).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint.
 *
 * @contract Deja en la membresía de la sucursal activa las notas pedidas (recortadas; vacías → sin notas), salvo que quien actúa no pueda gestionar a esa persona.
 * @idempotency No aplica — repetir el pedido vuelve a escribir las mismas notas; no hay documento ni clave que arbitre el reintento.
 * @transaction Ninguna: una sola escritura con `actor.db`, después de las dos lecturas (como antes).
 * @sideEffects Ninguno fuera de la escritura (todavía sin registro de auditoría).
 * @ficha permiso=notas_usuario_sucursal transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarNotasMembresiaCasoDeUso(
  actor: Pick<ContextoUsuario, "empresaId" | "sucursalId" | "rolEmpresa" | "membresias" | "db">,
  comando: { membresiaId: string; notas: string },
): Promise<ResultadoActualizarNotasMembresia> {
  const { membresiaId, notas } = comando;
  const membresia = await actor.db.usuarioSucursal.findUnique({ where: { id: membresiaId }, include: { rol: true } });
  if (!membresia || membresia.sucursalId !== actor.sucursalId) return fracaso("MEMBRESIA_NO_ENCONTRADA", "No se encontró esa membresía.");

  const objetivo = await objetivoEnSucursal(actor.db, actor.empresaId, membresia.usuarioId, membresia.rol);
  const rechazo = mensajeSiNoPuedeGestionar(actorEnSucursal(actor, actor.sucursalId), objetivo);
  if (rechazo) return fracaso("TECHO_DE_PRIVILEGIO", rechazo);

  await cambiarNotasDeMembresia(actor.db, { membresiaId, notas: texto(notas) || null });
  return exito("Notas actualizadas.", null);
}
