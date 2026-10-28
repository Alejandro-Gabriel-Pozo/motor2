import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * E3a (ADR-041): las LECTURAS que necesitan los casos de uso de la factura de proveedor (cargar, aceptar una propuesta y anular) dentro de su transacción. Sin reglas de negocio; `Decimal` → `number` en el borde.
 * Lo que se lee con el alcance del contexto (la RLS por sucursal decide qué partes y propuestas se ven).
 */

type Db = Prisma.TransactionClient;

/** La huella y el mensaje de la factura que lleva esa clave de reintento (I3), o `null`. La cabecera es de la empresa: la ve cualquier sucursal de la empresa. */
export async function cargarFacturaPorClaveIdempotencia(db: Db, claveIdempotencia: string): Promise<{ payloadHash: string | null; resultadoMensaje: string | null } | null> {
  return db.facturaProveedor.findUnique({ where: { claveIdempotencia }, select: { payloadHash: true, resultadoMensaje: true } });
}

/** La huella y el mensaje de la anulación que lleva esa clave de reintento (I3), o `null`. */
export async function cargarAnulacionPorClaveIdempotencia(db: Db, claveIdempotencia: string): Promise<{ payloadHash: string | null; resultadoMensaje: string | null } | null> {
  return db.anulacionDeFacturaProveedor.findUnique({ where: { claveIdempotencia }, select: { payloadHash: true, resultadoMensaje: true } });
}

/** ¿Hay una factura VIGENTE de ese proveedor con ese número normalizado (sin letra)? Camino rápido; el árbitro es el índice único parcial `FacturaProveedor_unica_vigente_key`. */
export async function existeFacturaVigenteConNumero(db: Db, args: { proveedorId: string; nroFacturaNormalizado: string }): Promise<boolean> {
  return (await db.facturaProveedor.count({ where: { proveedorId: args.proveedorId, nroFacturaNormalizado: args.nroFacturaNormalizado, letra: null, anuladaEn: null } })) > 0;
}

/** Las sucursales pedidas (de la empresa: la RLS esconde las ajenas), con su nombre y si están activas. `Sucursal` es de gobierno: no depende del alcance. */
export async function cargarSucursalesDelReparto(db: Db, sucursalIds: readonly string[]): Promise<{ id: string; nombre: string; activo: boolean }[]> {
  return db.sucursal.findMany({ where: { id: { in: [...sucursalIds] } }, select: { id: true, nombre: true, activo: true } });
}

export interface FacturaBloqueada {
  id: string;
  proveedorId: string;
  nroFactura: string | null;
  fecha: Date;
  anuladaEn: Date | null;
}

/**
 * Toma la fila de la cabecera con `SELECT … FOR UPDATE` (primera sentencia de la aceptación y de la anulación): serializa la anulación contra la aceptación de cualquier propuesta y dos aceptaciones entre sí
 * (ADR-029 §12: la cabecera es la única fila de la factura que la app puede tomar, porque tiene UPDATE por columna). `null` si no existe en la empresa.
 */
export async function bloquearFactura(tx: Db, facturaProveedorId: string): Promise<FacturaBloqueada | null> {
  const filas = await tx.$queryRaw<FacturaBloqueada[]>`
    SELECT "id", "proveedorId", "nroFactura", "fecha", "anuladaEn" FROM "FacturaProveedor" WHERE "id" = ${facturaProveedorId} FOR UPDATE`;
  return filas[0] ?? null;
}

export interface RenglonDePropuesta {
  facturaProveedorRenglonId: string;
  productoId: string;
  productoNombre: string;
  cantidadStock: number;
  precioTotal: number;
  precioPorUnidadStock: number;
  loteVencimiento: Date | null;
  detalle: string;
}

export interface PropuestaParaAceptar {
  id: string;
  facturaProveedorId: string;
  origenSucursalId: string;
  destinoSucursalId: string;
  porcentajeDeclaradoBp: number;
  estado: string;
  aceptadaEn: Date | null;
  renglones: RenglonDePropuesta[];
}

