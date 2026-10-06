import type { PrismaClient } from "@prisma/client";
import { capacidadesDeSucursal, sucursalTieneCapacidad } from "./capacidades-sucursal";
import { contextoDeAccion, nivelMinimoDeAccion, type AccionClave, type AccionDeEmpresa, type AccionDeSucursal } from "./acciones";
import {
  accesoDeSucursal,
  accionesVisiblesEnSucursal,
  decidirEnEmpresa,
  decidirEnSucursal,
  membresiaVigente,
  nivelEnSucursal,
  nivelesEnLaEmpresa,
  type ResultadoGate,
} from "./decision-de-acceso";
import { algunaAccionNecesitaElRegistro } from "./modulo-de-la-accion";
import { denegacionDeModuloDeAccion, modulosEfectivosDeEmpresa } from "./modulos-de-empresa";
import { esGerenteDeEmpresa } from "./rol-empresa";

/**
 * LA CÁSCARA del guard (ADR-011): LEE de la base lo que hace falta y le pasa los hechos a la decisión pura (`decision-de-acceso.ts`). No compara ningún rol ni nivel
 * por su cuenta: eso lo exige `test/arquitectura/acceso-solo-por-el-guard.test.ts`. Las consultas, su cantidad y su orden son las de siempre
 * (`test/permisos/caracterizacion-del-acceso.test.ts` congela las respuestas de toda la matriz y cuántas consultas hace cada llamada).
 */
export { denegado, type ResultadoGate } from "./decision-de-acceso";

/**
 * Trae membresía + rol + el `PermisoRol` de ESTA acción en una sola consulta (join anidado). El PISO de la acción manda sobre la fila (lo decide
 * `permisoQueRige`, en la decisión pura).
 */
async function leerMembresiaConFila(usuarioId: string, sucursalId: string, accionClave: AccionDeSucursal, db: PrismaClient) {
  return db.usuarioSucursal.findUnique({
    where: { usuarioId_sucursalId: { usuarioId, sucursalId } },
    include: { rol: { include: { permisos: { where: { accionClave } } } } },
  });
}

/**
 * Lo que tienen en común el gate de editar, el de ver y el nivel: se leen la membresía y la capacidad de la sucursal EN PARALELO (2 consultas), después el módulo de
 * la empresa solo si hay membresía vigente (el módulo de Administración, fijo, no lee el registro), y la decisión pura evalúa en su orden.
 */
async function resolverAccesoDeSucursal(usuarioId: string, sucursalId: string, accionClave: AccionDeSucursal, db: PrismaClient) {
  const [leida, tieneCapacidad] = await Promise.all([leerMembresiaConFila(usuarioId, sucursalId, accionClave, db), sucursalTieneCapacidad(sucursalId, accionClave, db)]);
  const membresia = membresiaVigente(leida);
  const sinModulo = membresia ? await denegacionDeModuloDeAccion(accionClave, membresia.empresaId, db) : null;
  return accesoDeSucursal({ membresia, filaDelRol: membresia?.rol.permisos[0] ?? null, sinModulo, tieneCapacidad }, accionClave);
}

/** Equivalente de requierePermiso_ (Core.js:1455-1459): gate de EDITAR. Orden: membresía → módulo de la empresa → capacidad de sucursal → permiso del rol. */
export async function requierePermiso(usuarioId: string, sucursalId: string, accionClave: AccionDeSucursal, db: PrismaClient): Promise<ResultadoGate> {
  return decidirEnSucursal(await resolverAccesoDeSucursal(usuarioId, sucursalId, accionClave, db), accionClave, "editar");
}

/**
 * Equivalente de requierePermisoVer_ (Core.js:1468-1472): gate de VER. A diferencia de Apps Script, acá NO hace falta el fallback "Ver vacío cae a Editar" en tiempo
 * de lectura: la invariante "Ver ⊇ Editar" (Core.js:1534) se hace cumplir al ESCRIBIR el permiso (ver server action de permisos).
 */
export async function requierePermisoVer(usuarioId: string, sucursalId: string, accionClave: AccionDeSucursal, db: PrismaClient): Promise<ResultadoGate> {
  return decidirEnSucursal(await resolverAccesoDeSucursal(usuarioId, sucursalId, accionClave, db), accionClave, "ver");
}

