import "server-only";
import type { Prisma } from "@prisma/client";
import type { PartesDeImagen } from "@/core/carta/public";
import { textoDesdeCentesimas, type DatosDelPortal, type TarjetaDePortal, type ZonaDePortal } from "@/core/carta/public";

/**
 * Escrituras (y el bloqueo y la verificación de sucursales) del PORTAL de la empresa (`PortalDeEmpresa`, `PortalTarjeta`, `PortalZona`; PR-A del portal, docs/diseno-carta-portal-e-identidad-niveles-6-a-10-2026-11-17.md). Mismo contrato que el resto de `server/persistencia/`: el `tx` de la
 * transacción del caso de uso es el PRIMER parámetro, `data` literal, sin reglas de negocio ni auditoría (la escribe el caso de uso con el mismo `tx`). El portal es de la EMPRESA: la RLS (`aislamiento_empresa`) y el `default` de `empresaId` la fijan desde el contexto del
 * servidor, nunca desde el pedido (igual se filtra por `empresaId` explícito, además de la RLS). Los UPDATE tocan solo columnas con GRANT. Nada se borra.
 */

type Tx = Prisma.TransactionClient;
type ImagenGuardada = PartesDeImagen | null;

/**
 * Toma la fila del portal de la empresa (`FOR UPDATE`) hasta el final de la transacción: dos pedidos a la vez sobre el MISMO portal (guardar, guardar) se ordenan acá en vez de pisarse. No lee ni escribe datos. Devuelve `false` si la empresa todavía no tiene portal
 * (no hay fila que tomar: el alta se ordena con el único por empresa y el nivel SERIALIZABLE).
 */
export async function bloquearPortalDeLaEmpresa(tx: Tx, empresaId: string): Promise<boolean> {
  const filas = await tx.$queryRaw<{ id: string }[]>`SELECT "id"::text AS "id" FROM "PortalDeEmpresa" WHERE "empresaId" = ${empresaId} FOR UPDATE`;
  return filas.length === 1;
}

/** ¿Cuáles de estas sucursales NO son de la empresa (o no existen)? Misma respuesta para las dos cosas: el llamador no distingue. */
export async function sucursalesQueNoSonDeLaEmpresa(tx: Tx, args: { empresaId: string; sucursalIds: readonly string[] }): Promise<string[]> {
  if (args.sucursalIds.length === 0) return [];
  const propias = await tx.sucursal.findMany({ where: { empresaId: args.empresaId, id: { in: [...args.sucursalIds] } }, select: { id: true } });
  const ids = new Set(propias.map((s) => s.id));
  return args.sucursalIds.filter((id) => !ids.has(id));
}

const columnasDeImagen = (i: ImagenGuardada) => ({
  imagenProveedor: i?.proveedor ?? null,
  imagenCuenta: i?.cuenta ?? null,
  imagenIdPublico: i?.idPublico ?? null,
  imagenVersion: i?.version ?? null,
  imagenExtension: i?.extension ?? null,
});

const columnasDeFoto = (i: ImagenGuardada) => ({
  fotoProveedor: i?.proveedor ?? null,
  fotoCuenta: i?.cuenta ?? null,
  fotoIdPublico: i?.idPublico ?? null,
  fotoVersion: i?.version ?? null,
  fotoExtension: i?.extension ?? null,
});

/** Alta del portal. El `id` y el `codigo` los manda la aplicación (uuid y 128 bits de azar); un segundo portal para la misma empresa o un código repetido chocan con los únicos de la base. */
export async function crearPortal(
  tx: Tx,
  args: { id: string; codigo: string; datos: DatosDelPortal; imagen: ImagenGuardada; actorId: string; ahora: Date },
): Promise<void> {
  await tx.portalDeEmpresa.create({
    data: { id: args.id, codigo: args.codigo, ...args.datos, ...columnasDeImagen(args.imagen), creadoPorId: args.actorId, creadoEn: args.ahora, actualizadoEn: args.ahora },
  });
}

/** Cambia el portal con control de versión. Devuelve `false` si la versión ya no es la esperada (alguien lo cambió antes). El código no cambia nunca (disparador). */
export async function cambiarPortal(tx: Tx, args: { id: string; versionEsperada: number; datos: DatosDelPortal; imagen: ImagenGuardada; ahora: Date }): Promise<boolean> {
  const { count } = await tx.portalDeEmpresa.updateMany({
    where: { id: args.id, version: args.versionEsperada },
    data: { ...args.datos, ...columnasDeImagen(args.imagen), version: args.versionEsperada + 1, actualizadoEn: args.ahora },
  });
  return count === 1;
}

/** Alta de una tarjeta del portal (una por portal y sucursal; la clave de la base lo impide dos veces). */
export async function crearTarjeta(tx: Tx, args: { portalId: string; tarjeta: TarjetaDePortal; ahora: Date }): Promise<void> {
  const t = args.tarjeta;
  await tx.portalTarjeta.create({
    data: { portalId: args.portalId, sucursalId: t.sucursalId, orden: t.orden, visible: t.visible, nombre: t.nombre, telefono: t.telefono, ...columnasDeFoto(t.foto), creadoEn: args.ahora, actualizadoEn: args.ahora },
  });
}

/** Cambia una tarjeta con control de versión (la que se acaba de leer con el portal bloqueado). */
export async function cambiarTarjeta(tx: Tx, args: { portalId: string; tarjeta: TarjetaDePortal; versionEsperada: number; ahora: Date }): Promise<boolean> {
  const t = args.tarjeta;
  const { count } = await tx.portalTarjeta.updateMany({
    where: { portalId: args.portalId, sucursalId: t.sucursalId, version: args.versionEsperada },
    data: { orden: t.orden, visible: t.visible, nombre: t.nombre, telefono: t.telefono, ...columnasDeFoto(t.foto), version: args.versionEsperada + 1, actualizadoEn: args.ahora },
  });
  return count === 1;
}

/** Alta de una zona (una por portal y sucursal). El `id` lo manda la aplicación (uuid). Los porcentajes se guardan con dos decimales exactos. */
export async function crearZona(tx: Tx, args: { portalId: string; zona: ZonaDePortal; ahora: Date }): Promise<void> {
  const z = args.zona;
  await tx.portalZona.create({
    data: {
      id: z.id,
      portalId: args.portalId,
      sucursalId: z.sucursalId,
      x: textoDesdeCentesimas(z.x),
      y: textoDesdeCentesimas(z.y),
      ancho: textoDesdeCentesimas(z.ancho),
      alto: textoDesdeCentesimas(z.alto),
      visible: z.visible,
      creadoEn: args.ahora,
      actualizadoEn: args.ahora,
    },
  });
}

/** Cambia una zona con control de versión (la que se acaba de leer con el portal bloqueado). */
export async function cambiarZona(tx: Tx, args: { portalId: string; zona: ZonaDePortal; versionEsperada: number; ahora: Date }): Promise<boolean> {
  const z = args.zona;
  const { count } = await tx.portalZona.updateMany({
    where: { portalId: args.portalId, sucursalId: z.sucursalId, version: args.versionEsperada },
    data: { x: textoDesdeCentesimas(z.x), y: textoDesdeCentesimas(z.y), ancho: textoDesdeCentesimas(z.ancho), alto: textoDesdeCentesimas(z.alto), visible: z.visible, version: args.versionEsperada + 1, actualizadoEn: args.ahora },
  });
  return count === 1;
}
