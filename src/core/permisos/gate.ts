import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { capacidadesDeSucursal, sucursalTieneCapacidad } from "./capacidades-sucursal";
import type { AccionClave } from "./acciones";

export type ResultadoGate = { ok: true } | { ok: false; mensaje: string };

const OK: ResultadoGate = { ok: true };

function denegado(mensaje: string): ResultadoGate {
  return { ok: false, mensaje };
}

/**
 * Trae membresía + rol + el `PermisoRol` de ESTA acción en una sola
 * consulta (join anidado) — antes eran 2 round-trips secuenciales
 * (membresía primero, recién con `rolId` en mano el permiso), porque
 * Prisma sí puede resolver esa dependencia server-side con un `include`
 * filtrado en vez de esperar el resultado del primer query en JS.
 */
async function obtenerMembresiaConPermiso(
  usuarioId: string,
  sucursalId: string,
  accionClave: AccionClave,
  db: PrismaClient
) {
  const membresia = await db.usuarioSucursal.findUnique({
    where: { usuarioId_sucursalId: { usuarioId, sucursalId } },
    include: { rol: { include: { permisos: { where: { accionClave } } } } },
  });
  if (!membresia || !membresia.activo || !membresia.rol.activo) return null;
  return { membresia, permiso: membresia.rol.permisos[0] ?? null };
}

/**
 * Equivalente de requierePermiso_ (Core.js:1455-1459): gate de EDITAR.
 * Orden de chequeo, igual que hoy: capacidad de sucursal → rol del usuario
 * en esa sucursal → permiso del rol para la acción — ahora en 2 queries
 * en vez de hasta 4 (ver `sucursalTieneCapacidad` y
 * `obtenerMembresiaConPermiso`).
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

  const resultado = await obtenerMembresiaConPermiso(usuarioId, sucursalId, accionClave, db);
  if (!resultado) {
    return denegado("No tenés acceso a esta sucursal, o tu usuario está inactivo.");
  }

  if (!resultado.permiso?.puedeEditar) {
    return denegado(
      `No tenés permiso para esta acción. Tu rol ("${resultado.membresia.rol.nombre}") no tiene "${accionClave}" habilitado. Pedile a un admin que te lo habilite.`
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

  const resultado = await obtenerMembresiaConPermiso(usuarioId, sucursalId, accionClave, db);
  if (!resultado) {
    return denegado("No tenés acceso a esta sucursal, o tu usuario está inactivo.");
  }

  if (!resultado.permiso?.puedeVer) {
    return denegado(
      `No tenés permiso para ver esta sección. Tu rol ("${resultado.membresia.rol.nombre}") no tiene "${accionClave}" habilitado.`
    );
  }
  return OK;
}

/**
 * Equivalente de obtenerMiNivelPermiso (Core.js:1480-1485) — para que el
 * cliente sepa si mostrar controles de edición o solo la lista. A
 * diferencia de llamar `requierePermisoVer`+`requierePermiso` por
 * separado (4 queries, 2 pares en paralelo), acá se resuelve la
 * membresía+permiso UNA sola vez y se derivan ambos flags de ahí — 2
 * queries en total.
 */
export async function obtenerMiNivelPermiso(
  usuarioId: string,
  sucursalId: string,
  accionClave: AccionClave,
  db: PrismaClient = prisma
): Promise<{ ver: boolean; editar: boolean }> {
  if (!(await sucursalTieneCapacidad(sucursalId, accionClave, db))) {
    return { ver: false, editar: false };
  }

  const resultado = await obtenerMembresiaConPermiso(usuarioId, sucursalId, accionClave, db);
  if (!resultado) return { ver: false, editar: false };

  return { ver: resultado.permiso?.puedeVer ?? false, editar: resultado.permiso?.puedeEditar ?? false };
}

/**
 * De una lista de acciones, cuáles puede VER el usuario en esa sucursal (capacidad de la sucursal + «Ver» de su rol). Es lo
 * mismo que `requierePermisoVer` por cada una, pero en 2 consultas para toda la lista: sirve para armar el menú sin una
 * consulta por ítem. Sin membresía activa, el resultado es vacío.
 */
export async function accionesQueElUsuarioPuedeVer(
  usuarioId: string,
  sucursalId: string,
  claves: readonly AccionClave[],
  db: PrismaClient = prisma
): Promise<Set<AccionClave>> {
  const unicas = [...new Set(claves)];
  if (!unicas.length) return new Set();

  const [membresia, habilitadas] = await Promise.all([
    db.usuarioSucursal.findUnique({
      where: { usuarioId_sucursalId: { usuarioId, sucursalId } },
      include: { rol: { include: { permisos: { where: { accionClave: { in: unicas }, puedeVer: true } } } } },
    }),
    capacidadesDeSucursal(sucursalId, unicas, db),
  ]);
  if (!membresia || !membresia.activo || !membresia.rol.activo) return new Set();

  return new Set(membresia.rol.permisos.map((p) => p.accionClave as AccionClave).filter((clave) => habilitadas.has(clave)));
}
