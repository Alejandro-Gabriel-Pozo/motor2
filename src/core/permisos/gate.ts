import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sucursalTieneCapacidad } from "./capacidades-sucursal";
import type { AccionClave } from "./acciones";

export type ResultadoGate = { ok: true } | { ok: false; mensaje: string };

const OK: ResultadoGate = { ok: true };

function denegado(mensaje: string): ResultadoGate {
  return { ok: false, mensaje };
}

async function obtenerMembresiaActiva(
  usuarioId: string,
  sucursalId: string,
  db: PrismaClient
) {
  const membresia = await db.usuarioSucursal.findUnique({
    where: { usuarioId_sucursalId: { usuarioId, sucursalId } },
    include: { rol: true },
  });
  if (!membresia || !membresia.activo || !membresia.rol.activo) return null;
  return membresia;
}

/**
 * Equivalente de requierePermiso_ (Core.js:1455-1459): gate de EDITAR.
 * Orden de chequeo, igual que hoy: capacidad de sucursal → rol del usuario
 * en esa sucursal → permiso del rol para la acción.
 */
export async function requierePermiso(
  usuarioId: string,
  sucursalId: string,
  accionClave: AccionClave,
  db: PrismaClient = prisma
): Promise<ResultadoGate> {
  if (!(await sucursalTieneCapacidad(sucursalId, accionClave, db))) {
    return denegado(`La Central no habilitó "${accionClave}" para esta sucursal.`);
  }

  const membresia = await obtenerMembresiaActiva(usuarioId, sucursalId, db);
  if (!membresia) {
    return denegado("No tenés acceso a esta sucursal, o tu usuario está inactivo.");
  }

  const permiso = await db.permisoRol.findUnique({
    where: { rolId_accionClave: { rolId: membresia.rolId, accionClave } },
  });

  if (!permiso?.puedeEditar) {
    return denegado(
      `No tenés permiso para esta acción. Tu rol ("${membresia.rol.nombre}") no tiene "${accionClave}" habilitado. Pedile a un admin que te lo habilite.`
    );
  }
  return OK;
}

/**
 * Equivalente de requierePermisoVer_ (Core.js:1468-1472): gate de VER.
 * A diferencia de Apps Script, acá NO hace falta el fallback "Ver vacío
 * cae a Editar" en tiempo de lectura: la invariante "Ver ⊇ Editar"
 * (Core.js:1534) se hace cumplir al ESCRIBIR el permiso (ver server action
 * de permisos), así que `puedeVer` ya viene siempre correcto.
 */
export async function requierePermisoVer(
  usuarioId: string,
  sucursalId: string,
  accionClave: AccionClave,
  db: PrismaClient = prisma
): Promise<ResultadoGate> {
  if (!(await sucursalTieneCapacidad(sucursalId, accionClave, db))) {
    return denegado(`La Central no habilitó "${accionClave}" para esta sucursal.`);
  }

  const membresia = await obtenerMembresiaActiva(usuarioId, sucursalId, db);
  if (!membresia) {
    return denegado("No tenés acceso a esta sucursal, o tu usuario está inactivo.");
  }

  const permiso = await db.permisoRol.findUnique({
    where: { rolId_accionClave: { rolId: membresia.rolId, accionClave } },
  });

  if (!permiso?.puedeVer) {
    return denegado(
      `No tenés permiso para ver esta sección. Tu rol ("${membresia.rol.nombre}") no tiene "${accionClave}" habilitado.`
    );
  }
  return OK;
}

/**
 * Equivalente de obtenerMiNivelPermiso (Core.js:1480-1485) — para que el
 * cliente sepa si mostrar controles de edición o solo la lista.
 */
export async function obtenerMiNivelPermiso(
  usuarioId: string,
  sucursalId: string,
  accionClave: AccionClave,
  db: PrismaClient = prisma
): Promise<{ ver: boolean; editar: boolean }> {
  const [ver, editar] = await Promise.all([
    requierePermisoVer(usuarioId, sucursalId, accionClave, db),
    requierePermiso(usuarioId, sucursalId, accionClave, db),
  ]);
  return { ver: ver.ok, editar: editar.ok };
}
