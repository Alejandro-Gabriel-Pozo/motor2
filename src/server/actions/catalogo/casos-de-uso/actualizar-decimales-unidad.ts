import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { decimalesDelPaso } from "@/core/catalogo/public";
import type { ComandoActualizarDecimalesUnidad, ResultadoActualizarDecimalesUnidad } from "@/core/features/catalogo/unidades.schema";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { exito, fracaso } from "@/core/resultado-caso";
import { fijarDecimalesDeUnidad } from "@/server/persistencia/catalogo/unidades";

/**
 * Caso de uso «cambiar los decimales de una unidad de medida» (Hito 4 de la pureza, bloque 4.3, paso H4C-8 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que
 * antes vivía en línea en la Server Action `actualizarDecimalesUnidad` (`src/server/actions/catalogo/unidades.ts`), movido TAL CUAL:
 *
 * Transición peligrosa (b) de R3 (Task #25, docs/plan-venta-fraccionada-2026-09-26.md — ver el docstring de `pasoVenta` en prisma/schema.prisma): bajar los
 * decimales de una Unidad no puede dejar a un producto "Se produce" (stock real) con un `pasoVenta` que ya no entra en esos decimales — se rechaza, nombrando el
 * primero que rompería (mismo criterio que `dependenciasParaDesactivar`, "avisa qué es"). Los productos y la unidad se leen con la base del contexto FUERA de la
 * transacción, en ese orden; el cambio y su fila de auditoría (solo si los decimales cambiaron) van en UNA transacción (Pureza 0.7): los decimales fijan la
 * precisión de toda cantidad que use esta unidad. La Server Action quedó como adaptador (`conPermisoDeEmpresa("unidades")` →
 * `guardComandoActualizarDecimalesUnidad` → este caso de uso → `refrescarVistaSiHaceFalta` si salió bien → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el rango de los decimales (el guard).
 *
 * @contract Deja los decimales pedidos en la unidad, con su fila de auditoría si cambiaron: los dos o ninguno. Rechaza si un producto «Se produce» quedaría con un paso de venta que no entra.
 * @idempotency No aplica — repetir el pedido vuelve a escribir los mismos decimales (sin fila de auditoría nueva: no cambió nada).
 * @transaction `actor.transaccion` (READ COMMITTED): el cambio y su auditoría juntos; los productos y la unidad se leen antes con `actor.db`.
 * @sideEffects registrarCambioAuditado (Unidad.decimales, del anterior al nuevo), en la misma transacción. El refresco de la vista lo hace la Server Action.
 * @ficha permiso=unidades transaccion=SIMPLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarDecimalesUnidadCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "usuarioId">,
  comando: ComandoActualizarDecimalesUnidad,
): Promise<ResultadoActualizarDecimalesUnidad> {
  const { unidadId, decimales } = comando;
  const productosConStockReal = await actor.db.producto.findMany({
    where: { unidadStockId: unidadId, tipo: "PV", seProduce: true, pasoVenta: { not: null } },
    select: { nombre: true, pasoVenta: true },
  });
  const inconsistente = productosConStockReal.find((p) => decimalesDelPaso(Number(p.pasoVenta)) > decimales);
  if (inconsistente) {
    return fracaso(
      "PASO_DE_VENTA_INCOMPATIBLE",
      `No se puede bajar a ${decimales} decimal(es): "${inconsistente.nombre}" "se produce" (tiene stock propio) y su paso de venta ` +
        `(${Number(inconsistente.pasoVenta)}) necesita más precisión — cambiale el paso de venta, desmarcá "Se produce", o dale una unidad propia.`
    );
  }

  const unidad = await actor.db.unidad.findUnique({ where: { id: unidadId }, select: { nombre: true, decimales: true } });
  if (!unidad) return fracaso("UNIDAD_NO_ENCONTRADA", "No se encontró la unidad.");
  // El cambio y su rastro van en UNA transacción (Pureza 0.7): los decimales fijan la precisión de toda cantidad que use esta unidad.
  await actor.transaccion(async (tx) => {
    await fijarDecimalesDeUnidad(tx, { id: unidadId, decimales });
    if (unidad.decimales !== decimales) {
      await registrarCambioAuditado(tx, {
        entidad: "Unidad",
        entidadId: unidadId,
        campo: "decimales",
        descripcion: `Unidad "${unidad.nombre}": decimales`,
        valorAnterior: unidad.decimales,
        valorNuevo: decimales,
        actorId: actor.usuarioId,
      });
    }
  });
  return exito("Decimales actualizados.", null);
}
