import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoActualizarMaxMesasAbiertas, ResultadoActualizarMaxMesasAbiertas } from "@/core/features/mesas/mesas.schema";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { exito } from "@/core/resultado-caso";
import { fijarMaxMesasAbiertas } from "@/server/persistencia/pos/mesas";

/**
 * Caso de uso «fijar el límite de mesas abiertas de la sucursal» (Hito 4 de la pureza, bloque 4.1, paso 4 — `docs/plan-hito-4-pureza.md` §5). Es el cuerpo que
 * antes vivía en línea en la Server Action `actualizarMaxMesasAbiertas` (`src/server/actions/pos/mesas.ts`), movido TAL CUAL: las mismas consultas, en el
 * mismo orden, con la base del contexto (`actor.db`) y SIN transacción, y los mismos mensajes. La Server Action quedó como adaptador
 * (`conPermiso("pos_limite_mesas_abiertas")` → `guardComandoActualizarMaxMesasAbiertas` → este caso de uso → `aResultadoAccion`). El criterio de negocio (D6:
 * bloqueo en seco; bajarlo no cierra ninguna mesa) está documentado en la Server Action.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (`conPermiso`) ni el formato del límite (el guard).
 *
 * Orden, igual que antes: 1. la sucursal activa (`findUniqueOrThrow`: si no existiera, lanza); 2. la fila de auditoría (entidad «Sucursal», campo
 * «maxMesasAbiertas», del límite anterior al nuevo; no se escribe si no cambió); 3. el cambio (`fijarMaxMesasAbiertas`, server/persistencia/pos/mesas.ts).
 * NO ES ATÓMICO, como no lo era: auditoría y cambio van con `actor.db`, sin transacción, y la auditoría ANTES del cambio (si el cambio fallara, quedaría la fila
 * de auditoría sin el cambio). Hacerlo atómico es el paso B1 aprobado por el dueño, en un commit propio (no en esta mudanza).
 *
 * @contract Deja en la sucursal activa el límite de mesas abiertas pedido (`null` = sin límite), con su registro de auditoría si cambió.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo límite (sin fila de auditoría nueva: el valor no cambió).
 * @transaction Ninguna — auditoría y cambio con `actor.db`, en ese orden y no atómicos (B1 los junta en una transacción, aparte).
 * @sideEffects registrarCambioAuditado (Sucursal.maxMesasAbiertas, del anterior al nuevo).
 * @ficha permiso=pos_limite_mesas_abiertas transaccion=NINGUNA idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarMaxMesasAbiertasCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "sucursalId" | "db">,
  comando: ComandoActualizarMaxMesasAbiertas,
): Promise<ResultadoActualizarMaxMesasAbiertas> {
  const { limite } = comando;
  const sucursal = await actor.db.sucursal.findUniqueOrThrow({ where: { id: actor.sucursalId } });
  await registrarCambioAuditado(actor.db, {
    entidad: "Sucursal",
    entidadId: sucursal.id,
    descripcion: `Sucursal "${sucursal.nombre}": límite de mesas abiertas`,
    campo: "maxMesasAbiertas",
    valorAnterior: sucursal.maxMesasAbiertas,
    valorNuevo: limite,
    actorId: actor.usuarioId,
    sucursalId: actor.sucursalId,
  });
  await fijarMaxMesasAbiertas(actor.db, { sucursalId: sucursal.id, maxMesasAbiertas: limite });
  return exito(limite === null ? `Sin límite de mesas abiertas en «${sucursal.nombre}».` : `Máximo de mesas abiertas en «${sucursal.nombre}»: ${limite}.`, null);
}
