import "server-only";
import type { EstadoTraspaso, Prisma, TipoProducto } from "@prisma/client";

/**
 * Lecturas de un Traspaso entre sucursales DENTRO de una mutación (Task #41, Fase M11a — docs/arquitectura-casos-de-uso-2026-09-27.md;
 * mismo contrato que `server/persistencia/compras/`: `tx` OBLIGATORIO, tipos de dominio con los `Decimal` ya convertidos a `number`,
 * sin reglas de negocio). Son EXACTAMENTE las consultas que antes hacían en línea las Server Actions de
 * `src/server/actions/traspasos/traspasos.ts` (`buscarTraspaso`, la sucursal de la otra punta y el producto a re-chequear), con los
 * mismos filtros.
 */

/** El traspaso tal como lo necesitan los casos de uso: lo que mira el guard de transición más lo que se escribe o se muestra. */
export interface TraspasoCargado {
  id: string;
  estado: EstadoTraspaso;
  origenSucursalId: string;
  destinoSucursalId: string;
  productoId: string;
  productoNombre: string;
  cantidad: number;
  seccionOrigenId: string | null;
}

/** `null` si no existe un traspaso con ese id (de ninguna sucursal: de qué lado está quien actúa lo decide `guardTransicionTraspaso`). */
export async function cargarTraspaso(tx: Prisma.TransactionClient, traspasoId: string): Promise<TraspasoCargado | null> {
  const t = await tx.traspasoSucursal.findUnique({ where: { id: traspasoId }, include: { producto: { include: { unidadStock: true } } } });
  if (!t) return null;
  return {
    id: t.id,
    estado: t.estado,
    origenSucursalId: t.origenSucursalId,
    destinoSucursalId: t.destinoSucursalId,
    productoId: t.productoId,
    productoNombre: t.producto.nombre,
    cantidad: Number(t.cantidad),
    seccionOrigenId: t.seccionOrigenId,
  };
}

/** La sucursal de la otra punta del traspaso (siempre existe: la FK del traspaso la garantiza, así que falla si no está). */
export async function cargarSucursalDelTraspaso(tx: Prisma.TransactionClient, sucursalId: string): Promise<{ id: string; nombre: string }> {
  const s = await tx.sucursal.findUniqueOrThrow({ where: { id: sucursalId } });
  return { id: s.id, nombre: s.nombre };
}

/**
 * Lo que hace falta del producto para decidir si es transferible (`tieneStockReal`), más su unidad de stock (M11c: la creación valida la
 * cantidad contra sus decimales y la nombra en el mensaje del envío directo). `null` si ya no existe.
 */
export interface ProductoParaTraspaso {
  id: string;
  nombre: string;
  tipo: TipoProducto;
  seProduce: boolean;
  unidadStock: { nombre: string; decimales: number };
}

export async function cargarProductoParaTraspaso(tx: Prisma.TransactionClient, productoId: string): Promise<ProductoParaTraspaso | null> {
  const p = await tx.producto.findUnique({ where: { id: productoId }, include: { unidadStock: true } });
  return p
    ? { id: p.id, nombre: p.nombre, tipo: p.tipo, seProduce: p.seProduce, unidadStock: { nombre: p.unidadStock.nombre, decimales: p.unidadStock.decimales } }
    : null;
}

/**
 * La sucursal de la otra punta de un traspaso que se está CREANDO (Task #41, Fase M11c: la misma consulta que antes hacían en línea
 * `crearSolicitudTransferencia` y `crearEnvioDirectoTransferencia`). A diferencia de `cargarSucursalDelTraspaso`, puede no existir
 * (viene del formulario, no de una FK): `null` en ese caso; si está activa lo decide el caso de uso.
 */
export async function cargarSucursalParaTraspaso(
  tx: Prisma.TransactionClient,
  sucursalId: string
): Promise<{ id: string; nombre: string; activo: boolean } | null> {
  const s = await tx.sucursal.findUnique({ where: { id: sucursalId } });
  return s ? { id: s.id, nombre: s.nombre, activo: s.activo } : null;
}

/**
 * La sección de origen registrada en el traspaso, para el mensaje del reingreso (Task #41, Fase M11b: la misma consulta que antes hacía
 * en línea `confirmarReingresoTransferencia`). Siempre existe: la FK del traspaso la garantiza, así que falla si no está.
 */
export async function cargarSeccionDelTraspaso(tx: Prisma.TransactionClient, seccionId: string): Promise<{ id: string; nombre: string }> {
  const s = await tx.seccion.findUniqueOrThrow({ where: { id: seccionId } });
  return { id: s.id, nombre: s.nombre };
}