/** La propuesta con sus renglones (y lo que el Kardex necesita de cada renglón de la factura), o `null` si no se ve con el alcance del contexto. */
export async function cargarPropuestaParaAceptar(tx: Db, propuestaId: string): Promise<PropuestaParaAceptar | null> {
  const p = await tx.facturaProveedorPropuesta.findUnique({
    where: { id: propuestaId },
    include: {
      renglones: {
        include: { renglon: { select: { orden: true, productoId: true, precioPorUnidadStock: true, loteVencimiento: true, detalle: true, producto: { select: { nombre: true } } } } },
      },
    },
  });
  if (!p) return null;
  const renglones = [...p.renglones].sort((a, b) => a.renglon.orden - b.renglon.orden);
  return {
    id: p.id,
    facturaProveedorId: p.facturaProveedorId,
    origenSucursalId: p.origenSucursalId,
    destinoSucursalId: p.destinoSucursalId,
    porcentajeDeclaradoBp: p.porcentajeDeclaradoBp,
    estado: p.estado,
    aceptadaEn: p.aceptadaEn,
    renglones: renglones.map((r) => ({
      facturaProveedorRenglonId: r.facturaProveedorRenglonId,
      productoId: r.renglon.productoId as string,
      productoNombre: r.renglon.producto?.nombre ?? "",
      cantidadStock: Number(r.cantidadStock),
      precioTotal: Number(r.precioTotal),
      precioPorUnidadStock: Number(r.renglon.precioPorUnidadStock ?? 0),
      loteVencimiento: r.renglon.loteVencimiento,
      detalle: r.renglon.detalle ?? "COMPRA",
    })),
  };
}

/** El estado guardado de una propuesta (o `null` si no se ve): para traducir un choque de unicidad perdido en una aceptación concurrente. */
export async function cargarEstadoDePropuesta(db: Db, propuestaId: string): Promise<string | null> {
  return (await db.facturaProveedorPropuesta.findUnique({ where: { id: propuestaId }, select: { estado: true } }))?.estado ?? null;
}

/** Las partes de la factura que se ven con el alcance del contexto (sucursal, nombre y su compra). */
export async function cargarPartesDeFactura(tx: Db, facturaProveedorId: string): Promise<{ id: string; sucursalId: string; sucursalNombre: string; operacionId: string | null }[]> {
  const partes = await tx.facturaProveedorSucursal.findMany({
    where: { facturaProveedorId },
    select: { id: true, sucursalId: true, operacionId: true, sucursal: { select: { nombre: true } } },
    orderBy: { sucursalId: "asc" },
  });
  return partes.map((p) => ({ id: p.id, sucursalId: p.sucursalId, sucursalNombre: p.sucursal.nombre, operacionId: p.operacionId }));
}

/**
 * VERIFICACIÓN (`lecturaDeVerificacionEnLaEmpresa`, lista cerrada en `test/arquitectura/ensanches-de-alcance.test.ts`): en qué sucursales de la empresa tiene una parte (ya recibida) la factura (`conParte`) y qué
 * sucursal la cargó (`queLaCargaron`: el origen de sus propuestas; vacío si no repartió a otras). Se usa SOLO para decidir en cuáles hay que pedir el permiso de anular antes de abrir la transacción; no se muestra
 * nada de otra sucursal.
 */
export async function sucursalesConParteDeFactura(db: Db, facturaProveedorId: string): Promise<{ conParte: string[]; queLaCargaron: string[] }> {
  const partes = await db.facturaProveedorSucursal.findMany({ where: { facturaProveedorId }, select: { sucursalId: true }, orderBy: { sucursalId: "asc" } });
  const propuestas = await db.facturaProveedorPropuesta.findMany({ where: { facturaProveedorId }, select: { origenSucursalId: true }, distinct: ["origenSucursalId"], orderBy: { origenSucursalId: "asc" } });
  return { conParte: partes.map((p) => p.sucursalId), queLaCargaron: propuestas.map((p) => p.origenSucursalId) };
}

/** ¿La factura tiene notas de crédito vigentes? (C29: anular una factura con notas vigentes se rechaza.) */
export async function tieneNotasDeCreditoVigentes(tx: Db, facturaProveedorId: string): Promise<boolean> {
  return (await tx.notaCreditoProveedor.count({ where: { facturaProveedorId, anuladaEn: null } })) > 0;
}
