import "server-only";
import type { Prisma } from "@prisma/client";
import { ALCANCE_CENTRAL, alcanceDeSucursal } from "@/core/catalogo/public";
import { INCLUDE_RECETA_COMPLETA } from "@/core/catalogo/public-servidor";
import type { TipoProducto } from "@/core/datos/enumerados-del-esquema";
import { cargarRecetaVigente } from "@/server/lecturas/catalogo/recetas-vigentes";

/**
 * Persistencia de «Duplicar producto» (etapa E4 de `docs/diseno-duplicar-producto-2026-11-12.md`): las lecturas del original y la única escritura propia (la fila del producto nuevo). Todo corre DENTRO de la transacción
 * SERIALIZABLE del caso de uso (`casos-de-uso/duplicar-producto.ts`): el cliente es SIEMPRE el primer parámetro, y no hay reglas de negocio. La receta nueva la escribe `escribirVersionDeReceta` (`guardar-version-de-receta.ts`), lo que el
 * producto admite lo escribe `fijarAdmisionDeGrupoEnTx` (el mismo cuerpo que la pantalla de opciones) y la disponibilidad, `sembrarDisponibilidadDeProductoNuevo` (`productos.ts`): acá no se repiten.
 *
 * Las columnas que se copian y las que no están declaradas en `COLUMNAS_DEL_DUPLICADO` (`core/catalogo/duplicar-producto.ts`), que un test compara con el esquema.
 */

/** Las columnas del producto que `COLUMNAS_DEL_DUPLICADO` declara como copiables (con o sin permiso): lo único que se lee del original para armar la ficha, más su nombre y si es el respaldo de un adicional. */
const SELECT_DEL_ORIGEN = {
  id: true,
  nombre: true,
  tipo: true,
  categoriaId: true,
  unidadCompraId: true,
  unidadStockId: true,
  factorConversion: true,
  observaciones: true,
  precioVenta: true,
  modoDeVenta: true,
  alicuotaIvaVenta: true,
  alicuotaIvaCompra: true,
  pasoVenta: true,
  seProduce: true,
  opcionQueRespalda: { select: { id: true } },
} satisfies Prisma.ProductoSelect;

export type OrigenDelDuplicado = Prisma.ProductoGetPayload<{ select: typeof SELECT_DEL_ORIGEN }>;

/** El producto original (de la empresa activa: la RLS esconde los ajenos), o `null` si no existe. */
export async function cargarOrigenDelDuplicado(tx: Prisma.TransactionClient, origenId: string): Promise<OrigenDelDuplicado | null> {
  return tx.producto.findFirst({ where: { id: origenId }, select: SELECT_DEL_ORIGEN });
}

/** El producto que ya tiene ese id (el `duplicadoId` de un pedido repetido), con su nombre, o `null`. */
export async function cargarProductoDelDuplicadoId(tx: Prisma.TransactionClient, id: string): Promise<{ id: string; nombre: string } | null> {
  return tx.producto.findFirst({ where: { id }, select: { id: true, nombre: true } });
}

/** De qué producto salió el duplicado `productoId`, según su fila de auditoría (`Producto.duplicadoDe`), o `null` si ese producto no nació de una duplicación. */
export async function cargarOrigenAuditadoDelDuplicado(tx: Prisma.TransactionClient, productoId: string): Promise<string | null> {
  const fila = await tx.registroAuditoria.findFirst({ where: { entidad: "Producto", entidadId: productoId, campo: "duplicadoDe" }, select: { valorNuevo: true }, orderBy: { creadoEn: "asc" } });
  return fila?.valorNuevo ?? null;
}

/** ¿Hay un producto con ese nombre, sin distinguir mayúsculas? Mira TODOS (disponibles o no): el índice único `lower(nombre)` de la base los cuenta a todos. */
export async function existeProductoConElNombre(tx: Prisma.TransactionClient, nombre: string): Promise<boolean> {
  return (await tx.producto.findFirst({ where: { nombre: { equals: nombre, mode: "insensitive" } }, select: { id: true } })) !== null;
}

/** Lo que se escribe del producto nuevo: la ficha del original (con lo que decidió el permiso del precio) y lo propio del duplicado. */
export interface ProductoDuplicadoNuevo {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoProducto;
  categoriaId: string | null;
  unidadCompraId: string | null;
  unidadStockId: string;
  factorConversion: Prisma.Decimal | number;
  observaciones: string | null;
  precioVenta: Prisma.Decimal | number;
  modoDeVenta: string;
  alicuotaIvaVenta: string | null;
  alicuotaIvaCompra: string | null;
  pasoVenta: Prisma.Decimal | number | null;
  seProduce: boolean;
}

/**
 * Crea el producto nuevo con el id que mandó la aplicación. Sin consignación, sin insumo y sin nada más que lo declarado en `COLUMNAS_DEL_DUPLICADO` (el resto queda en su valor de fábrica). La llama el caso de uso
 * dentro de su transacción, que audita el producto y su precio (las columnas de dinero y de significado se cuentan: `escrituras-auditadas.test.ts` exige la cadena).
 */
