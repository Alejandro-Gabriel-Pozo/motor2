import { moduloDeAccion, nivelMinimoDeAccion, type AccionClave, type AccionDeEmpresa, type AccionDeSucursal } from "./acciones";
import { rolAlcanzaLaAccion } from "./jerarquia";
import { denegacionDeModulo } from "./modulo-de-la-accion";
import { textoDeDenegacion, type Denegacion } from "./motivos";

/**
 * LA DECISIÓN de acceso, pura (Pureza Fase 3, tramo B; ADR-011): dado lo que la cáscara leyó de la base (membresía, rol, filas de la matriz, capacidades de la
 * sucursal, registro de módulos, rol de empresa), responde si el usuario puede y, si no, POR QUÉ. Nada de lo que decide el guard vive en otro lado: la cáscara
 * (`gate.ts`) solo LEE y le pasa los hechos a estas funciones, sin comparar ningún rol ni nivel por su cuenta (`acceso-solo-por-el-guard.test.ts`).
 *
 * El ORDEN de evaluación es el de siempre: membresía → módulo de la empresa → capacidad de la sucursal → permiso del rol. Lo congela
 * `test/permisos/caracterizacion-del-acceso.test.ts` (matriz de todas las acciones × usuarios × registros de módulos, contra Postgres real).
 */

/** Una denegación lleva su MOTIVO tipado (ver `motivos.ts`) y el `mensaje` ya armado: las pantallas que solo muestran el texto no cambian. */
export type ResultadoGate = { ok: true } | ({ ok: false; mensaje: string } & Denegacion);

const PERMITIDO: ResultadoGate = { ok: true };

export function denegado(d: Denegacion): ResultadoGate {
  return { ok: false, mensaje: textoDeDenegacion(d), ...d };
}

/** Lo que la decisión necesita de un rol. */
export interface RolLeido {
  nombre: string;
  clave: string | null;
  activo: boolean;
}

/** Una fila de la matriz (`PermisoRol`) de un rol para una acción. */
export interface PermisoLeido {
  puedeVer: boolean;
  puedeEditar: boolean;
}

/** La membresía sirve solo si está activa y su rol también; si no, para el guard no existe. */
export function membresiaVigente<T extends { activo: boolean; rol: { activo: boolean } }>(membresia: T | null): T | null {
  return membresia && membresia.activo && membresia.rol.activo ? membresia : null;
}

/**
 * El PISO de la acción (`nivelMinimo`) manda sobre la fila: si el rol no llega al piso, no hay permiso aunque la fila exista (un dato viejo o una migración no
 * pueden convertirse en acceso). Una acción de piso gerente no la alcanza ningún rol, por eso es de contexto empresa.
 */
function permisoQueRige(rol: { clave: string | null }, accion: AccionClave, filaDelRol: PermisoLeido | null): PermisoLeido | null {
  return rolAlcanzaLaAccion(rol, accion) ? filaDelRol : null;
}

/** Lo que tienen en común el gate de editar, el de ver y el nivel (sucursal): o una denegación, o la membresía con el permiso que rige. */
export type AccesoDeSucursal<M extends { rol: { clave: string | null } }> = { denegacion: Denegacion } | { denegacion: null; membresia: M; permiso: PermisoLeido | null };

/**
 * ORDEN de evaluación: membresía → módulo de la empresa → capacidad de la sucursal → (lo que sigue es del rol, que mira cada gate). La membresía va primero porque
 * las acciones de sucursal no reciben `empresaId`: sale de la membresía. `membresia` ya es la VIGENTE (o null), y `sinModulo` solo se lee si hay membresía (el módulo
 * de Administración, fijo, no lee el registro): por eso viene resuelto desde afuera.
 */
export function accesoDeSucursal<M extends { rol: { clave: string | null } }>(
  hechos: { membresia: M | null; filaDelRol: PermisoLeido | null; sinModulo: Denegacion | null; tieneCapacidad: boolean },
  accion: AccionDeSucursal,
): AccesoDeSucursal<M> {
  if (!hechos.membresia) return { denegacion: { motivo: "SIN_PERMISO", caso: "SIN_ACCESO_A_SUCURSAL" } };
  if (hechos.sinModulo) return { denegacion: hechos.sinModulo };
  if (!hechos.tieneCapacidad) return { denegacion: { motivo: "SIN_CAPACIDAD", accion, alcance: "sucursal" } };
  return { denegacion: null, membresia: hechos.membresia, permiso: permisoQueRige(hechos.membresia.rol, accion, hechos.filaDelRol) };
}

/** Gate de EDITAR o de VER de una acción de sucursal, sobre el acceso ya resuelto. */
export function decidirEnSucursal<M extends { rol: RolLeido }>(acceso: AccesoDeSucursal<M>, accion: AccionDeSucursal, para: "editar" | "ver"): ResultadoGate {
  if (acceso.denegacion) return denegado(acceso.denegacion);
  const alcanza = para === "editar" ? acceso.permiso?.puedeEditar : acceso.permiso?.puedeVer;
  if (!alcanza) return denegado({ motivo: "SIN_PERMISO", caso: "ROL_SIN_LA_ACCION", para, accion, rol: acceso.membresia.rol.nombre });
  return PERMITIDO;
}

