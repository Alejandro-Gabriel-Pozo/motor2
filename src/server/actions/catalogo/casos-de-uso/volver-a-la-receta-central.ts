import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { describirVueltaALaRecetaCentral } from "@/core/catalogo/public";
import type { ComandoVolverALaRecetaCentral, ResultadoVolverALaRecetaCentral } from "@/core/features/catalogo/receta-sucursal.schema";
import { conTransaccionSerializable, esConflictoDeEscritura } from "@/core/movimientos/public-servidor";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { exito, fracaso } from "@/core/resultado-caso";
import { deshabilitarRecetaPropia } from "@/server/persistencia/catalogo/receta-sucursal";

/**
 * Caso de uso «volver a la receta central» en la sucursal activa (ADR-009, R3/R4; Hito 4 de la pureza, bloque 4.2, paso H4C-6 — `docs/plan-hito-4-pureza.md` §3).
 * Es el cuerpo que antes vivía en línea en la Server Action `volverALaRecetaCentral` (`src/server/actions/catalogo/receta-sucursal.ts`), movido TAL CUAL: dentro
 * de UNA transacción SERIALIZABLE con reintento, la fila de la receta propia del par (sucursal activa, producto) —tiene que estar habilitada—, el nombre del
 * producto (para la descripción), la deshabilitación (sin borrar nada: sus versiones quedan como historial) y su fila de auditoría; el `.catch` del conflicto
 * agotado, que antes estaba en la acción, vive acá con el mismo mensaje. La Server Action quedó como adaptador (`conPermiso("receta_sucursal_volver_central")` →
 * `guardComandoVolverALaRecetaCentral` (la confirmación) → este caso de uso → `refrescarVistaSiHaceFalta` si salió bien → `aResultadoAccion`). Antes el refresco
 * iba dentro del callback de la transacción, antes del ok: ahora lo hace la acción después de confirmar.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni la confirmación (el guard). Nunca recibe la sucursal: siempre la del actor.
 *
 * @contract Deja deshabilitada la receta propia del producto en la sucursal activa (vuelve a regir la central), con su registro de auditoría: los dos o ninguno.
 * @idempotency Por estado — si la propia ya no está habilitada, se rechaza («no tiene receta propia habilitada») sin escribir.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento); agotados los reintentos, el conflicto vuelve como «La receta cambió mientras la mirabas; recargá e intentá de nuevo.».
 * @sideEffects registrarCambioAuditado (RecetaSucursal.habilitada, de true a false, `entidadId` sucursal:producto), en la misma transacción. El refresco de la
 *   vista lo hace la Server Action.
 * @ficha permiso=receta_sucursal_volver_central transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function volverALaRecetaCentralCasoDeUso(
  actor: Pick<ContextoUsuario, "transaccion" | "usuarioId" | "sucursalId" | "sucursalNombre">,
  comando: ComandoVolverALaRecetaCentral,
): Promise<ResultadoVolverALaRecetaCentral> {
  const { productoId } = comando;
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoVolverALaRecetaCentral> => {
    const fila = await tx.recetaSucursal.findUnique({ where: { sucursalId_productoId: { sucursalId: actor.sucursalId, productoId } }, select: { id: true, habilitada: true } });
    if (!fila?.habilitada) return fracaso("SIN_RECETA_PROPIA", "Esta sucursal no tiene receta propia habilitada para este producto.");
    const producto = await tx.producto.findUnique({ where: { id: productoId }, select: { nombre: true } });
    await deshabilitarRecetaPropia(tx, { id: fila.id });
    await registrarCambioAuditado(tx, {
      entidad: "RecetaSucursal",
      entidadId: `${actor.sucursalId}:${productoId}`,
      campo: "habilitada",
      descripcion: describirVueltaALaRecetaCentral(producto?.nombre ?? productoId, actor.sucursalNombre),
      valorAnterior: true,
      valorNuevo: false,
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });
    return exito(`«${actor.sucursalNombre}» vuelve a usar la receta central. La receta propia queda en el historial.`, null);
  }).catch((e): ResultadoVolverALaRecetaCentral => {
    if (esConflictoDeEscritura(e)) return fracaso("RECETA_CAMBIADA", "La receta cambió mientras la mirabas; recargá e intentá de nuevo.");
    throw e;
  });
}
