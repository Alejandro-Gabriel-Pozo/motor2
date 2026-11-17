import "server-only";
import { GENERO_E_ITEM_AGRUPADO_VISIBLE, MODO_DE_ORDEN_POR_DEFECTO, modoVigente, nombreDeCarta, ordenarRenglonesDeSeccion, whereCartaDeSucursal, type ModoDeOrdenDeSeccion } from "@/core/carta/public";
import type { TipoDeRenglonDeCarta } from "@/core/features/carta/orden-de-renglones.schema";
import type { Db } from "@/lib/db-tipos";

/**
 * Lectura del orden de los renglones de una sección de carta en UNA sucursal (etapa O1 de `docs/diseno-carta-orden-permiso-y-precio-de-familia-2026-11-17.md`, niveles 7 y 9). Solo lee; los casos de uso
 * `reordenar-renglones-de-seccion` y `fijar-modo-de-orden-de-seccion` la usan para decidir y la pantalla de gestión para mostrar. Todo lo de la sucursal lleva `whereCartaDeSucursal` (la sucursal sale del contexto
 * del servidor, nunca del frontend) y la RLS por sucursal, por debajo. Sin guarda de permiso adentro: la pone quien la llama.
 */

/** Un renglón de una sección: lo que comparten un producto suelto y un ítem agrupado. `id` es el del producto (`PRODUCTO`) o el del ítem agrupado (`ITEM_AGRUPADO`). */
export interface RenglonDeSeccion {
  tipo: TipoDeRenglonDeCarta;
  id: string;
  /** El nombre con que lo ve el comensal (el de la carta). */
  nombre: string;
  /** El `orden` guardado: es el `ordenVisto` que la pantalla devuelve al reordenar. */
  orden: number;
}

/** Los renglones de la sección en esta sucursal: productos visibles en la carta e ítems agrupados activos, sin ordenar (el orden lo decide el núcleo puro). */
export async function leerRenglonesDeSeccion(db: Db, args: { sucursalId: string; seccionCartaId: string }): Promise<RenglonDeSeccion[]> {
  const [productos, agrupados] = await Promise.all([
    db.contenidoCartaProducto.findMany({
      where: { ...whereCartaDeSucursal(args.sucursalId), seccionCartaId: args.seccionCartaId, visibleEnCarta: true },
      select: { productoId: true, orden: true, nombreEnCarta: true, producto: { select: { nombre: true } } },
    }),
    // Interruptor de ítem agrupado apagado (`GENERO_E_ITEM_AGRUPADO_VISIBLE`): no hay ítems agrupados en la carta, así que no son renglones (como en `menu.ts`).
    !GENERO_E_ITEM_AGRUPADO_VISIBLE
      ? Promise.resolve([])
      : db.itemAgrupadoCarta.findMany({
          where: { ...whereCartaDeSucursal(args.sucursalId), seccionCartaId: args.seccionCartaId, activo: true },
          select: { id: true, nombre: true, orden: true },
        }),
  ]);
  return [
    ...productos.map((p): RenglonDeSeccion => ({ tipo: "PRODUCTO", id: p.productoId, nombre: nombreDeCarta(p.producto, p), orden: p.orden })),
    ...agrupados.map((a): RenglonDeSeccion => ({ tipo: "ITEM_AGRUPADO", id: a.id, nombre: a.nombre, orden: a.orden })),
  ];
}

/** Lo que la pantalla de gestión muestra de una sección: el modo vigente, su versión (0 = sin fila) y los renglones con su `orden` visto, en el orden «a mano» (el que se edita). */
export interface OrdenDeSeccionParaGestionar {
  modo: ModoDeOrdenDeSeccion;
  /** La versión del modo que hay que devolver al fijarlo (0 = no hay fila: va a mano por defecto). */
  version: number;
  renglones: RenglonDeSeccion[];
}

/** La sección vista para ordenar: `null` si no es de la empresa. Los renglones salen en el orden «a mano» (`orden` y después nombre) aunque el modo sea alfabético: es el orden que se conserva y se edita. */
export async function consultarOrdenDeSeccion(db: Db, args: { sucursalId: string; seccionCartaId: string }): Promise<OrdenDeSeccionParaGestionar | null> {
  const seccion = await db.seccionCarta.findUnique({ where: { id: args.seccionCartaId }, select: { id: true } });
  if (!seccion) return null;
  const [fila, renglones] = await Promise.all([
    db.modoDeOrdenDeSeccionCarta.findUnique({
      where: { sucursalId_seccionCartaId: { sucursalId: args.sucursalId, seccionCartaId: args.seccionCartaId } },
      select: { modo: true, version: true },
    }),
    leerRenglonesDeSeccion(db, args),
  ]);
  return {
    modo: fila ? modoVigente(fila.modo) : MODO_DE_ORDEN_POR_DEFECTO,
    version: fila?.version ?? 0,
    renglones: ordenarRenglonesDeSeccion(renglones, MODO_DE_ORDEN_POR_DEFECTO, (r) => r),
  };
}