/** Si mostrar los controles de edición o solo la lista (sucursal). */
export function nivelEnSucursal<M extends { rol: { clave: string | null } }>(acceso: AccesoDeSucursal<M>): { ver: boolean; editar: boolean } {
  if (acceso.denegacion) return { ver: false, editar: false };
  return { ver: acceso.permiso?.puedeVer ?? false, editar: acceso.permiso?.puedeEditar ?? false };
}

/**
 * De una lista de acciones de sucursal, cuáles puede VER el usuario: la capacidad de la sucursal, el módulo de la empresa y la fila «Ver» de su rol (con el piso).
 * `permisosVer` son las filas del rol con `puedeVer` para esas claves; `efectivos` es null si ninguna acción necesitaba el registro (todas de Administración).
 */
export function accionesVisiblesEnSucursal(hechos: {
  rol: { clave: string | null };
  clavesConVerEnElRol: readonly string[];
  habilitadas: ReadonlySet<string>;
  efectivos: ReadonlySet<string> | null;
}): Set<AccionDeSucursal> {
  const { rol, clavesConVerEnElRol, habilitadas, efectivos } = hechos;
  return new Set(
    clavesConVerEnElRol
      .map((clave) => clave as AccionDeSucursal)
      .filter((clave) => habilitadas.has(clave) && rolAlcanzaLaAccion(rol, clave) && (!efectivos || !denegacionDeModulo(moduloDeAccion(clave), efectivos))),
  );
}

/** Lo que el contexto empresa necesita de cada membresía activa del usuario: su sucursal, su rol y las filas de la matriz de ese rol para las acciones pedidas. */
export interface MembresiaParaEmpresa {
  rol: { nombre: string; clave: string | null; permisos: readonly (PermisoLeido & { accionClave: string })[] };
}

export interface NivelEnEmpresa {
  ver: boolean;
  editar: boolean;
  /** Algún rol del usuario tiene la acción, pero la Central la deshabilitó en TODAS las sucursales donde la tiene. */
  bloqueadaPorLaCentral: boolean;
  /** La empresa no tiene el módulo de la acción: manda sobre la capacidad y el rol, y `ver` y `editar` quedan en falso. */
  sinModulo: Denegacion | null;
}

/**
 * Qué puede hacer el usuario con cada acción de CONTEXTO EMPRESA (si la empresa tiene el módulo de la acción, antes que todo lo demás): una acción de empresa no
 * depende de la sucursal en la que está parado; vale si CUALQUIERA de sus membresías activas en esa empresa (sucursal activa, rol activo) tiene la clave Y la Central
 * no la deshabilitó en esa sucursal. El PISO de la acción manda sobre la fila. Una acción de piso gerente la tiene SOLO quien es gerente de la empresa
 * (`esGerente`), sin matriz ni capacidad de sucursal: la autoridad de empresa no se delega.
 *
 * `habilitadas[i]` son las capacidades de `membresias[i]`; `efectivos` es null si no hay membresías o ninguna acción necesita el registro.
 */
export function nivelesEnLaEmpresa(hechos: {
  membresias: readonly MembresiaParaEmpresa[];
  habilitadas: readonly ReadonlySet<string>[];
  efectivos: ReadonlySet<string> | null;
  esGerente: boolean;
  claves: readonly AccionDeEmpresa[];
}): { hayMembresia: boolean; roles: string[]; niveles: Map<AccionDeEmpresa, NivelEnEmpresa> } {
  const { membresias, habilitadas, efectivos, esGerente } = hechos;
  const niveles = new Map<AccionDeEmpresa, NivelEnEmpresa>();
  for (const clave of [...new Set(hechos.claves)]) {
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
      if (!habilitadas[i]!.has(clave)) {
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

/** Gate de EDITAR o de VER de una acción de empresa, sobre los niveles ya calculados (`nivelesEnLaEmpresa`). */
export function decidirEnEmpresa(
  resultado: { hayMembresia: boolean; roles: string[]; niveles: ReadonlyMap<AccionDeEmpresa, NivelEnEmpresa> },
  accion: AccionDeEmpresa,
  para: "editar" | "ver",
): ResultadoGate {
  if (!resultado.hayMembresia) return denegado({ motivo: "SIN_PERMISO", caso: "SIN_ACCESO_A_EMPRESA" });

  const nivel = resultado.niveles.get(accion)!;
  if (nivel.sinModulo) return denegado(nivel.sinModulo);
  if (para === "editar") {
    if (nivel.editar) return PERMITIDO;
    if (nivel.bloqueadaPorLaCentral && !nivel.ver) return denegado({ motivo: "SIN_CAPACIDAD", accion, alcance: "sucursales_del_usuario" });
  } else {
    if (nivel.ver) return PERMITIDO;
    if (nivel.bloqueadaPorLaCentral) return denegado({ motivo: "SIN_CAPACIDAD", accion, alcance: "sucursales_del_usuario" });
  }
  if (nivelMinimoDeAccion(accion) === "gerente") return denegado({ motivo: "SIN_PERMISO", caso: "SOLO_GERENTE", para });
  return denegado({ motivo: "SIN_PERMISO", caso: "ROLES_SIN_LA_ACCION", para, accion, roles: resultado.roles });
}
