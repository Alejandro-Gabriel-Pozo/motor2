"use server";

import { describirVueltaALaRecetaCentral } from "@/core/catalogo/public";
import { INCLUDE_RECETA_COMPLETA, mapCabeceraAInput, mapIngredientesAInput, mapPasosAInput, type RecetaCompleta } from "@/core/catalogo/public-servidor";
import { ALCANCE_CENTRAL } from "@/core/catalogo/public";
import { cargarRecetaVigente } from "@/server/lecturas/catalogo/recetas-vigentes";
import { type IngredienteInput, type PasoInput } from "@/core/catalogo/public";
import { obtenerEstadoDeRecetaPropia } from "@/server/lecturas/catalogo/receta-propia";
import { guardComandoGuardarVersionDeReceta } from "@/core/features/catalogo/receta-version.guard";
import { conTransaccionSerializable, esConflictoDeEscritura } from "@/core/movimientos/public-servidor";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { aResultadoAccion } from "@/core/resultado-caso";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";
import { guardarVersionDeRecetaCasoDeUso, type DestinoDeVersionDeReceta } from "./casos-de-uso/guardar-version-de-receta";

/**
 * Receta PROPIA de la sucursal activa (ADR-009, familia override, R3/R4): una serie de versiones de la receta de un producto que
 * pertenece a UNA sucursal y que, mientras está habilitada, es la receta que rige ahí (venta, consumo, costeo, reportes de esa sucursal) en
 * lugar de la central. Nunca recibe la sucursal por parámetro — siempre la de la sesión (`ctx.sucursalId`) — y cada acción tiene SU
 * permiso (una clave por acción): `receta_sucursal_editar`, `receta_sucursal_copiar`, `receta_sucursal_volver_central`.
 *
 * Nada de acá toca la receta central ni la aplica sola: la central sigue siendo de `guardar_receta` (`recetas.ts`), y cuando cambia solo se
 * AVISA («la central cambió», `obtenerEstadoDeRecetaPropia`). Volver a la central deshabilita la propia sin borrar nada: sus versiones quedan
 * como historial. Las calibraciones por sucursal (`RendimientoLocalIngrediente`) se conservan pero no rigen mientras haya receta propia.
 *
 * El editor de la propia cubre los ingredientes (agregar, editar, quitar); los pasos y la ficha técnica viajan tal cual estaban en la receta
 * de la que se partió.
 */

type OpcionesDeDestino = Omit<Extract<DestinoDeVersionDeReceta, { sucursalId: string }>, "sucursalId">;

async function guardarEnLaPropia(
  ctx: ContextoUsuario,
  productoId: string,
  items: IngredienteInput[],
  base: RecetaCompleta,
  opciones: OpcionesDeDestino & { pasos?: PasoInput[] } = {}
): Promise<ResultadoAccion> {
  const { pasos, ...destino } = opciones;
  const comando = guardComandoGuardarVersionDeReceta({ productoId, items, pasos: pasos ?? mapPasosAInput(base), cabecera: mapCabeceraAInput(base) });
  if (!comando.ok) return error(comando.mensaje);
  const resultado = await guardarVersionDeRecetaCasoDeUso(ctx, comando.valor, { sucursalId: ctx.sucursalId, ...destino });
  if (resultado.ok) refrescarVistaSiHaceFalta();
  return aResultadoAccion(resultado);
}

/** Crea la receta propia de la sucursal partiendo de la central vigente (una copia que de acá en más se edita por su lado). */
export async function crearRecetaPropiaDesdeLaCentral(productoId: string): Promise<ResultadoAccion> {
  return conPermiso("receta_sucursal_editar", async (ctx) => {
    const estado = await obtenerEstadoDeRecetaPropia(productoId, ctx.sucursalId, ctx.db);
    if (estado.habilitada) return error("Esta sucursal ya tiene receta propia para este producto.");
    const central = await cargarRecetaVigente(ctx.db, ALCANCE_CENTRAL, productoId, { include: INCLUDE_RECETA_COMPLETA });
    if (!central) return error("Este producto no tiene receta central de la que partir: agregá el primer ingrediente para armar la receta de la sucursal desde cero.");
    return guardarEnLaPropia(ctx, productoId, mapIngredientesAInput(central), central, { basadaEnVersionId: central.id });
  });
}

/**
 * Agrega un ingrediente a la receta propia habilitada. Si la sucursal todavía no tiene una y el producto tampoco tiene receta central, la
 * crea desde cero con ese ingrediente; si hay central, hay que crear la propia desde ella primero (no se parte de una receta vacía por descuido).
 */
export async function agregarIngredienteARecetaPropia(productoId: string, ingrediente: IngredienteInput): Promise<ResultadoAccion> {
  return conPermiso("receta_sucursal_editar", async (ctx) => {
    const estado = await obtenerEstadoDeRecetaPropia(productoId, ctx.sucursalId, ctx.db);
    if (!estado.habilitada && estado.centralVigente) return error("Primero creá la receta propia de la sucursal a partir de la central.");
    const base = estado.habilitada ? estado.propia : null;
    const existentes = mapIngredientesAInput(base);
    if (existentes.some((i) => i.insumoProductoId === ingrediente.insumoProductoId)) return error("Ese insumo ya está en la receta.");
    return guardarEnLaPropia(ctx, productoId, [...existentes, ingrediente], base);
  });
}

