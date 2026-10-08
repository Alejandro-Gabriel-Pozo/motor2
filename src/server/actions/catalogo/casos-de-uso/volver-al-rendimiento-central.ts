import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { ALCANCE_CENTRAL, describirVueltaAlCentral } from "@/core/catalogo/public";
import type { ComandoVolverAlRendimientoCentral, ResultadoVolverAlRendimientoCentral } from "@/core/features/catalogo/rendimiento-local.schema";
import { esConflictoDeEscritura } from "@/core/movimientos/public-servidor";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { exito, fracaso } from "@/core/resultado-caso";
import { cargarRecetaVigente } from "@/server/lecturas/catalogo/recetas-vigentes";
import { volverRendimientoLocalAlCentral } from "@/server/persistencia/catalogo/rendimiento-local";

const INCLUDE_LINEA = {
  recetaVersion: { include: { producto: { select: { nombre: true } } } },
  insumoProducto: { select: { nombre: true } },
  unidad: { select: { nombre: true } },
} as const;

/**
 * Caso de uso «volver al valor central» de UNA línea de receta en la sucursal activa (D4 de docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md; Hito 4 de la
 * pureza, bloque 4.2, paso H4C-5 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action `volverAlRendimientoCentral`
 * (`src/server/actions/catalogo/rendimiento-local.ts`), movido TAL CUAL: dentro de UNA transacción SERIALIZABLE con reintento, la línea, que siga siendo de la
 * versión vigente, la calibración actual y, si había una, los dos campos en `null` (sin borrar la fila) con sus dos filas de auditoría; el `.catch` del conflicto
 * agotado vive acá, con el mismo mensaje. La Server Action quedó como adaptador (`conPermiso("calibrar_rendimiento_local")` → este caso de uso →
 * `refrescarVistaSiHaceFalta` SOLO si `datos.huboCambio` → `aResultadoAccion`): si la línea ya usaba el valor central, no se escribe nada y, como antes, no se
 * refresca.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (sin guard: solo recibe el id de la línea).
 *
 * @contract Deja la línea en la sucursal activa usando el valor central (cantidad y merma en `null`), con una fila de auditoría por campo que tenía valor: todo o nada.
 * @idempotency Optimista — la línea tiene que seguir siendo de la versión vigente; repetirlo cuando ya usa el central no escribe (`huboCambio: false`).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento); agotados los reintentos, el conflicto vuelve como «La receta cambió mientras mirabas el reporte; recargá.».
 * @sideEffects registrarCambioAuditado (RendimientoLocalIngrediente.cantidad y .mermaPorcentaje, a `null`), en la misma transacción. El refresco de la vista lo
 *   hace la Server Action cuando hubo cambio.
 * @ficha permiso=calibrar_rendimiento_local transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function volverAlRendimientoCentralCasoDeUso(
  actor: Pick<ContextoUsuario, "transaccion" | "usuarioId" | "sucursalId" | "sucursalNombre">,
  comando: ComandoVolverAlRendimientoCentral,
): Promise<ResultadoVolverAlRendimientoCentral> {
  const { recetaIngredienteId } = comando;
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoVolverAlRendimientoCentral> => {
    const ing = await tx.recetaIngrediente.findUnique({ where: { id: recetaIngredienteId }, include: INCLUDE_LINEA });
    if (!ing) return fracaso("LINEA_NO_ENCONTRADA", "No se encontró esa línea de receta.");

    const vigente = await cargarRecetaVigente(tx, ALCANCE_CENTRAL, ing.recetaVersion.productoId, { select: { id: true } });
    if (!vigente || vigente.id !== ing.recetaVersionId) {
      return fracaso("RECETA_CAMBIADA", "La receta cambió mientras mirabas el reporte; recargá.");
    }

    const existente = await tx.rendimientoLocalIngrediente.findUnique({
      where: { recetaIngredienteId_sucursalId: { recetaIngredienteId, sucursalId: actor.sucursalId } },
    });
    if (!existente || (existente.cantidad === null && existente.mermaPorcentaje === null)) {
      return exito(`"${ing.insumoProducto.nombre}" en "${ing.recetaVersion.producto.nombre}" ya usa el valor central en «${actor.sucursalNombre}».`, { huboCambio: false });
    }

    await volverRendimientoLocalAlCentral(tx, { recetaIngredienteId, sucursalId: actor.sucursalId });

    const entidadId = `${actor.sucursalId}:${ing.recetaVersion.productoId}:${ing.insumoProductoId}`;
    const descripcion = describirVueltaAlCentral({ productoNombre: ing.recetaVersion.producto.nombre, insumoNombre: ing.insumoProducto.nombre, sucursalNombre: actor.sucursalNombre });
    await registrarCambioAuditado(tx, {
      entidad: "RendimientoLocalIngrediente", entidadId, campo: "cantidad", descripcion,
      valorAnterior: existente.cantidad !== null ? Number(existente.cantidad) : null, valorNuevo: null,
      actorId: actor.usuarioId, sucursalId: actor.sucursalId,
    });
    await registrarCambioAuditado(tx, {
      entidad: "RendimientoLocalIngrediente", entidadId, campo: "mermaPorcentaje", descripcion,
      valorAnterior: existente.mermaPorcentaje !== null ? Number(existente.mermaPorcentaje) : null, valorNuevo: null,
      actorId: actor.usuarioId, sucursalId: actor.sucursalId,
    });

    return exito(`"${ing.insumoProducto.nombre}" en "${ing.recetaVersion.producto.nombre}" vuelve a usar el valor central en «${actor.sucursalNombre}».`, { huboCambio: true });
  }).catch((e): ResultadoVolverAlRendimientoCentral => {
    if (esConflictoDeEscritura(e)) return fracaso("RECETA_CAMBIADA", "La receta cambió mientras mirabas el reporte; recargá.");
    throw e;
  });
}
