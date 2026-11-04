import "server-only";
import { buscarChoqueEntreNombres, whereCartaDeSucursal, wherePromoOfrecidaEn, type ChoqueDeNombre, type NombreUsadoEnLaCarta } from "@/core/carta/public";
import type { Db } from "@/lib/db-tipos";

/**
 * Regla del dueño (2026-11-04): en la carta de una sucursal no puede haber dos cosas con el mismo nombre visible. Esta lectura junta los nombres que YA usa la carta de la sucursal, SIN el producto
 * que se está guardando, y busca si `nombre` coincide con alguno (sin mayúsculas ni tildes, `buscarChoqueEntreNombres`):
 *  - el «Nombre en la carta» de otro plato de la sucursal (visible o no: la base también lo cuida con un único);
 *  - el nombre del producto de otro plato VISIBLE que no tiene nombre en la carta (sale con el interno);
 *  - un ítem agrupado de la sucursal (activo o no, para que apagarlo no deje un choque dormido);
 *  - una promo que se ofrece en la sucursal.
 * El orden de los resultados es fijo (nombres en la carta, internos, agrupados, promos; dentro de cada uno, por nombre) para que el mensaje sea el mismo a quien repite.
 * Se llama DENTRO de la transacción del caso de uso, después de `tomarLosNombresDeLaCarta` (el candado de la sucursal): sin él, dos guardados a la vez podrían pasar los dos.
 */
export async function buscarChoqueDeNombreEnLaCarta(db: Db, args: { sucursalId: string; productoIdPropio: string; nombre: string }): Promise<ChoqueDeNombre | null> {
  const { sucursalId, productoIdPropio, nombre } = args;
  const [contenidos, agrupados, promos] = await Promise.all([
    db.contenidoCartaProducto.findMany({
      where: { ...whereCartaDeSucursal(sucursalId), productoId: { not: productoIdPropio }, OR: [{ nombreEnCarta: { not: null } }, { visibleEnCarta: true }] },
      select: { nombreEnCarta: true, producto: { select: { nombre: true } } },
    }),
    db.itemAgrupadoCarta.findMany({ where: whereCartaDeSucursal(sucursalId), select: { nombre: true } }),
    db.promoCarta.findMany({ where: wherePromoOfrecidaEn(sucursalId, "salon"), select: { titulo: true } }),
  ]);
  const porNombre = (a: NombreUsadoEnLaCarta, b: NombreUsadoEnLaCarta) => a.nombre.localeCompare(b.nombre, "es");
  const usados: NombreUsadoEnLaCarta[] = [
    ...contenidos.flatMap((c): NombreUsadoEnLaCarta[] => (c.nombreEnCarta !== null ? [{ tipo: "nombre-en-carta", nombre: c.nombreEnCarta, producto: c.producto.nombre }] : [])).sort(porNombre),
    ...contenidos.flatMap((c): NombreUsadoEnLaCarta[] => (c.nombreEnCarta === null ? [{ tipo: "nombre-del-producto", nombre: c.producto.nombre }] : [])).sort(porNombre),
    ...agrupados.map((a): NombreUsadoEnLaCarta => ({ tipo: "agrupado", nombre: a.nombre })).sort(porNombre),
    ...promos.map((p): NombreUsadoEnLaCarta => ({ tipo: "promo", nombre: p.titulo })).sort(porNombre),
  ];
  return buscarChoqueEntreNombres(nombre, usados);
}
