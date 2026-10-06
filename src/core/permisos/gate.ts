import type { PrismaClient } from "@prisma/client";
import { capacidadesDeSucursal, sucursalTieneCapacidad } from "./capacidades-sucursal";
import { contextoDeAccion, moduloDeAccion, nivelMinimoDeAccion, type AccionClave, type AccionDeEmpresa, type AccionDeSucursal } from "./acciones";
import { textoDeDenegacion, type Denegacion } from "./motivos";
import { algunaAccionNecesitaElRegistro, denegacionDeModulo, denegacionDeModuloDeAccion, modulosEfectivosDeEmpresa } from "./modulos-de-empresa";
import { rolAlcanzaLaAccion } from "./jerarquia";
import { esGerenteDeEmpresa } from "./rol-empresa";

/** Una denegación lleva su MOTIVO tipado (ver `motivos.ts`) y el `mensaje` ya armado: las pantallas que solo muestran el texto no cambian. */
export type ResultadoGate = { ok: true } | ({ ok: false; mensaje: string } & Denegacion);

const OK: ResultadoGate = { ok: true };

export function denegado(d: Denegacion): ResultadoGate {
  return { ok: false, mensaje: textoDeDenegacion(d), ...d };
}

/**
 * Trae membresía + rol + el `PermisoRol` de ESTA acción en una sola
 * consulta (join anidado) — antes eran 2 round-trips secuenciales
 * (membresía primero, recién con `rolId` en mano el permiso), porque
 * Prisma sí puede resolver esa dependencia server-side con un `include`
 * filtrado en vez de esperar el resultado del primer query en JS.
 *
 * El PISO de la acción (`nivelMinimo`) manda sobre la fila: si el rol no llega al piso, `permiso` es null aunque la fila exista (un dato
 * viejo o una migración no pueden convertirse en acceso). Una acción de piso gerente no la alcanza ningún rol, por eso es de contexto empresa.
 */
async function obtenerMembresiaConPermiso(
  usuarioId: string,
  sucursalId: string,
  accionClave: AccionDeSucursal,
  db: PrismaClient
) {
  const membresia = await db.usuarioSucursal.findUnique({
    where: { usuarioId_sucursalId: { usuarioId, sucursalId } },
    include: { rol: { include: { permisos: { where: { accionClave } } } } },
  });
  if (!membresia || !membresia.activo || !membresia.rol.activo) return null;
  return { membresia, permiso: rolAlcanzaLaAccion(membresia.rol, accionClave) ? (membresia.rol.permisos[0] ?? null) : null };
}

type MembresiaConPermiso = NonNullable<Awaited<ReturnType<typeof obtenerMembresiaConPermiso>>>;
type AccesoDeSucursal = { denegacion: Denegacion } | ({ denegacion: null } & MembresiaConPermiso);

/**
 * Lo que tienen en común el gate de editar, el de ver y el nivel: ORDEN de evaluación membresía → módulo de la empresa → capacidad de la
 * sucursal → (lo que sigue es del rol, que mira cada gate). La membresía va primero porque las acciones de sucursal no reciben `empresaId`:
 * sale de `UsuarioSucursal.empresaId`. La capacidad se consulta en paralelo con la membresía (2 consultas, como antes) pero se evalúa después.
 * El módulo de Administración (fijo) no lee el registro.
 */
async function resolverAccesoDeSucursal(usuarioId: string, sucursalId: string, accionClave: AccionDeSucursal, db: PrismaClient): Promise<AccesoDeSucursal> {
  const [resultado, tieneCapacidad] = await Promise.all([
    obtenerMembresiaConPermiso(usuarioId, sucursalId, accionClave, db),
    sucursalTieneCapacidad(sucursalId, accionClave, db),
  ]);
  if (!resultado) return { denegacion: { motivo: "SIN_PERMISO", caso: "SIN_ACCESO_A_SUCURSAL" } };

  const sinModulo = await denegacionDeModuloDeAccion(accionClave, resultado.membresia.empresaId, db);
  if (sinModulo) return { denegacion: sinModulo };
  if (!tieneCapacidad) return { denegacion: { motivo: "SIN_CAPACIDAD", accion: accionClave, alcance: "sucursal" } };
  return { denegacion: null, ...resultado };
}

