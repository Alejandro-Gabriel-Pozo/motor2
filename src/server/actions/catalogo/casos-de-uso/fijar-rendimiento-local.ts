import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { ALCANCE_CENTRAL, describirCalibracion } from "@/core/catalogo/public";
import type { ComandoFijarRendimientoLocal, ResultadoFijarRendimientoLocal } from "@/core/features/catalogo/rendimiento-local.schema";
import { conTransaccionSerializable, esConflictoDeEscritura } from "@/core/movimientos/public-servidor";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { exito, fracaso } from "@/core/resultado-caso";
import { cargarRecetaVigente } from "@/server/lecturas/catalogo/recetas-vigentes";
import { fijarRendimientoLocalDeLinea } from "@/server/persistencia/catalogo/rendimiento-local";

const INCLUDE_LINEA = {
  recetaVersion: { include: { producto: { select: { nombre: true } } } },
  insumoProducto: { select: { nombre: true } },
  unidad: { select: { nombre: true } },
} as const;

/**
 * Caso de uso «calibrar el rendimiento (cantidad y/o merma) de UNA línea de receta EN LA SUCURSAL ACTIVA» (D4 de docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md;
 * Hito 4 de la pureza, bloque 4.2, paso H4C-5 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action `fijarRendimientoLocal`
 * (`src/server/actions/catalogo/rendimiento-local.ts`), movido TAL CUAL: todo dentro de UNA transacción SERIALIZABLE con reintento (la línea, que siga siendo de
 * la versión VIGENTE de su receta, la calibración anterior, la escritura y sus dos filas de auditoría), y el `.catch` del conflicto de escritura agotado (que
 * antes estaba en la acción) acá, con el mismo mensaje que el choque de versión (precedente: `guardarPermisos`, Hito 3, I.3). La Server Action quedó como
 * adaptador (`conPermiso("calibrar_rendimiento_local")` → `guardComandoFijarRendimientoLocal` → este caso de uso → `refrescarVistaSiHaceFalta` si salió bien →
 * `aResultadoAccion`). Antes el refresco iba dentro del callback de la transacción, antes de devolver el ok: ahora lo hace la acción después de confirmar.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato (el guard). Escribe siempre en `actor.sucursalId`, nunca en la
 * sucursal que declare el origen.
 *
 * DECISIÓN DEL DUEÑO (D4): "cantidad" es SIEMPRE el estimado NETO ya congelado (mismo criterio que hoy escribe la receta), y `origen` (si viene de una sugerencia)
 * trae la merma EFECTIVA que se usó para calcularlo — las dos se guardan juntas ("la merma se congela junto con la cantidad").
 *
 * @contract Deja la calibración pedida en la línea vigente de la receta, en la sucursal activa, con una fila de auditoría por campo que cambió: todo o nada.
 * @idempotency Optimista — la línea tiene que seguir siendo de la versión vigente (si la receta cambió mientras se miraba el reporte, se rechaza); repetir los mismos valores no deja filas de auditoría nuevas.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento); agotados los reintentos, el conflicto vuelve como «La receta cambió mientras mirabas el reporte; recargá.».
 * @sideEffects registrarCambioAuditado (RendimientoLocalIngrediente.cantidad y .mermaPorcentaje, clave estable sucursal:producto:insumo), en la misma transacción.
 *   El refresco de la vista lo hace la Server Action.
 * @ficha permiso=calibrar_rendimiento_local transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function fijarRendimientoLocalCasoDeUso(
  actor: Pick<ContextoUsuario, "transaccion" | "usuarioId" | "sucursalId" | "sucursalNombre">,
  comando: ComandoFijarRendimientoLocal,
): Promise<ResultadoFijarRendimientoLocal> {
  const { recetaIngredienteId, origen } = comando;
  const valores = { cantidad: comando.cantidad, mermaPorcentaje: comando.mermaPorcentaje };
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoFijarRendimientoLocal> => {
    const ing = await tx.recetaIngrediente.findUnique({ where: { id: recetaIngredienteId }, include: INCLUDE_LINEA });
    if (!ing) return fracaso("LINEA_NO_ENCONTRADA", "No se encontró esa línea de receta.");

    const vigente = await cargarRecetaVigente(tx, ALCANCE_CENTRAL, ing.recetaVersion.productoId, { select: { id: true } });
    if (!vigente || vigente.id !== ing.recetaVersionId) {
      return fracaso("RECETA_CAMBIADA", "La receta cambió mientras mirabas el reporte; recargá.");
    }

    const existente = await tx.rendimientoLocalIngrediente.findUnique({
      where: { recetaIngredienteId_sucursalId: { recetaIngredienteId, sucursalId: actor.sucursalId } },
    });
    await fijarRendimientoLocalDeLinea(tx, { recetaIngredienteId, sucursalId: actor.sucursalId, cantidad: valores.cantidad, mermaPorcentaje: valores.mermaPorcentaje });

    // Auditoría (D6(a)): clave ESTABLE (no el id de la fila, que cambia con el arrastre entre versiones) — dos
    // registros, uno por campo, cada uno no-op si ese campo puntual no cambió.
    const entidadId = `${actor.sucursalId}:${ing.recetaVersion.productoId}:${ing.insumoProductoId}`;
    const central = { cantidad: Number(ing.cantidad), mermaPorcentaje: Number(ing.mermaPorcentaje), unidadNombre: ing.unidad.nombre };
    const args = { productoNombre: ing.recetaVersion.producto.nombre, insumoNombre: ing.insumoProducto.nombre, sucursalNombre: actor.sucursalNombre, central, origen, guardado: valores };

    await registrarCambioAuditado(tx, {
      entidad: "RendimientoLocalIngrediente", entidadId, campo: "cantidad",
      descripcion: describirCalibracion({ ...args, campo: "cantidad" }),
      valorAnterior: existente?.cantidad !== null && existente?.cantidad !== undefined ? Number(existente.cantidad) : null,
      valorNuevo: valores.cantidad,
      actorId: actor.usuarioId, sucursalId: actor.sucursalId,
    });
    await registrarCambioAuditado(tx, {
      entidad: "RendimientoLocalIngrediente", entidadId, campo: "mermaPorcentaje",
      descripcion: describirCalibracion({ ...args, campo: "mermaPorcentaje" }),
      valorAnterior: existente?.mermaPorcentaje !== null && existente?.mermaPorcentaje !== undefined ? Number(existente.mermaPorcentaje) : null,
      valorNuevo: valores.mermaPorcentaje,
      actorId: actor.usuarioId, sucursalId: actor.sucursalId,
    });

    return exito(`Rendimiento de "${ing.insumoProducto.nombre}" en "${ing.recetaVersion.producto.nombre}" calibrado para «${actor.sucursalNombre}».`, null);
  }).catch((e): ResultadoFijarRendimientoLocal => {
    // conTransaccionSerializable ya reintenta un conflicto de escritura (esConflictoDeEscritura) — esto solo cubre el
    // caso de agotar los reintentos, con el mismo mensaje de negocio que el choque de versión de más arriba.
    if (esConflictoDeEscritura(e)) return fracaso("RECETA_CAMBIADA", "La receta cambió mientras mirabas el reporte; recargá.");
    throw e;
  });
}
