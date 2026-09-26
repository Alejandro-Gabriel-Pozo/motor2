import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Auditoría administrativa (A3, Pivote 6 — docs/auditoria-motor2-pivotes-
 * 2026-09-16.md "Pivote 6", docs/auditoria-motor2-fase6-seguridad-
 * 2026-09-18.md): catálogo/precios/permisos no dejaban ningún rastro de
 * quién cambió qué y cuándo. Este es el único punto de escritura del
 * registro (mismo criterio que `conPermiso`/`conTransaccionSerializable`:
 * un solo lugar, nunca una copia divergente en cada Server Action).
 */
export interface CambioAuditable {
  // "RecetaVersion" (paso 2): cada versión nueva de la receta central (`guardarReceta`) — SIEMPRE `sucursalId: null`
  // (Catálogo Central, no un dato por sucursal). "RendimientoLocalIngrediente" (paso 6): al revés, SIEMPRE lleva
  // `sucursalId` — es la calibración de UNA sucursal puntual (`entidadId` es la clave estable
  // `${sucursalId}:${productoId}:${insumoProductoId}`, no el id de la fila, que cambia con el arrastre entre versiones).
  entidad:
    | "Producto"
    | "PrecioLocalProducto"
    | "DisponibilidadProducto"
    | "PermisoRol"
    | "CapacidadSucursal"
    | "Rol"
    | "Operacion"
    | "CuentaItem"
    | "RecetaVersion"
    | "RendimientoLocalIngrediente";
  entidadId: string;
  /** Legible de entrada, ej. `Producto "Pan Francés": precio de venta`. */
  descripcion: string;
  /** Nombre técnico del campo cambiado, ej. "precioVenta". */
  campo: string;
  valorAnterior: unknown;
  valorNuevo: unknown;
  actorId: string;
  sucursalId?: string | null;
}

function aTexto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  return String(valor);
}

/**
 * No-op si el valor no cambió en absoluto — evita ensuciar el registro
 * con "cambios" de un `update`/`upsert` que en realidad reescribió el
 * mismo valor (ej. guardar un formulario sin tocar ese campo puntual).
 */
export async function registrarCambioAuditado(db: Db, cambio: CambioAuditable): Promise<void> {
  const anterior = aTexto(cambio.valorAnterior);
  const nuevo = aTexto(cambio.valorNuevo);
  if (anterior === nuevo) return;

  await db.registroAuditoria.create({
    data: {
      entidad: cambio.entidad,
      entidadId: cambio.entidadId,
      descripcion: cambio.descripcion,
      campo: cambio.campo,
      valorAnterior: anterior,
      valorNuevo: nuevo,
      actorId: cambio.actorId,
      sucursalId: cambio.sucursalId ?? null,
    },
  });
}

const TAMANO_PAGINA_AUDITORIA = 50;

export interface FiltroAuditoria {
  entidad?: CambioAuditable["entidad"];
  cursor?: string;
}

/** Más reciente primero, paginado por cursor — mismo patrón que el resto de los listados largos del proyecto (ver obtenerHistorialConteosFisicos). */
export async function listarRegistrosAuditoria(filtro: FiltroAuditoria = {}, db: Db = prisma) {
  const filas = await db.registroAuditoria.findMany({
    where: filtro.entidad ? { entidad: filtro.entidad } : undefined,
    include: { actor: { select: { email: true, name: true } }, sucursal: { select: { nombre: true } } },
    orderBy: { creadoEn: "desc" },
    take: TAMANO_PAGINA_AUDITORIA + 1,
    ...(filtro.cursor ? { cursor: { id: filtro.cursor }, skip: 1 } : {}),
  });

  const hayMas = filas.length > TAMANO_PAGINA_AUDITORIA;
  const items = hayMas ? filas.slice(0, TAMANO_PAGINA_AUDITORIA) : filas;
  return { items, nextCursor: hayMas ? items[items.length - 1]!.id : null };
}
