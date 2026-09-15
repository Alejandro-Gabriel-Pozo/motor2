import { prisma } from "@/lib/db";
import { requierePermisoVer } from "@/core/permisos/gate";

/**
 * Pieza reusable SIN gate propio — el enganche real "al confirmar una
 * Compra" (actualizarProveedoresDesdeCompra_, Catalogo.js:3617-3657) es de
 * la porción Movimientos, que gatea con 'proceso_compra' antes de llamar
 * a esto. Acá solo se construye la operación de catálogo en sí.
 *
 * Usa `$executeRaw` con `INSERT ... ON CONFLICT DO UPDATE` (no
 * `prisma.upsert()`) a propósito: el UPDATE necesita una condición
 * (`CASE WHEN`, Catalogo.js:3241-3247 — un precio 0 nunca pisa un precio
 * bueno ya cargado) que el upsert de Prisma no soporta sin una lectura
 * previa, lo que reintroduciría la ventana de carrera cross-hostería que
 * esto reemplaza. El UNIQUE(productoId, proveedorId, unidadCompraId) hace
 * que dos ejecuciones concurrentes sobre la misma clave nunca produzcan
 * dos filas — ver Catalogo.js:3278-3294 para el bug real que esto cierra.
 */
export async function upsertProveedorPorProducto(datos: {
  productoId: string;
  proveedorId: string;
  unidadCompraId: string;
  precioUnitario: number;
  precioPorUnidadStock: number;
  fechaCompra?: Date;
}): Promise<void> {
  const id = crypto.randomUUID();
  const fecha = datos.fechaCompra ?? new Date();

  await prisma.$executeRaw`
    INSERT INTO "ProveedorPorProducto"
      (id, "productoId", "proveedorId", "unidadCompraId", "precioUnitario", "precioPorUnidadStock", "ultimaCompra")
    VALUES
      (${id}, ${datos.productoId}, ${datos.proveedorId}, ${datos.unidadCompraId},
       ${datos.precioUnitario}, ${datos.precioPorUnidadStock}, ${fecha})
    ON CONFLICT ("productoId", "proveedorId", "unidadCompraId")
    DO UPDATE SET
      "precioUnitario" = CASE WHEN excluded."precioUnitario" > 0
        THEN excluded."precioUnitario" ELSE "ProveedorPorProducto"."precioUnitario" END,
      "precioPorUnidadStock" = CASE WHEN excluded."precioPorUnidadStock" > 0
        THEN excluded."precioPorUnidadStock" ELSE "ProveedorPorProducto"."precioPorUnidadStock" END,
      "ultimaCompra" = excluded."ultimaCompra"
  `;
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

export async function requerirVerComparativaPrecios(usuarioId: string, sucursalId: string) {
  return requierePermisoVer(usuarioId, sucursalId, "comparar_precios");
}