export async function crearProductoDuplicado(tx: Prisma.TransactionClient, producto: ProductoDuplicadoNuevo): Promise<void> {
  await tx.producto.create({
    data: {
      id: producto.id,
      codigo: producto.codigo,
      nombre: producto.nombre,
      tipo: producto.tipo,
      categoriaId: producto.categoriaId,
      unidadCompraId: producto.unidadCompraId,
      unidadStockId: producto.unidadStockId,
      factorConversion: producto.factorConversion,
      observaciones: producto.observaciones,
      precioVenta: producto.precioVenta,
      modoDeVenta: producto.modoDeVenta,
      alicuotaIvaVenta: producto.alicuotaIvaVenta,
      alicuotaIvaCompra: producto.alicuotaIvaCompra,
      pasoVenta: producto.pasoVenta,
      seProduce: producto.seProduce,
    },
  });
}

/**
 * Deja al producto recién duplicado con el modo de venta del original (un original que se vende por opción nace «Directo» y pasa a base al final, cuando sus opciones ya están copiadas y cumplen la regla de la base). Solo la columna
 * `modoDeVenta`: el caso de uso la audita. La llama dentro de su transacción.
 */
export async function fijarModoDeVentaDelDuplicado(tx: Prisma.TransactionClient, args: { id: string; modoDeVenta: string }): Promise<void> {
  await tx.producto.update({ where: { id: args.id }, data: { modoDeVenta: args.modoDeVenta } });
}

/**
 * La receta VIGENTE del original, completa (ingredientes con sus sustitutos, pasos con su tabla paso↔ingrediente y la ficha técnica), tal como rige en la sucursal elegida: la propia si la tiene HABILITADA y con versiones, y si no
 * la central; `sucursalId` `null` es la Central. Siempre por el lector único de la receta vigente (`cargarRecetaVigente`). `null` si el original no tiene receta.
 */
export async function cargarRecetaVigenteDelOrigen(tx: Prisma.TransactionClient, origenId: string, sucursalId: string | null) {
  return cargarRecetaVigente(tx, sucursalId === null ? ALCANCE_CENTRAL : alcanceDeSucursal(sucursalId), origenId, { include: INCLUDE_RECETA_COMPLETA });
}

/** Un grupo que el original admite (activo en el producto), con lo que hace falta para copiarlo y para saber si la biblioteca lo tiene archivado. */
export interface GrupoAdmitidoDelOrigen {
  grupoId: string;
  orden: number;
  cantidadMinima: number | null;
  cantidadMaxima: number | null;
  modoPrecio: string | null;
  seMuestraEnCarta: boolean;
  /** `false`: el grupo está archivado en la biblioteca (no se copia y se avisa). */
  activoEnLaBiblioteca: boolean;
  opciones: OpcionAdmitidaDelOrigen[];
}

export interface OpcionAdmitidaDelOrigen {
  opcionId: string;
  cantidadMaxima: number;
  precioAbsoluto: number | null;
  tipoDeDiferencia: string | null;
  diferenciaPrecio: number | null;
  porcentaje: number | null;
  /** `false`: la opción está archivada en la biblioteca (no se copia y se avisa). */
  activaEnLaBiblioteca: boolean;
}

const aNumero = (d: Prisma.Decimal | null): number | null => (d === null ? null : Number(d));

/**
 * Lo que el original admite: sus grupos ACTIVOS en el producto, cada uno con sus opciones activas en el producto, en el orden de siempre (el `orden` del grupo en el producto y el de cada opción en la biblioteca). Los
 * importes se pasan a `number` en el borde (son columnas `Decimal(14,2)` o `(7,4)`, como en `fijar-admision-de-grupo-en-producto.ts`).
 */
export async function cargarAdmitidoDelOrigen(tx: Prisma.TransactionClient, origenId: string): Promise<GrupoAdmitidoDelOrigen[]> {
  const [grupos, filas] = await Promise.all([
    tx.productoAdmiteGrupo.findMany({
      where: { productoId: origenId, activo: true },
      orderBy: [{ orden: "asc" }, { id: "asc" }],
      select: { grupoId: true, orden: true, cantidadMinima: true, cantidadMaxima: true, modoPrecio: true, seMuestraEnCarta: true, grupo: { select: { activo: true } } },
    }),
    tx.productoAdmiteOpcion.findMany({
      where: { productoId: origenId, activo: true },
      orderBy: [{ opcion: { orden: "asc" } }, { id: "asc" }],
      select: { opcionId: true, cantidadMaxima: true, precioAbsoluto: true, tipoDeDiferencia: true, diferenciaPrecio: true, porcentaje: true, opcion: { select: { grupoId: true, activa: true } } },
    }),
  ]);
  return grupos.map((g) => ({
    grupoId: g.grupoId,
    orden: g.orden,
    cantidadMinima: g.cantidadMinima,
    cantidadMaxima: g.cantidadMaxima,
    modoPrecio: g.modoPrecio,
    seMuestraEnCarta: g.seMuestraEnCarta,
    activoEnLaBiblioteca: g.grupo.activo,
    opciones: filas
      .filter((f) => f.opcion.grupoId === g.grupoId)
      .map((f) => ({
        opcionId: f.opcionId,
        cantidadMaxima: f.cantidadMaxima,
        precioAbsoluto: aNumero(f.precioAbsoluto),
        tipoDeDiferencia: f.tipoDeDiferencia,
        diferenciaPrecio: aNumero(f.diferenciaPrecio),
        porcentaje: aNumero(f.porcentaje),
        activaEnLaBiblioteca: f.opcion.activa,
      })),
  }));
}
