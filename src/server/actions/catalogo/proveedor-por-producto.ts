"use server";

import { cargarOfertasDeProveedores, cargarProductosDeProveedorParaElCarrito, type ProductoDeProveedor } from "@/server/lecturas/catalogo/ofertas-de-proveedor";
import { requerirVer, requerirVerDeEmpresa } from "../con-sesion";

/**
 * Productos ya comprados a este proveedor, más recientes primero — para precargar el carrito de una Compra sin buscar de nuevo lo que ya se le compra siempre a este proveedor
 * (mismo dato que `obtenerProductosDeProveedor`, Catalogo.js:3901, del proyecto viejo). Del Kardex VIGENTE, con el precio de ESTA sucursal o, si nunca le compró ese producto, el
 * de la empresa (rotulado): la regla está en `cargarProductosDeProveedorParaElCarrito` (`server/lecturas/catalogo/ofertas-de-proveedor.ts`), adonde se mudó la composición en el
 * Hito 4 (paso A2, sin cambiar nada) para poder contar sus consultas. Esta acción solo exige el permiso y pasa la base y la sucursal del contexto.
 */
export async function listarProductosDeProveedor(proveedorId: string): Promise<ProductoDeProveedor[]> {
  const ctx = await requerirVer("proceso_compra");
  return cargarProductosDeProveedorParaElCarrito(ctx.db, proveedorId, ctx.sucursalId);
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
