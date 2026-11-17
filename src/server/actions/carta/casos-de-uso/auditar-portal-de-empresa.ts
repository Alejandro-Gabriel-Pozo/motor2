import "server-only";
import type { Prisma } from "@prisma/client";
import type { PartesDeImagen } from "@/core/carta/public";
import { textoDesdeCentesimas, type DatosDelPortal, type TarjetaDePortal, type ZonaDePortal } from "@/core/carta/public";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";

/**
 * Los pasos de auditoría del caso de uso «guardar el portal de la empresa» (`guardar-portal-de-empresa.ts`): UNA fila de `RegistroAuditoria` por entidad que cambia (el portal, cada tarjeta, cada zona), con el estado ANTES (`null` si es un alta) y DESPUÉS, en la misma
 * transacción (`tx`). Son de la EMPRESA (`sucursalId: null`). Lo que se guarda de la imagen es `cuenta/id.extensión` (la dirección completa se arma desde las partes; no hace falta duplicarla). El código del QR solo va en el alta (no cambia nunca).
 */

type Tx = Prisma.TransactionClient;

const textoDeImagen = (i: PartesDeImagen | null): string | null => (i === null ? null : `${i.cuenta}/${i.idPublico}.${i.extension}`);

/** Lo que la auditoría guarda de un portal: sus datos y su imagen (el detalle de tarjetas y zonas va en sus propias filas). */
function aDatoDePortal(datos: DatosDelPortal, imagen: PartesDeImagen | null, codigo?: string) {
  return { ...(codigo === undefined ? {} : { codigo }), ...datos, imagen: textoDeImagen(imagen) };
}

const aDatoDeTarjeta = (t: TarjetaDePortal) => ({ orden: t.orden, visible: t.visible, nombre: t.nombre, telefono: t.telefono, foto: textoDeImagen(t.foto) });

const aDatoDeZona = (z: Pick<ZonaDePortal, "sucursalId" | "x" | "y" | "ancho" | "alto" | "visible">) => ({ sucursalId: z.sucursalId, x: textoDesdeCentesimas(z.x), y: textoDesdeCentesimas(z.y), ancho: textoDesdeCentesimas(z.ancho), alto: textoDesdeCentesimas(z.alto), visible: z.visible });

/** El portal: el alta (`anterior` es `null`) o un cambio de sus datos o de su imagen. No deja fila si no cambió nada (`registrarCambioAuditado` lo descarta). */
export async function auditarPortalDeEmpresa(
  tx: Tx,
  args: { portalId: string; anterior: { datos: DatosDelPortal; imagen: PartesDeImagen | null } | null; nuevo: { datos: DatosDelPortal; imagen: PartesDeImagen | null }; codigoDelAlta?: string; actorId: string },
): Promise<void> {
  await registrarCambioAuditado(tx, {
    entidad: "PortalDeEmpresa",
    entidadId: args.portalId,
    campo: "portal",
    descripcion: args.anterior === null ? "Portal de la empresa: alta" : "Portal de la empresa: cambio de sus datos",
    valorAnterior: args.anterior === null ? null : aDatoDePortal(args.anterior.datos, args.anterior.imagen),
    valorNuevo: aDatoDePortal(args.nuevo.datos, args.nuevo.imagen, args.codigoDelAlta),
    actorId: args.actorId,
    sucursalId: null,
  });
}

/** Una tarjeta: el alta (`anterior` es `null`) o un cambio. */
export async function auditarTarjetaDelPortal(tx: Tx, args: { portalId: string; anterior: TarjetaDePortal | null; nueva: TarjetaDePortal; actorId: string }): Promise<void> {
  await registrarCambioAuditado(tx, {
    entidad: "PortalTarjeta",
    entidadId: `${args.portalId}:${args.nueva.sucursalId}`,
    campo: "tarjeta",
    descripcion: args.anterior === null ? "Tarjeta del portal de la empresa: alta" : "Tarjeta del portal de la empresa: cambio",
    valorAnterior: args.anterior === null ? null : aDatoDeTarjeta(args.anterior),
    valorNuevo: aDatoDeTarjeta(args.nueva),
    actorId: args.actorId,
    sucursalId: null,
  });
}

/** Una zona: el alta (`anterior` es `null`) o un cambio. */
export async function auditarZonaDelPortal(tx: Tx, args: { zonaId: string; anterior: ZonaDePortal | null; nueva: ZonaDePortal; actorId: string }): Promise<void> {
  await registrarCambioAuditado(tx, {
    entidad: "PortalZona",
    entidadId: args.zonaId,
    campo: "zona",
    descripcion: args.anterior === null ? "Zona del portal de la empresa: alta" : "Zona del portal de la empresa: cambio",
    valorAnterior: args.anterior === null ? null : aDatoDeZona(args.anterior),
    valorNuevo: aDatoDeZona(args.nueva),
    actorId: args.actorId,
    sucursalId: null,
  });
}
