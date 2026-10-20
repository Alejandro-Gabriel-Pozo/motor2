import "server-only";
import { whereDisponibleEn } from "@/core/catalogo/public";
import {
  opcionesParaLaCarta,
  organizarCartaParaMantener,
  precioDeCarta,
  presentacionDeUnProductoSolo,
  vistaPreviaDeLaForma,
  vistaPreviaDeOpciones,
  whereCartaDeSucursal,
  wherePromoOfrecidaEn,
  type CartaParaMantener,
  type ProductoParaMantener,
} from "@/core/carta/public";
import { esBaseConfigurable } from "@/core/opciones/public";
import { resumenDePrecios, tablaDePreciosParaLaCarta } from "@/core/pos/public";
import { disponibilidadDeProductos } from "@/server/lecturas/catalogo/disponibilidad";
import { precioLocalActivoEn, preciosLocalesVigentes } from "@/server/lecturas/catalogo/precio-local";
import { preciosLocalesDeOpcionVigentesEnProductos } from "@/server/lecturas/catalogo/precio-local-de-opciones";
import { opcionesDeLosProductosDeLaCarta } from "@/server/lecturas/carta/opciones";
import type { Db } from "@/lib/db-tipos";

/**
 * CARTA-MANT: lo que la pantalla de la carta de la sucursal `sucursalId` necesita para ordenarse (`organizarCartaParaMantener`, pura): las secciones de la empresa y los productos de venta que
 * importan ACÁ —los disponibles en esta sucursal y los que tienen contenido de carta de esta sucursal aunque hoy no estén disponibles («sin stock hoy» no los saca de su sección)—, cada uno con
 * su precio de esta sucursal, si está disponible, si es el ancla de un adicional y si está dentro de un ítem agrupado de esta sucursal. Sin N+1: secciones, productos, disponibilidad y precios
 * locales para todo el lote. Todo lo de la sucursal se filtra por `sucursalId` (y la RLS por sucursal, por debajo). Sin guarda de permiso adentro: la pone la página (`carta_ver`).
 *
 * A los de «Fuera de carta» con opciones de venta les arma la vista previa de «Agregar a la carta» («Va a mostrar …») con las MISMAS lecturas y la MISMA forma que la carta pública
 * (`opcionesDeLosProductosDeLaCarta`, la grilla de tamaños de la sucursal, `tablaDePreciosParaLaCarta` y `presentacionDeUnProductoSolo`; Fase 5, paso 9), sin el descuento de producto (la vista
 * previa dice cómo se va a leer, no el precio final). Lo que la carta no puede leer exacto, como antes (`opcionesParaLaCarta`). No toca la carta pública: la lee igual que ella.
 */