/**
 * Equivalente de obtenerMiNivelPermiso (Core.js:1480-1485) — para que el cliente sepa si mostrar controles de edición o solo la lista. Resuelve el acceso UNA sola
 * vez y deriva ambos flags de ahí.
 */
export async function obtenerMiNivelPermiso(usuarioId: string, sucursalId: string, accionClave: AccionDeSucursal, db: PrismaClient): Promise<{ ver: boolean; editar: boolean }> {
  return nivelEnSucursal(await resolverAccesoDeSucursal(usuarioId, sucursalId, accionClave, db));
}

/**
 * De una lista de acciones, cuáles puede VER el usuario en esa sucursal (módulo de la empresa + capacidad de la sucursal + «Ver» de su rol). Es lo mismo que
 * `requierePermisoVer` por cada una, pero en 2 consultas para toda la lista: sirve para armar el menú sin una consulta por ítem. Sin membresía activa, vacío.
 */
export async function accionesQueElUsuarioPuedeVer(usuarioId: string, sucursalId: string, claves: readonly AccionDeSucursal[], db: PrismaClient): Promise<Set<AccionDeSucursal>> {
  const unicas = [...new Set(claves)];
  if (!unicas.length) return new Set();

  const [leida, habilitadas] = await Promise.all([
    db.usuarioSucursal.findUnique({
      where: { usuarioId_sucursalId: { usuarioId, sucursalId } },
      include: { rol: { include: { permisos: { where: { accionClave: { in: unicas }, puedeVer: true } } } } },
    }),
    capacidadesDeSucursal(sucursalId, unicas, db),
  ]);
  const membresia = membresiaVigente(leida);
  if (!membresia) return new Set();

  const efectivos = algunaAccionNecesitaElRegistro(unicas) ? await modulosEfectivosDeEmpresa(membresia.empresaId, db) : null;
  return accionesVisiblesEnSucursal({ rol: membresia.rol, clavesConVerEnElRol: membresia.rol.permisos.map((p) => p.accionClave), habilitadas, efectivos });
}

/**
 * De una lista de sucursales, en cuáles puede VER el usuario esta acción (capacidad de la sucursal + «Ver» del rol que tiene ALLÍ). El gate de una pantalla mira solo
 * la sucursal activa: una pantalla que junta datos de varias sucursales tiene que filtrarlas con esto, si no muestra las de una sucursal donde el rol no tiene el permiso.
 */
export async function sucursalesDondeElUsuarioPuedeVer(usuarioId: string, sucursalIds: readonly string[], accionClave: AccionDeSucursal, db: PrismaClient): Promise<Set<string>> {
  const niveles = await Promise.all(sucursalIds.map((sucursalId) => obtenerMiNivelPermiso(usuarioId, sucursalId, accionClave, db)));
  return new Set(sucursalIds.filter((_, i) => niveles[i].ver));
}

/**
 * Las sucursales del usuario (`ctx.membresias`) donde puede VER la acción, con id y nombre: lo que una pantalla que junta datos de varias sucursales tiene que
 * recorrer en vez de `ctx.membresias` a secas (test/arquitectura/membresias-filtradas.test.ts lo exige).
 */
export async function sucursalesVisiblesPara(
  ctx: { usuarioId: string; membresias: readonly { sucursalId: string; sucursalNombre: string }[]; db: PrismaClient },
  accionClave: AccionDeSucursal,
): Promise<{ id: string; nombre: string }[]> {
  const conPermiso = await sucursalesDondeElUsuarioPuedeVer(ctx.usuarioId, ctx.membresias.map((m) => m.sucursalId), accionClave, ctx.db);
  return ctx.membresias.filter((m) => conPermiso.has(m.sucursalId)).map((m) => ({ id: m.sucursalId, nombre: m.sucursalNombre }));
}

/**
 * Lee lo necesario para decidir las acciones de CONTEXTO EMPRESA del usuario (sus membresías activas en esa empresa con las filas de su matriz, las capacidades de
 * cada sucursal, el registro de módulos si hace falta y si es gerente) y delega en `nivelesEnLaEmpresa` (decisión pura).
 */
