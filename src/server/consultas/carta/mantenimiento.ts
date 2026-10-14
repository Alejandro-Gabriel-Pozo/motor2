import "server-only";
import { whereDisponibleEn } from "@/core/catalogo/public";
import { organizarCartaParaMantener, precioDeCarta, whereCartaDeSucursal, type CartaParaMantener, type ProductoParaMantener } from "@/core/carta/public";
import { disponibilidadDeProductos } from "@/server/lecturas/catalogo/disponibilidad";
import { preciosLocalesVigentes } from "@/server/lecturas/catalogo/precio-local";
import type { Db } from "@/lib/db-tipos";

/**
 * CARTA-MANT: lo que la pantalla de la carta de la sucursal `sucursalId` necesita para ordenarse (`organizarCartaParaMantener`, pura): las secciones de la empresa y los productos de venta que
 * importan ACÁ —los disponibles en esta sucursal y los que tienen contenido de carta de esta sucursal aunque hoy no estén disponibles («sin stock hoy» no los saca de su sección)—, cada uno con
 * su precio de esta sucursal, si está disponible, si es el ancla de un adicional y si está dentro de un ítem agrupado de esta sucursal. Cuatro consultas para todo el lote (secciones, productos,
 * disponibilidad y precios locales), sin N+1. Todo lo de la sucursal se filtra por `sucursalId` (y la RLS por sucursal, por debajo). Sin guarda de permiso adentro: la pone la página (`carta_ver`).
 */
export async function cargarCartaParaMantener(db: Db, sucursalId: string): Promise<CartaParaMantener> {
  const [secciones, productos] = await Promise.all([
    db.seccionCarta.findMany({ select: { id: true, nombre: true, orden: true, activa: true }, orderBy: [{ orden: "asc" }, { nombre: "asc" }] }),
    db.producto.findMany({
      where: { tipo: "PV", OR: [whereDisponibleEn(sucursalId), { contenidosCarta: { some: whereCartaDeSucursal(sucursalId) } }] },
      select: {
        id: true,
        nombre: true,
        precioVenta: true,
        opcionQueRespalda: { select: { id: true } },
        contenidosCarta: { where: whereCartaDeSucursal(sucursalId), take: 1, select: { visibleEnCarta: true, seccionCartaId: true, orden: true } },
        opcionesItemAgrupadoCarta: { where: whereCartaDeSucursal(sucursalId), take: 1, select: { itemAgrupadoCarta: { select: { nombre: true } } } },
      },
      orderBy: { nombre: "asc" },
    }),
  ]);
  const ids = productos.map((p) => p.id);
  const [disponibles, locales] = await Promise.all([disponibilidadDeProductos(sucursalId, ids, db), preciosLocalesVigentes(sucursalId, db, ids)]);
  const paraMantener: ProductoParaMantener[] = productos.map((p) => {
    const c = p.contenidosCarta[0];
    return {
      id: p.id,
      nombre: p.nombre,
      precioAca: precioDeCarta(Number(p.precioVenta), locales.get(p.id)),
      disponibleAca: disponibles.get(p.id) === true,
      esAnclaDeAdicional: p.opcionQueRespalda !== null,
      agrupadoEn: p.opcionesItemAgrupadoCarta[0]?.itemAgrupadoCarta.nombre ?? null,
      contenido: c ? { visibleEnCarta: c.visibleEnCarta, seccionCartaId: c.seccionCartaId, orden: c.orden } : null,
    };
  });
  return organizarCartaParaMantener(secciones, paraMantener);
}
