import type { Prisma, PrismaClient } from "@prisma/client";
import { precioLocalActivoEn, preciosLocalesVigentes, whereDisponibleEn } from "@/core/catalogo/public-servidor";
import { aplicarDescuentoDeProducto, precioDeCarta, precioDePromo, seleccionDeSucursalDePromo, wherePromoOfrecidaEn, whereCartaDeSucursal } from "@/core/carta/public";
import { descuentosDeProductoEnSucursal, resolverMenuCarta } from "@/core/carta/public-servidor";
import { tieneStockReal } from "@/core/movimientos/public";
import { armarSelectorCartaPos, type GenerosSelectorCartaPos, type ProductoPedible, type PromoSelectorCartaPos, type SelectorCartaPos } from "./selector-carta";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Capa de LECTURA del selector por sección de carta del POS (docs/plan-selector-carta-pos-2026-09-25.md) y por carpeta de género
 * (docs/plan-genero-carta-2026-09-26.md) — separada de `selector-carta.ts` (puro) por el mismo motivo que `menu-consulta.ts`.
 * Solo lee. Vive en `core/pos` y no en `core/carta`: es una necesidad del salón que REUSA la carta sin tocarla (mismo criterio
 * que `grupo-producto-consulta.ts`).
 *
 *  - La estructura: la carta pública de la sucursal, tal cual (`resolverMenuCarta`). Sucursal inactiva → `null` → todo a «Fuera de
 *    carta».
 *  - Los pedibles: los PV disponibles en la sucursal (`whereDisponibleEn`, el mismo filtro que el buscador del POS y que valida
 *    `agregarItems`), con el precio que se congelaría al agregarlos: Precio Local habilitado o, si no, el global (`precioDeCarta`,
 *    paridad con `resolverPrecioVenta`, fijada por test/pos/selector-carta-consulta.test.ts).
 *  - Los géneros: los ACTIVOS (uno apagado no forma carpeta: lo que tenía ese género sale suelto, sin error), con el género de
 *    cada `ContenidoCartaProducto` y de cada `ItemAgrupadoCarta` — SOLO interno del POS (G4): la carta pública (`resolverMenuCarta`
 *    / `CartaV1`) no lee `generoCartaId` en absoluto.
 *  - Las promos ARMABLES (Task #16, docs/plan-promo-combo-2026-09-26.md): las `PromoCarta` ofrecidas en la sucursal (activas en la empresa
 *    Y prendidas en esta sucursal, con su precio local si lo tienen) que tengan
 *    al menos un cupo (una promo informativa, sin cupos, se ignora acá — sigue siendo solo visual en la carta pública), con
 *    sus cupos tal cual (`PromoCartaCupo`); `armarSelectorCartaPos` resuelve los elegibles de cada cupo con los MISMOS
 *    pedibles que ya ubicó en la sección de ese cupo (D5) — esta consulta no busca elegibles por su cuenta.
 *
 * La pantalla de la mesa la llama DESPUÉS de su guarda de Ver de `pos_mesas` (el mozo no tiene el permiso `carta`): no hace falta
 * ninguna Server Action nueva.
 */
export async function cargarSelectorCartaPos(sucursalId: string, db: Db): Promise<SelectorCartaPos> {
  const [carta, productos, preciosLocales, descuentos, precioLocalActivo, generosActivos, contenidosConGenero, agrupadosConGenero, promosCarta] = await Promise.all([
    resolverMenuCarta(sucursalId, db),
    db.producto.findMany({
      where: { tipo: "PV", ...whereDisponibleEn(sucursalId) },
      select: { id: true, codigo: true, nombre: true, precioVenta: true, pasoVenta: true, seProduce: true, unidadStock: { select: { decimales: true } } },
    }),
    preciosLocalesVigentes(sucursalId, db),
    descuentosDeProductoEnSucursal(sucursalId, db),
    precioLocalActivoEn(sucursalId, db),
    db.generoCarta.findMany({ where: { activo: true, ...whereCartaDeSucursal(sucursalId) }, select: { id: true, nombre: true, orden: true } }),
    db.contenidoCartaProducto.findMany({ where: { generoCartaId: { not: null }, ...whereCartaDeSucursal(sucursalId) }, select: { productoId: true, generoCartaId: true } }),
    db.itemAgrupadoCarta.findMany({ where: { generoCartaId: { not: null }, ...whereCartaDeSucursal(sucursalId) }, select: { id: true, generoCartaId: true } }),
    db.promoCarta.findMany({
      where: { ...wherePromoOfrecidaEn(sucursalId), cupos: { some: {} } },
      select: {
        id: true,
        seccionCartaId: true,
        titulo: true,
        precio: true,
        sucursales: seleccionDeSucursalDePromo(sucursalId),
        cupos: {
          orderBy: { orden: "asc" },
          select: { seccionCartaId: true, cantidadMinima: true, cantidadMaxima: true, seccionCarta: { select: { nombre: true } } },
        },
      },
    }),
  ]);
  const localPorProducto = preciosLocales;
  const pedibles: ProductoPedible[] = productos.map((p) => {
    // Producto con descuento (Fase 2): el precio del pedible es el DESCONTADO (el que se congela al agregar); el de lista queda aparte para mostrarlo tachado.
    const aplicado = aplicarDescuentoDeProducto(precioDeCarta(Number(p.precioVenta), localPorProducto.get(p.id)), descuentos.get(p.id) ?? null);
    return {
      productoId: p.id,
      codigo: p.codigo,
      nombre: p.nombre,
      precio: aplicado.precio,
      ...(aplicado.precioLista !== null ? { precioLista: aplicado.precioLista } : {}),
      decimales: p.unidadStock.decimales,
      pasoVenta: p.pasoVenta !== null ? Number(p.pasoVenta) : null,
      tieneStockReal: tieneStockReal("PV", p.seProduce),
    };
  });
  const generos: GenerosSelectorCartaPos = {
    generos: generosActivos,
    generoPorProducto: new Map(contenidosConGenero.map((c) => [c.productoId, c.generoCartaId!])),
    generoPorAgrupado: new Map(agrupadosConGenero.map((a) => [a.id, a.generoCartaId!])),
  };
  const promos: PromoSelectorCartaPos[] = promosCarta.map((p) => ({
    promoCartaId: p.id,
    seccionCartaId: p.seccionCartaId,
    titulo: p.titulo,
    precio: precioDePromo(p.precio, p.sucursales[0], precioLocalActivo),
    cupos: p.cupos.map((c) => ({
      seccionCartaId: c.seccionCartaId,
      nombreSeccion: c.seccionCarta.nombre,
      cantidadMinima: c.cantidadMinima,
      cantidadMaximaCupo: c.cantidadMaxima,
    })),
  }));
  return armarSelectorCartaPos(carta, pedibles, generos, promos);
}
