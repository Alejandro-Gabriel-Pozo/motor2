"use server";

import { prisma } from "@/lib/db";
import { whereDisponibleEn } from "@/core/catalogo/public-servidor";
import { requerirVer } from "../con-sesion";

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
}

/**
 * Productos ya comprados a este proveedor, más recientes primero — hueco
 * real encontrado auditando UX (docs/comparativa-ux-erpnext-dolibarr.md
 * no lo cubre, viene de un pedido directo): `ProveedorPorProducto` ya se
 * actualiza en cada Compra (ver el hookup en movimientos.ts) pero hasta
 * ahora nada la leía — la relación se guardaba y nunca se usaba. Mismo
 * dato que `obtenerProductosDeProveedor` (Catalogo.js:3901) del proyecto
 * viejo, para precargar el carrito de una Compra sin buscar de nuevo lo
 * que ya se le compra siempre a este proveedor.
 */
export async function listarProductosDeProveedor(proveedorId: string): Promise<ProductoDeProveedor[]> {
  const ctx = await requerirVer("proceso_compra");
  const filas = await prisma.proveedorPorProducto.findMany({
    where: { proveedorId, producto: whereDisponibleEn(ctx.sucursalId) },
    include: { producto: { include: { unidadStock: true } }, unidadCompra: true },
    orderBy: { ultimaCompra: "desc" },
  });

  return filas.map((f) => ({
    productoId: f.productoId,
    productoCodigo: f.producto.codigo,
    productoNombre: f.producto.nombre,
    unidadCompraId: f.unidadCompraId,
    unidadCompraNombre: f.unidadCompra.nombre,
    unidadStockNombre: f.producto.unidadStock.nombre,
    referenciaProveedor: f.referenciaProveedor,
    ultimoPrecioPorUnidadStock: Number(f.precioPorUnidadStock),
    ultimaCompra: f.ultimaCompra,
  }));
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
  await requerirVer("comparar_precios");
  const filas = await prisma.proveedorPorProducto.findMany({
    include: {
      proveedor: true,
      unidadCompra: true,
      producto: { include: { insumo: { include: { grupo: true } } } },
    },
  });

  const porInsumo = new Map<string, { insumo: string; grupo: string | null; ofertas: OfertaComparativa[] }>();
  for (const fila of filas) {
    const insumo = fila.producto.insumo;
    if (!insumo) continue; // sin Insumo, no entra a la comparativa (Catalogo.js:3536)

    const entrada = porInsumo.get(insumo.id) ?? { insumo: insumo.nombre, grupo: insumo.grupo?.nombre ?? null, ofertas: [] };
    entrada.ofertas.push({
      proveedorNombre: fila.proveedor.nombre,
      precioPorUnidadStock: Number(fila.precioPorUnidadStock),
      unidadCompraNombre: fila.unidadCompra.nombre,
      ultimaCompra: fila.ultimaCompra,
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
