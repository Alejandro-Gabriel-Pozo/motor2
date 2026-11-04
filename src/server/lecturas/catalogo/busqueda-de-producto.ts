import "server-only";
import { Prisma } from "@prisma/client";
import { palabrasDeBusqueda } from "@/core/catalogo/public";
import { escaparComodinesLike } from "@/core/texto";
import type { Db } from "@/lib/db-tipos";

/**
 * La búsqueda de un producto por texto (Compras etapa 1, paso 5; diseño `docs/diseno-compras-factura-unica-y-rechazo-2026-11-03.md` §5.2), COMPARTIDA por la lista de Productos y el buscador de producto
 * (`buscarProductosSelector`): las dos buscan igual. Una lectura cruda parametrizada (`$queryRaw` con tagged template: el texto va como parámetro, nunca concatenado) por el cliente de la sesión, que lleva la
 * RLS: solo ve productos de la empresa. Devuelve ids; quien llama hace el `findMany` de siempre con `id IN (…)` más sus filtros, select, orden y tope.
 *
 * Cada palabra del término (`palabrasDeBusqueda`, AND, en cualquier orden) tiene que estar en el nombre, el código o —solo con `porReferencia`— la referencia de algún proveedor, sin distinguir mayúsculas NI
 * tildes (`unaccent(lower(...))`, extensión instalada por la migración 20261003120000; la ñ vale como n) y con `%`, `_` y `\` como letras (`escaparComodinesLike` escapa con `\`, el `ESCAPE` de acá).
 *
 * Tope: a lo sumo `LIMITE_DE_IDS` ids, por nombre. Los filtros del llamador (disponibilidad, tipo…) se aplican DESPUÉS, sobre esos ids, y `id IN` tiene un máximo de parámetros: una búsqueda tan genérica que
 * lo supera es una búsqueda que hay que afinar (en el buscador solo se muestran 20; la lista de Productos pide más letras).
 */
const LIMITE_DE_IDS = 2000;

export interface OpcionesDeBusquedaDeProducto {
  /** Buscar también en `ProveedorPorProducto.referenciaProveedor` de cualquier proveedor (`puedeBuscarPorReferenciaDelProveedor`). */
  porReferencia: boolean;
  /** Solo para ORDENAR en la compra: marca como `vinculado` el producto cuya referencia, en el vínculo con ESTE proveedor, contiene todas las palabras. Quien llama lo pasa solo si `porReferencia`. */
  proveedorId?: string;
  /** El buscador del POS: buscar también en el «Nombre en la carta» de ESTA sucursal (la de la sesión). */
  sucursalDeLaCarta?: string;
}

export interface ProductoEncontrado {
  id: string;
  /** La referencia del proveedor elegido contiene todas las palabras. */
  vinculado: boolean;
  /** El nombre empieza con la primera palabra. */
  empiezaConLaPrimera: boolean;
}

const comoTexto = (columna: Prisma.Sql) => Prisma.sql`unaccent(lower(${columna}))`;
const contiene = (columna: Prisma.Sql, palabra: string) => Prisma.sql`${comoTexto(columna)} LIKE '%' || unaccent(lower(${escaparComodinesLike(palabra)})) || '%' ESCAPE '\\'`;

/** Los productos (por nombre) que tienen todas las palabras de `termino`; vacío si el término no tiene palabras. */
export async function buscarProductosPorPalabras(db: Db, termino: string, { porReferencia, proveedorId, sucursalDeLaCarta }: OpcionesDeBusquedaDeProducto): Promise<ProductoEncontrado[]> {
  const palabras = palabrasDeBusqueda(termino);
  if (palabras.length === 0) return [];
  const cadaPalabra = palabras.map((w) =>
    Prisma.sql`(${contiene(Prisma.sql`p."nombre"`, w)} OR ${contiene(Prisma.sql`p."codigo"`, w)}${
      sucursalDeLaCarta
        ? Prisma.sql` OR EXISTS (SELECT 1 FROM "ContenidoCartaProducto" c WHERE c."productoId" = p."id" AND c."sucursalId" = ${sucursalDeLaCarta} AND ${contiene(Prisma.sql`c."nombreEnCarta"`, w)})`
        : Prisma.empty
    }${
      porReferencia
        ? Prisma.sql` OR EXISTS (SELECT 1 FROM "ProveedorPorProducto" r WHERE r."productoId" = p."id" AND ${contiene(Prisma.sql`r."referenciaProveedor"`, w)})`
        : Prisma.empty
    })`,
  );
  const vinculado = proveedorId
    ? Prisma.sql`EXISTS (SELECT 1 FROM "ProveedorPorProducto" v WHERE v."productoId" = p."id" AND v."proveedorId" = ${proveedorId} AND ${Prisma.join(
        palabras.map((w) => contiene(Prisma.sql`v."referenciaProveedor"`, w)),
        " AND ",
      )})`
    : Prisma.sql`FALSE`;
  const empieza = Prisma.sql`${comoTexto(Prisma.sql`p."nombre"`)} LIKE unaccent(lower(${escaparComodinesLike(palabras[0]!)})) || '%' ESCAPE '\\'`;
  return db.$queryRaw<ProductoEncontrado[]>`
    SELECT p."id", ${vinculado} AS "vinculado", ${empieza} AS "empiezaConLaPrimera"
    FROM "Producto" p
    WHERE ${Prisma.join(cadaPalabra, " AND ")}
    ORDER BY p."nombre" ASC
    LIMIT ${LIMITE_DE_IDS}
  `;
}