/**
 * Equivalente de requierePermiso_ (Core.js:1455-1459): gate de EDITAR.
 * Orden de chequeo: membresía → módulo de la empresa → capacidad de
 * sucursal → permiso del rol para la acción (ver `resolverAccesoDeSucursal`).
 */
export async function requierePermiso(
  usuarioId: string,
  sucursalId: string,
  accionClave: AccionDeSucursal,
  db: PrismaClient
): Promise<ResultadoGate> {
  const acceso = await resolverAccesoDeSucursal(usuarioId, sucursalId, accionClave, db);
  if (acceso.denegacion) return denegado(acceso.denegacion);

  if (!acceso.permiso?.puedeEditar) {
    return denegado({ motivo: "SIN_PERMISO", caso: "ROL_SIN_LA_ACCION", para: "editar", accion: accionClave, rol: acceso.membresia.rol.nombre });
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
  accionClave: AccionDeSucursal,
  db: PrismaClient
): Promise<ResultadoGate> {
  const acceso = await resolverAccesoDeSucursal(usuarioId, sucursalId, accionClave, db);
  if (acceso.denegacion) return denegado(acceso.denegacion);

  if (!acceso.permiso?.puedeVer) {
    return denegado({ motivo: "SIN_PERMISO", caso: "ROL_SIN_LA_ACCION", para: "ver", accion: accionClave, rol: acceso.membresia.rol.nombre });
  }
  return OK;
}

/**
 * Equivalente de obtenerMiNivelPermiso (Core.js:1480-1485) — para que el
 * cliente sepa si mostrar controles de edición o solo la lista. A
 * diferencia de llamar `requierePermisoVer`+`requierePermiso` por
 * separado, acá se resuelve el acceso UNA sola vez y se derivan ambos
 * flags de ahí.
 */
export async function obtenerMiNivelPermiso(
  usuarioId: string,
  sucursalId: string,
  accionClave: AccionDeSucursal,
  db: PrismaClient
): Promise<{ ver: boolean; editar: boolean }> {
  const acceso = await resolverAccesoDeSucursal(usuarioId, sucursalId, accionClave, db);
  if (acceso.denegacion) return { ver: false, editar: false };

  return { ver: acceso.permiso?.puedeVer ?? false, editar: acceso.permiso?.puedeEditar ?? false };
}

/**
 * De una lista de acciones, cuáles puede VER el usuario en esa sucursal (módulo de la empresa + capacidad de la sucursal + «Ver» de su rol). Es lo
 * mismo que `requierePermisoVer` por cada una, pero en 2 consultas para toda la lista: sirve para armar el menú sin una
 * consulta por ítem. Sin membresía activa, el resultado es vacío.
 */
export async function accionesQueElUsuarioPuedeVer(
  usuarioId: string,
  sucursalId: string,
  claves: readonly AccionDeSucursal[],
  db: PrismaClient
): Promise<Set<AccionDeSucursal>> {
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

  const efectivos = algunaAccionNecesitaElRegistro(unicas) ? await modulosEfectivosDeEmpresa(membresia.empresaId, db) : null;
  return new Set(
    membresia.rol.permisos
      .map((p) => p.accionClave as AccionDeSucursal)
      .filter((clave) => habilitadas.has(clave) && rolAlcanzaLaAccion(membresia.rol, clave) && (!efectivos || !denegacionDeModulo(moduloDeAccion(clave), efectivos)))
  );
}

/**
 * De una lista de sucursales, en cuáles puede VER el usuario esta acción (capacidad de la sucursal + «Ver» del rol que tiene ALLÍ). El gate
 * de una pantalla mira solo la sucursal activa: una pantalla que junta datos de varias sucursales tiene que filtrarlas con esto, si no
 * muestra las de una sucursal donde el rol no tiene el permiso.
 */
export async function sucursalesDondeElUsuarioPuedeVer(
  usuarioId: string,
  sucursalIds: readonly string[],
  accionClave: AccionDeSucursal,
  db: PrismaClient
): Promise<Set<string>> {
  const niveles = await Promise.all(sucursalIds.map((sucursalId) => obtenerMiNivelPermiso(usuarioId, sucursalId, accionClave, db)));
  return new Set(sucursalIds.filter((_, i) => niveles[i].ver));
}

/**
 * Las sucursales del usuario (`ctx.membresias`) donde puede VER la acción, con id y nombre: lo que una pantalla que junta datos de varias
 * sucursales tiene que recorrer en vez de `ctx.membresias` a secas (test/arquitectura/membresias-filtradas.test.ts lo exige).
 */
export async function sucursalesVisiblesPara(
  ctx: { usuarioId: string; membresias: readonly { sucursalId: string; sucursalNombre: string }[]; db: PrismaClient },
  accionClave: AccionDeSucursal
): Promise<{ id: string; nombre: string }[]> {
  const conPermiso = await sucursalesDondeElUsuarioPuedeVer(ctx.usuarioId, ctx.membresias.map((m) => m.sucursalId), accionClave, ctx.db);
  return ctx.membresias.filter((m) => conPermiso.has(m.sucursalId)).map((m) => ({ id: m.sucursalId, nombre: m.sucursalNombre }));
}

interface NivelEnEmpresa {
  ver: boolean;
  editar: boolean;
  /** Algún rol del usuario tiene la acción, pero la Central la deshabilitó en TODAS las sucursales donde la tiene. */
  bloqueadaPorLaCentral: boolean;
  /** La empresa no tiene el módulo de la acción: manda sobre la capacidad y el rol, y `ver` y `editar` quedan en falso. */
  sinModulo: Denegacion | null;
}

/**
 * Qué puede hacer el usuario con cada acción de CONTEXTO EMPRESA (si la empresa tiene el módulo de la acción, antes que todo lo demás): una acción de empresa no depende de la sucursal en la que está parado, así que
 * vale si CUALQUIERA de sus membresías activas en esa empresa (sucursal activa, rol activo) tiene la clave Y la Central no la deshabilitó en esa
 * sucursal. Lo contrario (mirar solo la sucursal activa) le niega a un usuario con dos sucursales una acción de empresa según cuál tenga abierta.
 *
 * El PISO de la acción manda sobre la fila: un rol por debajo no la alcanza aunque `PermisoRol` la tenga. Una acción de piso gerente la tiene
 * SOLO quien es gerente de la empresa (`UsuarioEmpresa.rolEmpresa`), sin matriz ni capacidad de sucursal: la autoridad de empresa no se delega.
 */
async function nivelesEnLaEmpresa(
  usuarioId: string,
  empresaId: string,
  claves: readonly AccionDeEmpresa[],
  db: PrismaClient
): Promise<{ hayMembresia: boolean; roles: string[]; niveles: Map<AccionDeEmpresa, NivelEnEmpresa> }> {
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

  const niveles = new Map<AccionDeEmpresa, NivelEnEmpresa>();
  for (const clave of unicas) {
    const nivel: NivelEnEmpresa = { ver: false, editar: false, bloqueadaPorLaCentral: false, sinModulo: efectivos ? denegacionDeModulo(moduloDeAccion(clave), efectivos) : null };
    if (nivel.sinModulo) {
      niveles.set(clave, nivel);
      continue;
    }
    if (nivelMinimoDeAccion(clave) === "gerente") {
      nivel.ver = esGerente;
      nivel.editar = esGerente;
      niveles.set(clave, nivel);
      continue;
    }
    membresias.forEach((m, i) => {
      const permiso = m.rol.permisos.find((p) => p.accionClave === clave);
      if (!permiso?.puedeVer || !rolAlcanzaLaAccion(m.rol, clave)) return;
      if (!habilitadas[i].has(clave)) {
        nivel.bloqueadaPorLaCentral = true;
        return;
      }
      nivel.ver = true;
      if (permiso.puedeEditar) nivel.editar = true;
    });
    niveles.set(clave, nivel);
  }
  return { hayMembresia: membresias.length > 0, roles: [...new Set(membresias.map((m) => m.rol.nombre))], niveles };
}

/** Gate de EDITAR de una acción de empresa (ver `nivelesEnLaEmpresa`). Es el equivalente de `requierePermiso` para el contexto empresa. */
export async function requierePermisoDeEmpresa(
  usuarioId: string,
  empresaId: string,
  accionClave: AccionDeEmpresa,
  db: PrismaClient
): Promise<ResultadoGate> {
  const { hayMembresia, roles, niveles } = await nivelesEnLaEmpresa(usuarioId, empresaId, [accionClave], db);
  if (!hayMembresia) return denegado({ motivo: "SIN_PERMISO", caso: "SIN_ACCESO_A_EMPRESA" });

  const nivel = niveles.get(accionClave)!;
  if (nivel.sinModulo) return denegado(nivel.sinModulo);
  if (nivel.editar) return OK;
  if (nivel.bloqueadaPorLaCentral && !nivel.ver) return denegado({ motivo: "SIN_CAPACIDAD", accion: accionClave, alcance: "sucursales_del_usuario" });
  if (nivelMinimoDeAccion(accionClave) === "gerente") return denegado({ motivo: "SIN_PERMISO", caso: "SOLO_GERENTE", para: "editar" });
  return denegado({ motivo: "SIN_PERMISO", caso: "ROLES_SIN_LA_ACCION", para: "editar", accion: accionClave, roles });
}

/** Gate de VER de una acción de empresa: el equivalente de `requierePermisoVer` para el contexto empresa. */
export async function requierePermisoVerDeEmpresa(
  usuarioId: string,
  empresaId: string,
  accionClave: AccionDeEmpresa,
  db: PrismaClient
): Promise<ResultadoGate> {
  const { hayMembresia, roles, niveles } = await nivelesEnLaEmpresa(usuarioId, empresaId, [accionClave], db);
  if (!hayMembresia) return denegado({ motivo: "SIN_PERMISO", caso: "SIN_ACCESO_A_EMPRESA" });

  const nivel = niveles.get(accionClave)!;
  if (nivel.sinModulo) return denegado(nivel.sinModulo);
  if (nivel.ver) return OK;
  if (nivel.bloqueadaPorLaCentral) return denegado({ motivo: "SIN_CAPACIDAD", accion: accionClave, alcance: "sucursales_del_usuario" });
  if (nivelMinimoDeAccion(accionClave) === "gerente") return denegado({ motivo: "SIN_PERMISO", caso: "SOLO_GERENTE", para: "ver" });
  return denegado({ motivo: "SIN_PERMISO", caso: "ROLES_SIN_LA_ACCION", para: "ver", accion: accionClave, roles });
}

/** Como `obtenerMiNivelPermiso` para una acción de empresa: si mostrar los controles de edición o solo la lista. */
export async function obtenerMiNivelPermisoDeEmpresa(
  usuarioId: string,
  empresaId: string,
  accionClave: AccionDeEmpresa,
  db: PrismaClient
): Promise<{ ver: boolean; editar: boolean }> {
  const { niveles } = await nivelesEnLaEmpresa(usuarioId, empresaId, [accionClave], db);
  const nivel = niveles.get(accionClave)!;
  return { ver: nivel.ver, editar: nivel.editar };
}

/**
 * Para armar el menú y la pantalla de inicio: de una lista de acciones de cualquier contexto, cuáles puede VER el usuario. Las de sucursal se
 * evalúan en la sucursal activa (`accionesQueElUsuarioPuedeVer`); las de empresa, en todas sus membresías de la empresa (`nivelesEnLaEmpresa`).
 * Es lo mismo que pide cada página con su gate, así el menú no muestra lo que la página niega ni esconde lo que sí abre.
 */
export async function accionesDelMenuQueElUsuarioPuedeVer(
  usuarioId: string,
  empresaId: string,
  sucursalId: string,
  claves: readonly AccionClave[],
  db: PrismaClient
): Promise<Set<AccionClave>> {
  const deEmpresa = claves.filter((c): c is AccionDeEmpresa => contextoDeAccion(c) === "empresa");
  const deSucursal = claves.filter((c): c is AccionDeSucursal => contextoDeAccion(c) === "sucursal");
  const [enSucursal, enEmpresa] = await Promise.all([
    accionesQueElUsuarioPuedeVer(usuarioId, sucursalId, deSucursal, db),
    deEmpresa.length ? nivelesEnLaEmpresa(usuarioId, empresaId, deEmpresa, db) : null,
  ]);
  const visibles = new Set<AccionClave>(enSucursal);
  if (enEmpresa) for (const [clave, nivel] of enEmpresa.niveles) if (nivel.ver) visibles.add(clave);
  return visibles;
}
