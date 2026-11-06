import { prisma, sembrarProductoDisponible } from "../setup/test-db";
import { sembrarSalon } from "../pos/salon-fixture";

/**
 * La carta sembrada del oráculo (`genero-e-item-agrupado.oraculo.ts`), con nombres y precios reales del dueño. Siempre: sección «Bebidas» (Café $4.000, Capuccino $8.000, Cerveza Patagonia $14.000, los tres con
 * contenido visible; la Cerveza Huinganco $14.000, SIN contenido) y sección «Postres» (Brownie $10.000). Con `conDatos`: el género «Agua» en el Café, el ítem agrupado «Cerveza» (las dos cervezas, mismo precio)
 * con el género «Huinganco», y el género «Agua saborizada» sin productos.
 */
export async function sembrarCartaConGeneros(conDatos: boolean) {
  const salon = await sembrarSalon();
  const { sucursalId, unidad } = salon;
  let n = 0;
  const pv = async (nombre: string, precioVenta: number) => (await sembrarProductoDisponible({ codigo: `PV_GEN_${++n}`, nombre, tipo: "PV", unidadStockId: unidad.id, precioVenta }, sucursalId)).id;
  const ids = {
    cafe: await pv("Café", 4000),
    capuccino: await pv("Capuccino", 8000),
    patagonia: await pv("Cerveza Patagonia", 14000),
    huinganco: await pv("Cerveza Huinganco", 14000),
    brownie: await pv("Brownie", 10000),
  };
  const bebidas = await prisma.seccionCarta.create({ data: { nombre: "Bebidas", orden: 1 } });
  const postres = await prisma.seccionCarta.create({ data: { nombre: "Postres", orden: 2 } });
  const generos = conDatos
    ? {
        agua: (await prisma.generoCarta.create({ data: { sucursalId, nombre: "Agua", orden: 1 } })).id,
        saborizada: (await prisma.generoCarta.create({ data: { sucursalId, nombre: "Agua saborizada", orden: 2 } })).id,
        huinganco: (await prisma.generoCarta.create({ data: { sucursalId, nombre: "Huinganco", orden: 3 } })).id,
      }
    : null;
  await prisma.contenidoCartaProducto.createMany({
    data: [
      { sucursalId, productoId: ids.cafe, visibleEnCarta: true, seccionCartaId: bebidas.id, orden: 1, generoCartaId: generos?.agua ?? null },
      { sucursalId, productoId: ids.capuccino, visibleEnCarta: true, seccionCartaId: bebidas.id, orden: 2 },
      { sucursalId, productoId: ids.patagonia, visibleEnCarta: true, seccionCartaId: bebidas.id, orden: 3 },
      { sucursalId, productoId: ids.brownie, visibleEnCarta: true, seccionCartaId: postres.id, orden: 1 },
    ],
  });
  let agrupadoId: string | null = null;
  let opcionPatagoniaId: string | null = null;
  if (generos) {
    agrupadoId = (await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre: "Cerveza", seccionCartaId: bebidas.id, orden: 4, generoCartaId: generos.huinganco } })).id;
    opcionPatagoniaId = (await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId, itemAgrupadoCartaId: agrupadoId, productoId: ids.patagonia, orden: 1 } })).id;
    await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId, itemAgrupadoCartaId: agrupadoId, productoId: ids.huinganco, orden: 2 } });
  }
  return { ...salon, ids, bebidas: bebidas.id, postres: postres.id, generos, agrupadoId, opcionPatagoniaId };
}

/** Todo lo que guardan las tres tablas de la estructura y el género de cada producto: para comprobar que una acción rechazada no cambió NADA. */
export async function fotoDeLaEstructura() {
  const [generos, agrupados, opciones, contenidos, precios] = await Promise.all([
    prisma.generoCarta.findMany({ orderBy: { id: "asc" } }),
    prisma.itemAgrupadoCarta.findMany({ orderBy: { id: "asc" } }),
    prisma.opcionItemAgrupadoCarta.findMany({ orderBy: { id: "asc" } }),
    prisma.contenidoCartaProducto.findMany({ orderBy: { id: "asc" } }),
    prisma.producto.findMany({ select: { id: true, precioVenta: true }, orderBy: { id: "asc" } }),
  ]);
  return JSON.stringify({ generos, agrupados, opciones, contenidos, precios });
}
