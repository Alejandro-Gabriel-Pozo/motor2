import type { PrismaClient } from "@prisma/client";
import { capacidadesDeSucursal, sucursalTieneCapacidad } from "./capacidades-sucursal";
import { contextoDeAccion, type AccionClave, type AccionDeEmpresa, type AccionDeSucursal } from "./acciones";

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
  accionClave: AccionDeSucursal,
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
  accionClave: AccionDeSucursal,
  db: PrismaClient
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
  accionClave: AccionDeSucursal,
  db: PrismaClient
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
  accionClave: AccionDeSucursal,
  db: PrismaClient
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

  return new Set(membresia.rol.permisos.map((p) => p.accionClave as AccionDeSucursal).filter((clave) => habilitadas.has(clave)));
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

interface NivelEnEmpresa {
  ver: boolean;
  editar: boolean;
  /** Algún rol del usuario tiene la acción, pero la Central la deshabilitó en TODAS las sucursales donde la tiene. */
  bloqueadaPorLaCentral: boolean;
}

/**
 * Qué puede hacer el usuario con cada acción de CONTEXTO EMPRESA: una acción de empresa no depende de la sucursal en la que está parado, así que
 * vale si CUALQUIERA de sus membresías activas en esa empresa (sucursal activa, rol activo) tiene la clave Y la Central no la deshabilitó en esa
 * sucursal. Lo contrario (mirar solo la sucursal activa) le niega a un usuario con dos sucursales una acción de empresa según cuál tenga abierta.
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
  const habilitadas = await Promise.all(membresias.map((m) => capacidadesDeSucursal(m.sucursalId, unicas, db)));

  const niveles = new Map<AccionDeEmpresa, NivelEnEmpresa>();
  for (const clave of unicas) {
    const nivel: NivelEnEmpresa = { ver: false, editar: false, bloqueadaPorLaCentral: false };
    membresias.forEach((m, i) => {
      const permiso = m.rol.permisos.find((p) => p.accionClave === clave);
      if (!permiso?.puedeVer) return;
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
  if (!hayMembresia) return denegado("No tenés acceso a esta empresa, o tu usuario está inactivo.");

  const nivel = niveles.get(accionClave)!;
  if (nivel.editar) return OK;
  if (nivel.bloqueadaPorLaCentral && !nivel.ver) return denegado(`La Central no habilitó "${accionClave}" para tus sucursales.`);
  return denegado(
    `No tenés permiso para esta acción. Ninguno de tus roles (${roles.map((r) => `"${r}"`).join(", ")}) tiene "${accionClave}" habilitado. Pedile a un admin que te lo habilite.`
  );
}

/** Gate de VER de una acción de empresa: el equivalente de `requierePermisoVer` para el contexto empresa. */
export async function requierePermisoVerDeEmpresa(
  usuarioId: string,
  empresaId: string,
  accionClave: AccionDeEmpresa,
  db: PrismaClient
): Promise<ResultadoGate> {
  const { hayMembresia, roles, niveles } = await nivelesEnLaEmpresa(usuarioId, empresaId, [accionClave], db);
  if (!hayMembresia) return denegado("No tenés acceso a esta empresa, o tu usuario está inactivo.");

  const nivel = niveles.get(accionClave)!;
  if (nivel.ver) return OK;
  if (nivel.bloqueadaPorLaCentral) return denegado(`La Central no habilitó "${accionClave}" para tus sucursales.`);
  return denegado(
    `No tenés permiso para ver esta sección. Ninguno de tus roles (${roles.map((r) => `"${r}"`).join(", ")}) tiene "${accionClave}" habilitado.`
  );
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