async function leerYCalcularNivelesEnLaEmpresa(usuarioId: string, empresaId: string, claves: readonly AccionDeEmpresa[], db: PrismaClient) {
  const unicas = [...new Set(claves)];
  const membresias = await db.usuarioSucursal.findMany({
    where: { usuarioId, activo: true, sucursal: { activo: true, empresaId }, rol: { activo: true } },
    include: { rol: { include: { permisos: { where: { accionClave: { in: unicas } } } } } },
  });
  const [habilitadas, efectivos] = await Promise.all([
    Promise.all(membresias.map((m) => capacidadesDeSucursal(m.sucursalId, unicas, db))),
    membresias.length > 0 && algunaAccionNecesitaElRegistro(unicas) ? modulosEfectivosDeEmpresa(empresaId, db) : null,
  ]);
  const hayDeGerente = unicas.some((c) => nivelMinimoDeAccion(c) === "gerente");
  const esGerente =
    hayDeGerente && membresias.length > 0
      ? esGerenteDeEmpresa((await db.usuarioEmpresa.findFirst({ where: { usuarioId, empresaId, activo: true }, select: { rolEmpresa: true } }))?.rolEmpresa ?? null)
      : false;
  return nivelesEnLaEmpresa({ membresias, habilitadas, efectivos, esGerente, claves: unicas });
}

/** Gate de EDITAR de una acción de empresa (ver `nivelesEnLaEmpresa`). Es el equivalente de `requierePermiso` para el contexto empresa. */
export async function requierePermisoDeEmpresa(usuarioId: string, empresaId: string, accionClave: AccionDeEmpresa, db: PrismaClient): Promise<ResultadoGate> {
  return decidirEnEmpresa(await leerYCalcularNivelesEnLaEmpresa(usuarioId, empresaId, [accionClave], db), accionClave, "editar");
}

/** Gate de VER de una acción de empresa: el equivalente de `requierePermisoVer` para el contexto empresa. */
export async function requierePermisoVerDeEmpresa(usuarioId: string, empresaId: string, accionClave: AccionDeEmpresa, db: PrismaClient): Promise<ResultadoGate> {
  return decidirEnEmpresa(await leerYCalcularNivelesEnLaEmpresa(usuarioId, empresaId, [accionClave], db), accionClave, "ver");
}

/** Como `obtenerMiNivelPermiso` para una acción de empresa: si mostrar los controles de edición o solo la lista. */
export async function obtenerMiNivelPermisoDeEmpresa(usuarioId: string, empresaId: string, accionClave: AccionDeEmpresa, db: PrismaClient): Promise<{ ver: boolean; editar: boolean }> {
  const { niveles } = await leerYCalcularNivelesEnLaEmpresa(usuarioId, empresaId, [accionClave], db);
  const nivel = niveles.get(accionClave)!;
  return { ver: nivel.ver, editar: nivel.editar };
}

/**
 * Para armar el menú y la pantalla de inicio: de una lista de acciones de cualquier contexto, cuáles puede VER el usuario. Las de sucursal se evalúan en la sucursal
 * activa (`accionesQueElUsuarioPuedeVer`); las de empresa, en todas sus membresías de la empresa (`nivelesEnLaEmpresa`). Es lo mismo que pide cada página con su gate,
 * así el menú no muestra lo que la página niega ni esconde lo que sí abre.
 */
export async function accionesDelMenuQueElUsuarioPuedeVer(usuarioId: string, empresaId: string, sucursalId: string, claves: readonly AccionClave[], db: PrismaClient): Promise<Set<AccionClave>> {
  const deEmpresa = claves.filter((c): c is AccionDeEmpresa => contextoDeAccion(c) === "empresa");
  const deSucursal = claves.filter((c): c is AccionDeSucursal => contextoDeAccion(c) === "sucursal");
  const [enSucursal, enEmpresa] = await Promise.all([
    accionesQueElUsuarioPuedeVer(usuarioId, sucursalId, deSucursal, db),
    deEmpresa.length ? leerYCalcularNivelesEnLaEmpresa(usuarioId, empresaId, deEmpresa, db) : null,
  ]);
  const visibles = new Set<AccionClave>(enSucursal);
  if (enEmpresa) for (const [clave, nivel] of enEmpresa.niveles) if (nivel.ver) visibles.add(clave);
  return visibles;
}
