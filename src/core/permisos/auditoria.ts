import type { Prisma, PrismaClient } from "@prisma/client";
import { sucursalesDondeElUsuarioPuedeVer } from "./gate";

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
    | "Cuenta"
    | "RecetaVersion"
    | "RendimientoLocalIngrediente"
    // "Sucursal" (docs/plan-comensales-y-limite-mesas-2026-09-26.md): el límite de mesas abiertas (`maxMesasAbiertas`) se edita desde
    // el mapa de mesas con el mismo permiso que da de alta mesas (`pos_mesas`) — `entidadId` es el id de la Sucursal.
    | "Sucursal"
    // "PagoConsignante" (Task #41, M14): un pago a un proveedor de consignación — `entidadId` es el id del PagoConsignante creado,
    // `campo: "importe"`, `valorAnterior: null` (siempre una creación, nunca una edición — append-only, igual que el resto del Kardex).
    | "PagoConsignante"
    // "UsuarioEmpresa": el traspaso de la gerencia de la empresa (`transferirGerencia`) — `entidadId` es el usuario que pasa a ser gerente, `sucursalId` null (es de la empresa).
    | "UsuarioEmpresa";
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
  /**
   * Obligatorio a propósito: las sucursales cuyas filas se pueden mostrar. Quien llama lo arma con
   * `sucursalesVisiblesDeAuditoria`; nunca "todas por omisión".
   */
  sucursalIds: readonly string[];
  /**
   * Obligatorio a propósito: si se muestran también las filas SIN sucursal (cambios de la empresa entera: roles, receta central).
   * Esas no pertenecen a ninguna sucursal, así que `ver_auditoria` (que es por sucursal) no las cubre: las ve quien tiene
   * `ver_auditoria_empresa` (acción de piso gerente: el gerente de la empresa).
   */
  incluirFilasDeEmpresa: boolean;
}

/** De las sucursales del usuario, en cuáles su rol tiene «Ver» sobre `ver_auditoria` — el gate de la página mira solo la activa. */
export async function sucursalesVisiblesDeAuditoria(usuarioId: string, sucursalIds: readonly string[], db: PrismaClient): Promise<string[]> {
  const visibles = await sucursalesDondeElUsuarioPuedeVer(usuarioId, sucursalIds, "ver_auditoria", db);
  return sucursalIds.filter((id) => visibles.has(id));
}

/** Más reciente primero, paginado por cursor — mismo patrón que el resto de los listados largos del proyecto (ver obtenerHistorialConteosFisicos). */
export async function listarRegistrosAuditoria(filtro: FiltroAuditoria, db: Db) {
  const filas = await db.registroAuditoria.findMany({
    where: {
      ...(filtro.entidad ? { entidad: filtro.entidad } : {}),
      OR: [...(filtro.incluirFilasDeEmpresa ? [{ sucursalId: null }] : []), { sucursalId: { in: [...filtro.sucursalIds] } }],
    },
    include: { actor: { select: { email: true, name: true } }, sucursal: { select: { nombre: true } } },
    // `id` desempata: `creadoEn` se repite (filas de una misma transacción) y, con cursor, un orden no total salta filas.
    orderBy: [{ creadoEn: "desc" }, { id: "desc" }],
    take: TAMANO_PAGINA_AUDITORIA + 1,
    ...(filtro.cursor ? { cursor: { id: filtro.cursor }, skip: 1 } : {}),
  });

  const hayMas = filas.length > TAMANO_PAGINA_AUDITORIA;
  const items = hayMas ? filas.slice(0, TAMANO_PAGINA_AUDITORIA) : filas;
  return { items, nextCursor: hayMas ? items[items.length - 1]!.id : null };
}
