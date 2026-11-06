import "server-only";
import { GENERO_E_ITEM_AGRUPADO_VISIBLE, buscarChoqueEntreNombres, whereCartaDeSucursal, wherePromoOfrecidaEn, type ChoqueDeNombre, type NombreUsadoEnLaCarta } from "@/core/carta/public";
import type { Db } from "@/lib/db-tipos";

/**
 * Regla del dueño (2026-11-04): en la carta de una sucursal no puede haber dos cosas con el mismo nombre visible. Esta lectura junta los nombres que YA usa la carta de la sucursal, SIN el producto
 * que se está guardando, y busca si `nombre` coincide con alguno (sin mayúsculas ni tildes, `buscarChoqueEntreNombres`):
 *  - el «Nombre en la carta» de otro plato VISIBLE de la sucursal (lo cuida también el único parcial de la base);
 *  - el nombre del producto de otro plato visible que no tiene nombre en la carta (sale con el interno);
 *  - un ítem agrupado de la sucursal (activo o no, para que apagarlo no deje un choque dormido);
 *  - una promo que se ofrece en la sucursal.
 * NO cuentan los platos ocultos (no están en la carta) ni los productos base (se venden por opción: el cliente lee los rótulos de sus opciones, no el nombre del producto; etapa posterior, declarada en el
 * diseño). Con `soloNombresEnCarta` (un producto base que tiene «Nombre en la carta») solo se compara con los nombres en la carta de los demás platos: lo que cuida el único de la base.
 * El orden de los resultados es fijo (nombres en la carta, internos, agrupados, promos; dentro de cada uno, por nombre) para que el mensaje sea el mismo a quien repite.
 * Se llama DENTRO de la transacción del caso de uso, después de `tomarLosNombresDeLaCarta` (el candado de la sucursal): sin él, dos guardados a la vez podrían pasar los dos.
 */
export async function buscarChoqueDeNombreEnLaCarta(db: Db, args: { sucursalId: string; productoIdPropio: string; nombre: string; soloNombresEnCarta?: boolean }): Promise<ChoqueDeNombre | null> {
  const { sucursalId, productoIdPropio, nombre, soloNombresEnCarta = false } = args;
  const contenidosPromesa = db.contenidoCartaProducto.findMany({
    where: { ...whereCartaDeSucursal(sucursalId), productoId: { not: productoIdPropio }, visibleEnCarta: true, producto: { modoDeVenta: { not: "BASE_CONFIGURABLE" } } },
    select: { nombreEnCarta: true, producto: { select: { nombre: true } } },
  });
  const [contenidos, agrupados, promos] = soloNombresEnCarta
    ? [await contenidosPromesa, [], []]
    : await Promise.all([
        contenidosPromesa,
        // Interruptor de ítem agrupado apagado (`GENERO_E_ITEM_AGRUPADO_VISIBLE`): sus nombres no salen en la carta, así que no ocupan ninguno.
        GENERO_E_ITEM_AGRUPADO_VISIBLE ? db.itemAgrupadoCarta.findMany({ where: whereCartaDeSucursal(sucursalId), select: { nombre: true } }) : Promise.resolve([]),
        db.promoCarta.findMany({ where: wherePromoOfrecidaEn(sucursalId, "salon"), select: { titulo: true } }),
      ]);
  const porNombre = (a: NombreUsadoEnLaCarta, b: NombreUsadoEnLaCarta) => a.nombre.localeCompare(b.nombre, "es");
  const usados: NombreUsadoEnLaCarta[] = [
    ...contenidos.flatMap((c): NombreUsadoEnLaCarta[] => (c.nombreEnCarta !== null ? [{ tipo: "nombre-en-carta", nombre: c.nombreEnCarta, producto: c.producto.nombre }] : [])).sort(porNombre),
    ...(soloNombresEnCarta ? [] : contenidos.flatMap((c): NombreUsadoEnLaCarta[] => (c.nombreEnCarta === null ? [{ tipo: "nombre-del-producto", nombre: c.producto.nombre }] : [])).sort(porNombre)),
    ...agrupados.map((a): NombreUsadoEnLaCarta => ({ tipo: "agrupado", nombre: a.nombre })).sort(porNombre),
    ...promos.map((p): NombreUsadoEnLaCarta => ({ tipo: "promo", nombre: p.titulo })).sort(porNombre),
  ];
  return buscarChoqueEntreNombres(nombre, usados);
}
