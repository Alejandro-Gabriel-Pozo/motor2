import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoActualizarMaxMesasAbiertas, ResultadoActualizarMaxMesasAbiertas } from "@/core/features/mesas/mesas.schema";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { exito } from "@/core/resultado-caso";
import { fijarMaxMesasAbiertas } from "@/server/persistencia/pos/mesas";

/**
 * Caso de uso «fijar el límite de mesas abiertas de la sucursal» (Hito 4 de la pureza, bloque 4.1, paso 4 — `docs/plan-hito-4-pureza.md` §5). Es el cuerpo que
 * antes vivía en línea en la Server Action `actualizarMaxMesasAbiertas` (`src/server/actions/pos/mesas.ts`), con los mismos mensajes y la misma fila de
 * auditoría. La Server Action quedó como adaptador (`conPermiso("pos_limite_mesas_abiertas")` → `guardComandoActualizarMaxMesasAbiertas` → este caso de uso →
 * `aResultadoAccion`). El criterio de negocio (D6: bloqueo en seco; bajarlo no cierra ninguna mesa) está documentado en la Server Action.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (`conPermiso`) ni el formato del límite (el guard).
 *
 * ATÓMICO desde B1 (aprobado por el dueño, Hito 4, 2026-10-08): todo en UNA transacción (`actor.transaccion`, la del contexto, READ COMMITTED), en el mismo
 * orden que antes: 1. la sucursal activa (`findUniqueOrThrow`: si no existiera, lanza); 2. la fila de auditoría (entidad «Sucursal», campo «maxMesasAbiertas»,
 * del límite anterior al nuevo; no se escribe si no cambió); 3. el cambio (`fijarMaxMesasAbiertas`, server/persistencia/pos/mesas.ts). Antes iban con
 * `actor.db` y sin transacción: si el cambio fallaba quedaba la fila de auditoría de un cambio que no ocurrió. Ahora, si cualquiera de las dos escrituras
 * falla, no queda ninguna (lo fija `test/pos/limite-mesas-auditoria-atomica.test.ts`). El orden observable de la auditoría no cambia (una sola fila).
 *
 * @contract Deja en la sucursal activa el límite de mesas abiertas pedido (`null` = sin límite), con su registro de auditoría si cambió: los dos o ninguno.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo límite (sin fila de auditoría nueva: el valor no cambió).
 * @transaction `actor.transaccion` (READ COMMITTED): la lectura de la sucursal, la auditoría y el cambio juntos (B1).
 * @sideEffects registrarCambioAuditado (Sucursal.maxMesasAbiertas, del anterior al nuevo), en la misma transacción que el cambio.
 * @ficha permiso=pos_limite_mesas_abiertas transaccion=SIMPLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarMaxMesasAbiertasCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "sucursalId" | "transaccion">,
  comando: ComandoActualizarMaxMesasAbiertas,
): Promise<ResultadoActualizarMaxMesasAbiertas> {
  const { limite } = comando;
  const sucursal = await actor.transaccion(async (tx) => {
    const sucursal = await tx.sucursal.findUniqueOrThrow({ where: { id: actor.sucursalId } });
    await registrarCambioAuditado(tx, {
      entidad: "Sucursal",
      entidadId: sucursal.id,
      descripcion: `Sucursal "${sucursal.nombre}": límite de mesas abiertas`,
      campo: "maxMesasAbiertas",
      valorAnterior: sucursal.maxMesasAbiertas,
      valorNuevo: limite,
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });
    await fijarMaxMesasAbiertas(tx, { sucursalId: sucursal.id, maxMesasAbiertas: limite });
    return sucursal;
  });
  return exito(limite === null ? `Sin límite de mesas abiertas en «${sucursal.nombre}».` : `Máximo de mesas abiertas en «${sucursal.nombre}»: ${limite}.`, null);
}