export async function cargarCartaParaMantener(db: Db, sucursalId: string): Promise<CartaParaMantener> {
  const [secciones, productos, precioLocalActivo] = await Promise.all([
    db.seccionCarta.findMany({ select: { id: true, nombre: true, orden: true, activa: true }, orderBy: [{ orden: "asc" }, { nombre: "asc" }] }),
    db.producto.findMany({
      where: { tipo: "PV", OR: [whereDisponibleEn(sucursalId), { contenidosCarta: { some: whereCartaDeSucursal(sucursalId) } }] },
      select: {
        id: true,
        nombre: true,
        precioVenta: true,
        modoDeVenta: true,
        opcionQueRespalda: { select: { id: true } },
        gruposAdmitidos: { where: { activo: true }, select: { id: true }, take: 1 },
        contenidosCarta: { where: whereCartaDeSucursal(sucursalId), take: 1, select: { visibleEnCarta: true, seccionCartaId: true, orden: true } },
        opcionesItemAgrupadoCarta: { where: whereCartaDeSucursal(sucursalId), take: 1, select: { itemAgrupadoCarta: { select: { nombre: true } } } },
      },
      orderBy: { nombre: "asc" },
    }),
    precioLocalActivoEn(sucursalId, db),
  ]);
  const ids = productos.map((p) => p.id);
  const [disponibles, locales] = await Promise.all([disponibilidadDeProductos(sucursalId, ids, db), preciosLocalesVigentes(sucursalId, db, ids, precioLocalActivo)]);
  const paraMantener: ProductoParaMantener[] = productos.map((p) => {
    const c = p.contenidosCarta[0];
    return {
      id: p.id,
      nombre: p.nombre,
      precioAca: precioDeCarta(Number(p.precioVenta), locales.get(p.id)),
      precioDeLista: Number(p.precioVenta),
      conPrecioLocal: locales.get(p.id)?.habilitado === true,
      ...(esBaseConfigurable(p.modoDeVenta) ? { seVendePorOpcion: true } : {}),
      disponibleAca: disponibles.get(p.id) === true,
      esAnclaDeAdicional: p.opcionQueRespalda !== null,
      agrupadoEn: p.opcionesItemAgrupadoCarta[0]?.itemAgrupadoCarta.nombre ?? null,
      contenido: c ? { visibleEnCarta: c.visibleEnCarta, seccionCartaId: c.seccionCartaId, orden: c.orden } : null,
    };
  });
  const carta = organizarCartaParaMantener(secciones, paraMantener);

  // La vista previa, solo para los de «Fuera de carta» (los que se pueden agregar).
  const conGrupos = new Set(productos.filter((p) => p.gruposAdmitidos.length > 0).map((p) => p.id));
  const bases = new Set(productos.filter((p) => esBaseConfigurable(p.modoDeVenta)).map((p) => p.id));
  const fueraConGrupos = carta.fueraDeCarta.filter((p) => conGrupos.has(p.id)).map((p) => p.id);
  const [opciones, grilla] = await Promise.all([
    opcionesDeLosProductosDeLaCarta(db, sucursalId, fueraConGrupos),
    preciosLocalesDeOpcionVigentesEnProductos(sucursalId, db, fueraConGrupos, precioLocalActivo),
  ]);
  for (const p of carta.fueraDeCarta) {
    const leidos = opciones.get(p.id) ?? [];
    const vigentes = leidos.some((g) => g.admitido && g.activo);
    if (!conGrupos.has(p.id) || !vigentes) {
      p.vistaPrevia = vistaPreviaDeOpciones(false, null);
      continue;
    }
    const grupos = leidos.map((g) =>
      g.tipo === "MEDIDA" && g.modoPrecio === "ABSOLUTO" ? { ...g, opciones: g.opciones.map((o) => ({ ...o, precioDeSucursal: grilla.get(`${p.id}|${o.opcionId}`) ?? null })) } : g
    );
    const esBase = bases.has(p.id);
    const enCarta = opcionesParaLaCarta(resumenDePrecios({ grupos, precioBase: p.precioAca, descuentoDeProducto: null, esBase }));
    // Fase 5, paso 9: con la FORMA que le va a dar la carta (la misma proyección del servidor), si la carta lo puede leer exacto; si no (o si hoy no se puede pedir), como antes.
    const tabla = enCarta ? tablaDePreciosParaLaCarta({ grupos, precioBase: p.precioAca, descuentoDeProducto: null, esBase }) : null;
    const forma = tabla ? presentacionDeUnProductoSolo({ tabla, esBase, mostrarNombreArriba: false, conDescuento: false }) : null;
    p.vistaPrevia = forma ? vistaPreviaDeLaForma(p.nombre, forma) : vistaPreviaDeOpciones(true, enCarta);
  }
  return carta;
}

/** Lo que el hub de Parametrización muestra al lado de cada tarjeta (prototipo: «Secciones · 4 · 1 oculta», «Géneros · 5», «Promociones · 3 activas», «Publicada»). */
export interface ResumenDeParametrizacion {
  /** Las secciones de la empresa, en su orden, con su nombre y si se muestran (el hub cuenta cuántas hay y cuántas están ocultas). */
  secciones: { nombre: string; activa: boolean }[];
  generos: number;
  agrupados: number;
  promosActivas: number;
  /** La carta pública de esta sucursal está publicada en el portal (`SucursalPublica.publicada`); `null` si la sucursal no tiene lugar en el portal. */
  publicada: boolean | null;
}

/**
 * CARTA-MANT: los contadores del hub de Parametrización, en cinco consultas chicas. Las secciones son de la empresa (la lista, con nombre y si se muestran: son pocas); los géneros y los agrupados, de la carta de ESTA sucursal (con su
 * filtro); las promos, las ofrecidas acá (activas en la empresa y prendidas en la sucursal). Sin guarda de permiso adentro: la pone la página (`carta_ver`).
 */
export async function resumirParametrizacionDeCarta(db: Db, sucursalId: string): Promise<ResumenDeParametrizacion> {
  const [secciones, generos, agrupados, promosActivas, sucursal] = await Promise.all([
    db.seccionCarta.findMany({ select: { nombre: true, activa: true }, orderBy: [{ orden: "asc" }, { nombre: "asc" }] }),
    db.generoCarta.count({ where: { ...whereCartaDeSucursal(sucursalId), activo: true } }),
    db.itemAgrupadoCarta.count({ where: { ...whereCartaDeSucursal(sucursalId), activo: true } }),
    db.promoCarta.count({ where: wherePromoOfrecidaEn(sucursalId) }),
    db.sucursal.findUnique({ where: { id: sucursalId }, select: { publica: { select: { publicada: true } } } }),
  ]);
  return { secciones, generos, agrupados, promosActivas, publicada: sucursal?.publica ? sucursal.publica.publicada : null };
}