/** Edita cantidad/unidad/merma de un ingrediente de la receta propia habilitada. */
export async function actualizarIngredienteDeRecetaPropia(
  productoId: string,
  insumoProductoId: string,
  cambios: { cantidad: number; unidadId: string; mermaPorcentaje?: number }
): Promise<ResultadoAccion> {
  return conPermiso("receta_sucursal_editar", async (ctx) => {
    const estado = await obtenerEstadoDeRecetaPropia(productoId, ctx.sucursalId, ctx.db);
    if (!estado.habilitada) return error("Esta sucursal no tiene receta propia para este producto.");
    const existentes = mapIngredientesAInput(estado.propia);
    if (!existentes.some((i) => i.insumoProductoId === insumoProductoId)) return error("Ese insumo no está en la receta propia vigente.");
    const items = existentes.map((i) => (i.insumoProductoId === insumoProductoId ? { ...i, cantidad: cambios.cantidad, unidadId: cambios.unidadId, mermaPorcentaje: cambios.mermaPorcentaje ?? 0 } : i));
    return guardarEnLaPropia(ctx, productoId, items, estado.propia);
  });
}

/** Quita un ingrediente de la receta propia habilitada (y lo saca de los pasos que lo mencionaran, como en la central). */
export async function quitarIngredienteDeRecetaPropia(productoId: string, insumoProductoId: string): Promise<ResultadoAccion> {
  return conPermiso("receta_sucursal_editar", async (ctx) => {
    const estado = await obtenerEstadoDeRecetaPropia(productoId, ctx.sucursalId, ctx.db);
    if (!estado.habilitada) return error("Esta sucursal no tiene receta propia para este producto.");
    const existentes = mapIngredientesAInput(estado.propia);
    const items = existentes.filter((i) => i.insumoProductoId !== insumoProductoId);
    if (items.length === existentes.length) return error("Ese insumo no está en la receta propia vigente.");
    // validarPasos rechaza un paso que referencie un ingrediente que ya no está: el round-trip de los pasos lo saca de ahí.
    const pasos = mapPasosAInput(estado.propia).map((p) => ({ ...p, insumoProductoIds: p.insumoProductoIds?.filter((id) => id !== insumoProductoId) }));
    return guardarEnLaPropia(ctx, productoId, items, estado.propia, { pasos });
  });
}

/**
 * Copia la receta propia de OTRA sucursal a la de la activa (que queda habilitada con esa copia como versión nueva). Solo se copia de la receta
 * propia habilitada de otra sucursal — nunca de la central, que ya es la base de la propia — y pisa la propia que hubiera: por eso exige la
 * confirmación explícita. Conserva la versión central en la que se basaba el original, así el aviso «la central cambió» sigue siendo cierto.
 */
export async function copiarRecetaPropiaDeOtraSucursal(productoId: string, sucursalOrigenId: string, confirmado: boolean): Promise<ResultadoAccion> {
  return conPermiso("receta_sucursal_copiar", async (ctx) => {
    if (!confirmado) return error("Confirmá que querés reemplazar la receta de esta sucursal por la copia.");
    if (sucursalOrigenId === ctx.sucursalId) return error("Elegí otra sucursal: no se puede copiar de la misma.");
    const origen = await ctx.db.sucursal.findUnique({ where: { id: sucursalOrigenId }, select: { nombre: true } });
    if (!origen) return error("No se encontró esa sucursal.");
    const estadoOrigen = await obtenerEstadoDeRecetaPropia(productoId, sucursalOrigenId, ctx.db);
    if (!estadoOrigen.habilitada || !estadoOrigen.propia) return error(`«${origen.nombre}» no tiene receta propia para este producto: no hay nada que copiar.`);
    return guardarEnLaPropia(ctx, productoId, mapIngredientesAInput(estadoOrigen.propia), estadoOrigen.propia, {
      basadaEnVersionId: estadoOrigen.propia.basadaEnVersionId,
      copiadaDeSucursal: origen.nombre,
    });
  });
}

/** Vuelve a la receta central: deshabilita la propia (sus versiones quedan como historial, no se borra nada). Pide confirmación explícita. */
export async function volverALaRecetaCentral(productoId: string, confirmado: boolean): Promise<ResultadoAccion> {
  return conPermiso("receta_sucursal_volver_central", async (ctx) => {
    if (!confirmado) return error("Confirmá que querés volver a la receta central.");
    return conTransaccionSerializable(ctx.transaccion, async (tx) => {
      const fila = await tx.recetaSucursal.findUnique({ where: { sucursalId_productoId: { sucursalId: ctx.sucursalId, productoId } }, select: { id: true, habilitada: true } });
      if (!fila?.habilitada) return error("Esta sucursal no tiene receta propia habilitada para este producto.");
      const producto = await tx.producto.findUnique({ where: { id: productoId }, select: { nombre: true } });
      await tx.recetaSucursal.update({ where: { id: fila.id }, data: { habilitada: false } });
      await registrarCambioAuditado(tx, {
        entidad: "RecetaSucursal",
        entidadId: `${ctx.sucursalId}:${productoId}`,
        campo: "habilitada",
        descripcion: describirVueltaALaRecetaCentral(producto?.nombre ?? productoId, ctx.sucursalNombre),
        valorAnterior: true,
        valorNuevo: false,
        actorId: ctx.usuarioId,
        sucursalId: ctx.sucursalId,
      });
      refrescarVistaSiHaceFalta();
      return ok(`«${ctx.sucursalNombre}» vuelve a usar la receta central. La receta propia queda en el historial.`);
    }).catch((e) => {
      if (esConflictoDeEscritura(e)) return error("La receta cambió mientras la mirabas; recargá e intentá de nuevo.");
      throw e;
    });
  });
}
