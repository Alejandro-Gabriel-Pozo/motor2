import { escaparComodinesLike } from "@/core/texto";

/**
 * La búsqueda de un producto por texto como `where` de Prisma (Fase 7, Catálogo, mejora M2; diseño `docs/diseno-modulo-catalogo-2026-10-28.md` I9): PURO (objetos planos, sin base), como
 * `disponibilidad-producto-consulta.ts`. La usan la lista de Productos (`whereDeLosProductos`) y el buscador de producto (`buscarProductosSelector`), así que las dos buscan igual.
 *
 * Siempre busca por nombre y código, sin distinguir mayúsculas y con `%` y `_` como letras (no comodines). Con `porReferenciaDelProveedor`, además por cómo lo llama ALGÚN proveedor en su factura
 * (`ProveedorPorProducto.referenciaProveedor`): así el operario que escribe lo que dice la factura («ojo de bife rioplatense») encuentra el producto del sistema («Ojo de bife»). Quién puede buscar así lo
 * decide el servidor (`puedeBuscarPorReferenciaDelProveedor`): el que no ve ese dato en ninguna pantalla busca solo por nombre y código, porque un filtro por algo que no se ve revelaría justo eso.
 *
 * `termino` llega ya limpio (`textoDeBusqueda`) y no vacío. Sin tipos de Prisma, para que este archivo no arrastre el cliente de base (`mode` va `as const`: Prisma pide el literal).
 */
export function whereBusquedaDeProducto(termino: string, porReferenciaDelProveedor: boolean) {
  const contiene = { contains: escaparComodinesLike(termino), mode: "insensitive" as const };
  return {
    OR: [
      { nombre: contiene },
      { codigo: contiene },
      ...(porReferenciaDelProveedor ? [{ proveedorPorProducto: { some: { referenciaProveedor: contiene } } }] : []),
    ],
  };
}
