import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras del PRECIO Y LA RECETA POR COMBINACIÓN (GO-3b, ADR-032, frentes A y B; mismo contrato que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas
 * de negocio). Las llaman los casos de uso de `src/server/actions/catalogo/casos-de-uso/`, que deciden la transacción y auditan. Nada se borra: una combinación o una tarifa se desactivan, un precio
 * local se deshabilita y la receta propia agrega versiones (una versión sin ingredientes = «sin excepción»). Las ediciones son OPTIMISTAS: `updateMany … where version = esperada` y devuelven cuántas
 * filas cambiaron (0 = alguien la cambió entre medio).
 */

type Tx = Prisma.TransactionClient;

/** Marca (o desmarca, con `eje: null`) un grupo admitido como eje de las combinaciones del producto; sube la versión de la fila (una edición de lo que admite con la versión vieja queda desactualizada). */
export async function fijarEjeDeGrupoAdmitido(db: Tx, args: { productoId: string; grupoId: string; eje: number | null; ahora: Date }): Promise<void> {
  await db.productoAdmiteGrupo.update({
    where: { productoId_grupoId: { productoId: args.productoId, grupoId: args.grupoId } },
    data: { ejeDeCombinacion: args.eje, version: { increment: 1 }, actualizadoEn: args.ahora },
  });
}

export async function crearCombinacion(
  db: Tx,
  args: { productoId: string; opcionEje1Id: string; opcionEje2Id: string | null; activa: boolean; precio: number | null; grupoDePrecioId: string | null; ahora: Date },
): Promise<{ id: string }> {
  const c = await db.combinacionDeProducto.create({
    data: {
      productoId: args.productoId,
      opcionEje1Id: args.opcionEje1Id,
      opcionEje2Id: args.opcionEje2Id,
      activa: args.activa,
      precio: args.precio,
      grupoDePrecioId: args.grupoDePrecioId,
      creadoEn: args.ahora,
      actualizadoEn: args.ahora,
    },
    select: { id: true },
  });
  return { id: c.id };
}

export async function cambiarCombinacion(
  db: Tx,
  args: { id: string; versionEsperada: number; activa: boolean; precio: number | null; grupoDePrecioId: string | null; ahora: Date },
): Promise<number> {
  const { count } = await db.combinacionDeProducto.updateMany({
    where: { id: args.id, version: args.versionEsperada },
    data: { activa: args.activa, precio: args.precio, grupoDePrecioId: args.grupoDePrecioId, version: { increment: 1 }, actualizadoEn: args.ahora },
  });
  return count;
}

export async function crearGrupoDePrecio(db: Tx, args: { nombre: string; precio: number; ahora: Date }): Promise<{ id: string }> {
  const g = await db.grupoDePrecio.create({ data: { nombre: args.nombre, precio: args.precio, creadoEn: args.ahora, actualizadoEn: args.ahora }, select: { id: true } });
  return { id: g.id };
}

export async function cambiarGrupoDePrecio(db: Tx, args: { id: string; versionEsperada: number; nombre: string; precio: number; activo: boolean; ahora: Date }): Promise<number> {
  const { count } = await db.grupoDePrecio.updateMany({
    where: { id: args.id, version: args.versionEsperada },
    data: { nombre: args.nombre, precio: args.precio, activo: args.activo, version: { increment: 1 }, actualizadoEn: args.ahora },
  });
  return count;
}

/** El precio local de UNA combinación o de UN grupo en la sucursal (la fila se crea la primera vez; la baja es `habilitado = false`, conservando el último precio). */
export async function fijarPrecioLocalDeCombinacion(
  db: Tx,
  args: { sucursalId: string; objetivo: { combinacionId: string } | { grupoDePrecioId: string }; precio: number; habilitado: boolean; ahora: Date },
): Promise<void> {
  const datos = { precio: args.precio, habilitado: args.habilitado, actualizadoEn: args.ahora };
  if ("combinacionId" in args.objetivo) {
    const { combinacionId } = args.objetivo;
    await db.precioLocalDeCombinacion.upsert({ where: { sucursalId_combinacionId: { sucursalId: args.sucursalId, combinacionId } }, create: { sucursalId: args.sucursalId, combinacionId, ...datos }, update: datos });
    return;
  }
  const { grupoDePrecioId } = args.objetivo;
  await db.precioLocalDeCombinacion.upsert({ where: { sucursalId_grupoDePrecioId: { sucursalId: args.sucursalId, grupoDePrecioId } }, create: { sucursalId: args.sucursalId, grupoDePrecioId, ...datos }, update: datos });
}

/** Una versión NUEVA de la receta propia de una combinación, con sus ingredientes (todo solo se agrega). Devuelve su id. */
export async function crearVersionDeRecetaDeCombinacion(
  db: Tx,
  args: { combinacionId: string; numero: number; creadoPorId: string; ahora: Date; ingredientes: readonly { insumoProductoId: string; cantidad: number; unidadId: string; mermaPorcentaje: number }[] },
): Promise<{ id: string }> {
  const v = await db.recetaDeCombinacionVersion.create({ data: { combinacionId: args.combinacionId, numero: args.numero, creadoPorId: args.creadoPorId, creadoEn: args.ahora }, select: { id: true } });
  if (args.ingredientes.length) {
    await db.recetaDeCombinacionIngrediente.createMany({
      data: args.ingredientes.map((i, orden) => ({ versionId: v.id, insumoProductoId: i.insumoProductoId, cantidad: i.cantidad, unidadId: i.unidadId, mermaPorcentaje: i.mermaPorcentaje, orden })),
    });
  }
  return { id: v.id };
}
