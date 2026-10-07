"use server";

import { whereDisponibleEn } from "@/core/catalogo/public";
import { cargarOfertasDeProveedores } from "@/server/lecturas/catalogo/ofertas-de-proveedor";
import { requerirVer, requerirVerDeEmpresa } from "../con-sesion";

export interface ProductoDeProveedor {
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  unidadCompraId: string;
  unidadCompraNombre: string;
  unidadStockNombre: string;
  referenciaProveedor: string | null;
  ultimoPrecioPorUnidadStock: number;
  ultimaCompra: Date;
  /** De dónde sale el precio: lo último que compró ESTA sucursal a este proveedor, o (si nunca le compró este producto) lo último que compró la empresa —otra sucursal—. La pantalla lo rotula. */
  origenDelPrecio: "SUCURSAL" | "EMPRESA";
}

/**
 * Productos ya comprados a este proveedor, más recientes primero — para precargar el carrito de una Compra sin buscar de nuevo lo que ya se le compra siempre a este proveedor
 * (mismo dato que `obtenerProductosDeProveedor`, Catalogo.js:3901, del proyecto viejo).
 *
 * Sale del Kardex VIGENTE (`cargarOfertasDeProveedores`), no de la tabla `ProveedorPorProducto`: una compra anulada o de un proveedor corregido ya no aparece ni da precio. Los productos
 * son los que la EMPRESA le compró a este proveedor y están disponibles en esta sucursal; el PRECIO es el de la última compra de ESTA sucursal y, si esta sucursal nunca le compró ese
 * producto, el de la última de la empresa (otra sucursal), marcado con `origenDelPrecio: "EMPRESA"` para que la pantalla lo diga (decisión del dueño, 2026-10-07).
 */
export async function listarProductosDeProveedor(proveedorId: string): Promise<ProductoDeProveedor[]> {
  const ctx = await requerirVer("proceso_compra");
  const [deLaEmpresa, deLaSucursal] = await Promise.all([
    cargarOfertasDeProveedores(ctx.db, { proveedorId }),
    cargarOfertasDeProveedores(ctx.db, { proveedorId, sucursalId: ctx.sucursalId }),
  ]);
  if (deLaEmpresa.length === 0) return [];
  const propias = new Map(deLaSucursal.map((o) => [o.productoId, o]));
  const productos = new Map(
    (
      await ctx.db.producto.findMany({
        where: { id: { in: deLaEmpresa.map((o) => o.productoId) }, ...whereDisponibleEn(ctx.sucursalId) },
        include: { unidadStock: true },
      })
    ).map((p) => [p.id, p])
  );

  return deLaEmpresa
    .filter((o) => productos.has(o.productoId))
    .map((o) => {
      const producto = productos.get(o.productoId)!;
      const propia = propias.get(o.productoId);
      const elegida = propia ?? o;
      return {
        productoId: o.productoId,
        productoCodigo: producto.codigo,
        productoNombre: producto.nombre,
        unidadCompraId: o.unidadCompraId,
        unidadCompraNombre: o.unidadCompraNombre,
        unidadStockNombre: producto.unidadStock.nombre,
        referenciaProveedor: o.referenciaProveedor,
        ultimoPrecioPorUnidadStock: elegida.precioPorUnidadStock,
        ultimaCompra: elegida.ultimaCompra,
        origenDelPrecio: propia ? ("SUCURSAL" as const) : ("EMPRESA" as const),
      };
    })
    .sort((a, b) => b.ultimaCompra.getTime() - a.ultimaCompra.getTime() || a.productoNombre.localeCompare(b.productoNombre));
}

interface OfertaComparativa {
  proveedorNombre: string;
  precioPorUnidadStock: number;
  unidadCompraNombre: string;
  ultimaCompra: Date;
}

export interface FilaComparativaPrecios {
  insumo: string;
  grupo: string | null;
  masBarato: OfertaComparativa | null;
  todas: OfertaComparativa[];
}

/**
 * Equivalente de generarComparativaPreciosPorFamilia_ (Catalogo.js:3528-
 * 3562). Una oferta con precio 0 (proveedor conocido, nunca se cargó
 * precio real) NUNCA puede ganar el ranking de "más barato" — bugfix
 * documentado en el propio código (Catalogo.js:3545-3552).
 */
export async function obtenerComparativaPreciosPorInsumo(): Promise<FilaComparativaPrecios[]> {
  const ctx = await requerirVerDeEmpresa("comparar_precios");
  // Del Kardex vigente (como el costo de reposición): una compra anulada o de un proveedor corregido ya no cuenta. La empresa entera (la comparativa es de la empresa, decisión del dueño, 2026-10-07).
  const ofertasDelKardex = await cargarOfertasDeProveedores(ctx.db);
  if (ofertasDelKardex.length === 0) return [];
  const [productos, proveedores] = await Promise.all([
    ctx.db.producto.findMany({
      where: { id: { in: Array.from(new Set(ofertasDelKardex.map((o) => o.productoId))) } },
      select: { id: true, insumo: { select: { id: true, nombre: true, grupo: { select: { nombre: true } } } } },
    }),
    ctx.db.proveedor.findMany({ where: { id: { in: Array.from(new Set(ofertasDelKardex.map((o) => o.proveedorId))) } }, select: { id: true, nombre: true } }),
  ]);
  const insumoDe = new Map(productos.map((p) => [p.id, p.insumo]));
  const nombreDe = new Map(proveedores.map((p) => [p.id, p.nombre]));

  const porInsumo = new Map<string, { insumo: string; grupo: string | null; ofertas: OfertaComparativa[] }>();
  for (const oferta of ofertasDelKardex) {
    const insumo = insumoDe.get(oferta.productoId);
    if (!insumo) continue; // sin Insumo, no entra a la comparativa (Catalogo.js:3536)

    const entrada = porInsumo.get(insumo.id) ?? { insumo: insumo.nombre, grupo: insumo.grupo?.nombre ?? null, ofertas: [] };
    entrada.ofertas.push({
      proveedorNombre: nombreDe.get(oferta.proveedorId) ?? "",
      precioPorUnidadStock: oferta.precioPorUnidadStock,
      unidadCompraNombre: oferta.unidadCompraNombre,
      ultimaCompra: oferta.ultimaCompra,
    });
    porInsumo.set(insumo.id, entrada);
  }

  const resultado: FilaComparativaPrecios[] = Array.from(porInsumo.values()).map((entrada) => {
    const conPrecio = entrada.ofertas.filter((o) => o.precioPorUnidadStock > 0).sort((a, b) => a.precioPorUnidadStock - b.precioPorUnidadStock);
    const sinPrecio = entrada.ofertas.filter((o) => o.precioPorUnidadStock <= 0);
    return {
      insumo: entrada.insumo,
      grupo: entrada.grupo,
      masBarato: conPrecio[0] ?? null,
      todas: [...conPrecio, ...sinPrecio],
    };
  });

  resultado.sort((a, b) => (a.grupo ?? "").localeCompare(b.grupo ?? "") || a.insumo.localeCompare(b.insumo));
  return resultado;
}
